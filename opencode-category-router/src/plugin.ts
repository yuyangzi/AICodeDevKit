import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { loadCategoryConfig, parseCategoryModel } from "./category-config"
import { buildPromptBody, TaskRegistry, type RegisteredTask, type MessagesClient } from "./subagent"
import { CATEGORY_WORKER_AGENT } from "./agent-definition"
import { renderCategoryTable } from "./system-inject"

function extractText(parts: Array<{ type?: string; text?: string }> | undefined): string {
  return (parts ?? []).filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n").trim()
}

export const CategoryRouterPlugin: Plugin = async ({ client, directory, worktree }, options) => {
  const projectRoot = worktree ?? directory
  const registry = new TaskRegistry(projectRoot)
  await registry.load()

  // 分类配置来自 opencode.json 的 plugin 二元组 options；缺失或非法时回落到内置默认模板。
  const categories = loadCategoryConfig(options)
  const categoryNames = Object.keys(categories).sort()

  const notifyParent = async (task: RegisteredTask, failed: boolean): Promise<void> => {
    const status = failed ? "失败" : "完成"
    const text = `[delegate_task] 后台任务 ${status} (task_id=${task.taskId}, category=${task.category})`
    await client.session.promptAsync({
      path: { id: task.parentID },
      body: { parts: [{ type: "text", text }], noReply: false },
    })
  }

  // 简化 busy 判定：MVP 统一 reply-required；父会话 busy 时 noReply:true 降级作为后续增强
  await registry.reconcile(client as MessagesClient, notifyParent)

  return {
    tool: {
      delegate_task: tool({
        description: `按任务类别派发子任务到对应模型执行。类别可选：${categoryNames.join(", ")}。指定工作类型，不要手动选模型。`,
        args: {
          category: tool.schema.string().describe("任务类别（见可用类别表）"),
          prompt: tool.schema.string().describe("任务描述，以明确目标形式给出"),
          run_in_background: tool.schema.boolean().optional().describe("后台运行并立即返回 task_id（默认 false）"),
          description: tool.schema.string().optional().describe("任务展示标题"),
        },
        async execute(args, context) {
          const categoryName = args.category
          const category = categories[categoryName]
          if (!category) {
            return `Unknown category "${categoryName}". Available: ${categoryNames.join(", ")}`
          }

          const model = parseCategoryModel(category)
          if (!model) {
            return `Invalid model for category "${categoryName}": ${category.model} (expected provider/model)`
          }

          const created = await client.session.create({ body: { parentID: context.sessionID, title: args.description } })
          const sessionID = created?.data?.id
          if (!sessionID) return "Failed to create child session"

          const body = buildPromptBody(
            { providerID: model.providerID, modelID: model.modelID },
            model.variant,
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
              // promptAsync 抛错时返回失败状态，不阻塞编排者
              return `Background task failed to start (category=${categoryName}) for task_id=${taskId}`
            }
            return `Background task started. task_id=${taskId} category=${categoryName}.`
          }

          // 父会话中断（ESC）时中止子会话，避免孤儿任务继续烧 token
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
      // 与 reconcile 同 gate：仅当最后一条是 assistant 回复才视为完成，
      // 被掐断的子会话只有 user prompt，不得误报"完成"。
      if (!last?.info || last.info.role !== "assistant") return
      const failed = Boolean(last.info.error)
      try {
        await notifyParent(task, failed)
        await registry.markNotified(sessionID, failed)
      } catch {
        // 尽力而为：通知失败不标记，留待后续 event/reconcile 重试
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(renderCategoryTable(categories))
    },

    config: async (config) => {
      const cfg = config as Record<string, unknown>
      const agents = (cfg.agent ?? {}) as Record<string, unknown>
      const existing = agents[CATEGORY_WORKER_AGENT.name] as { tools?: Record<string, boolean> } | undefined
      // 浅合并 + tools 深层合并：用户 JSONC 已定制的 category-worker（如放开 delegate_task）不被插件默认值踩掉
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
