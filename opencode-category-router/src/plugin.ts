import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { CATEGORIES, CATEGORY_NAMES } from "./categories"
import { resolveModelForDelegateTask, type DelegateModelResolutionInput } from "./resolve-model"
import { parseModelString } from "./model-utils"
import { resolveAvailableModels, buildPromptBody, TaskRegistry, type RegisteredTask, type AvailableModelsClient, type MessagesClient } from "./subagent"
import { CATEGORY_WORKER_AGENT } from "./agent-definition"
import { renderCategoryTable } from "./system-inject"

type OpenCodeClient = AvailableModelsClient & MessagesClient & {
  session: {
    create(opts: { body: { parentID?: string; title?: string } }): Promise<{ data?: { id?: string } }>
    prompt(opts: { path: { id: string }; body: Record<string, unknown> }): Promise<{ data?: { info?: { error?: unknown }; parts?: Array<{ type?: string; text?: string }> } }>
    promptAsync(opts: { path: { id: string }; body: Record<string, unknown> }): Promise<{ data?: unknown }>
    messages(opts: { path: { id: string } }): Promise<{ data?: Array<{ info?: { error?: unknown }; parts?: Array<{ type?: string; text?: string }> }> }>
    delete(opts: { path: { id: string } }): Promise<unknown>
  }
}

function extractText(parts: Array<{ type?: string; text?: string }> | undefined): string {
  return (parts ?? []).filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n").trim()
}

export const CategoryRouterPlugin: Plugin = async ({ client, directory, worktree }) => {
  const projectRoot = worktree ?? directory
  const registry = new TaskRegistry(projectRoot)
  await registry.load()

  const notifyParent = async (task: RegisteredTask, failed: boolean): Promise<void> => {
    const status = failed ? "失败" : "完成"
    const text = `[delegate_task] 后台任务 ${status} (task_id=${task.taskId}, category=${task.category})`
    await client.session.promptAsync({
      path: { id: task.parentID },
      body: { parts: [{ type: "text", text }], noReply: false },
    })
  }

  // 简化 busy 判定：MVP 统一 reply-required；父会话 busy 时 noReply:true 降级作为后续增强（spec §7.3 步骤3）
  await registry.reconcile(client as MessagesClient, notifyParent)

  return {
    tool: {
      delegate_task: tool({
        description: `按任务类别派发子任务到对应模型执行。类别可选：${CATEGORY_NAMES.join(", ")}。指定工作类型，不要手动选模型。`,
        args: {
          category: tool.schema.string().describe("任务类别（见可用类别表）"),
          prompt: tool.schema.string().describe("任务描述，以明确目标形式给出"),
          run_in_background: tool.schema.boolean().optional().describe("后台运行并立即返回 task_id（默认 false）"),
          description: tool.schema.string().optional().describe("任务展示标题"),
        },
        async execute(args, context) {
          const categoryName = args.category
          const category = CATEGORIES[categoryName]
          if (!category) {
            return `Unknown category "${categoryName}". Available: ${CATEGORY_NAMES.join(", ")}`
          }

          const availableModels = await resolveAvailableModels(client as AvailableModelsClient)

          const input: DelegateModelResolutionInput = {
            availableModels,
            categoryDefaultModel: category.model,
            fallbackChain: category.fallbackChain,
          }
          const resolution = resolveModelForDelegateTask(input, {
            connectedProviders: null,
            hasProviderModelsCache: false,
            hasConnectedProvidersCache: false,
          })

          let providerID: string
          let modelID: string
          let variant: string | undefined

          if (resolution && "skipped" in resolution) {
            // 冷缓存：跳过 fuzzy，直接采用类别首选（spec §5）
            const parsed = parseModelString(category.model)
            if (!parsed) return `Invalid preferred model for category "${categoryName}": ${category.model}`
            providerID = parsed.providerID
            modelID = parsed.modelID
            variant = category.variant ?? parsed.variant
          } else if (resolution) {
            const parsed = parseModelString(resolution.model)
            if (!parsed) return `Invalid resolved model "${resolution.model}" for category "${categoryName}"`
            providerID = parsed.providerID
            modelID = parsed.modelID
            variant = resolution.variant ?? category.variant
          } else {
            return `No model available for category "${categoryName}". Connect a provider with: ${category.model} or configure an alternative model.`
          }

          const created = await client.session.create({ body: { parentID: context.sessionID, title: args.description } })
          const sessionID = created?.data?.id
          if (!sessionID) return "Failed to create child session"

          const body = buildPromptBody(
            { providerID, modelID },
            variant,
            {
              agent: CATEGORY_WORKER_AGENT.name,
              parts: [{ type: "text", text: args.prompt }],
              noReply: false,
            },
          )

          if (args.run_in_background) {
            const taskId = sessionID
            await registry.add({ sessionID, parentID: context.sessionID, taskId, category: categoryName, notified: false, failed: false })
            try {
              await client.session.promptAsync({ path: { id: sessionID }, body })
            } catch {
              // promptAsync 抛错时返回失败状态，不阻塞编排者（spec §7.1 步骤5）
              return `Background task failed to start (category=${categoryName}) for task_id=${taskId}`
            }
            return `Background task started. task_id=${taskId} category=${categoryName}.`
          }

          // 父会话中断（ESC）时中止子会话，避免孤儿任务继续烧 token（spec §7.1 步骤5 / §9）
          const abortChild = (): void => {
            client.session.delete({ path: { id: sessionID } }).catch(() => {})
          }
          if (context.abort.aborted) {
            abortChild()
            return "Task cancelled (parent session aborted)."
          }
          context.abort.addEventListener("abort", abortChild, { once: true })
          try {
            const resp = await client.session.prompt({ path: { id: sessionID }, body })
            if (resp?.data?.info?.error) {
              return `Task failed (${categoryName}): ${JSON.stringify(resp.data.info.error)}`
            }
            return extractText(resp?.data?.parts) || `Task completed (${categoryName}) with no text output.`
          } finally {
            context.abort.removeEventListener("abort", abortChild)
          }
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = (event as { properties?: { sessionID?: string } }).properties?.sessionID
      if (!sessionID) return
      const task = registry.get(sessionID)
      if (!task || task.notified) return
      const msgs = await (client as MessagesClient).session.messages({ path: { id: sessionID } }).catch(() => ({ data: [] }))
      const list = msgs?.data ?? []
      if (list.length === 0) return
      const last = list[list.length - 1]
      // 与 reconcile 同 gate：仅当最后一条是 assistant 回复才视为完成（spec §13），
      // 被掐断的子会话只有 user prompt，不得误报"完成"。
      if (!last?.info || last.info.role !== "assistant") return
      const failed = Boolean(last.info.error)
      try {
        await notifyParent(task, failed)
        await registry.markNotified(sessionID, failed)
      } catch {
        // 尽力而为（spec §9）：通知失败不标记，留待后续 event/reconcile 重试
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(renderCategoryTable())
    },

    config: async (config) => {
      const cfg = config as Record<string, unknown>
      const agents = (cfg.agent ?? {}) as Record<string, unknown>
      const existing = agents[CATEGORY_WORKER_AGENT.name] as { tools?: Record<string, boolean> } | undefined
      // 浅合并 + tools 深层合并：用户 JSONC 已定制的 category-worker（如放开 delegate_task）不被插件默认值踩掉（spec §7.5）
      agents[CATEGORY_WORKER_AGENT.name] = {
        ...CATEGORY_WORKER_AGENT,
        ...existing,
        tools: { ...CATEGORY_WORKER_AGENT.tools, ...(existing?.tools ?? {}) },
      }
      cfg.agent = agents
    },
  }
}

// opencode 插件加载契约：模块必须导出 { id, server: Plugin }（PluginModule 形状），
// 裸函数导出会导致加载器找不到 server 属性、插件不加载；
// 文件路径插件（file://，含 plugins/*.js 平铺安装）额外要求默认导出携带 id，否则加载器报 "Path plugin must export id"。
export const pluginModule: PluginModule = { id: "category-router", server: CategoryRouterPlugin }
export default pluginModule
