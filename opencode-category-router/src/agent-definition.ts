import { parseCategoryModel, type CategoryConfig, type CategoryDef, type ParsedCategoryModel } from "./category-config"

/** 共享执行 prompt；`{{CATEGORY}}` 由 buildCategoryAgent 替换为类别名。 */
export const SHARED_AGENT_PROMPT = `你是类别 "{{CATEGORY}}" 的工作代理，被编排者以明确目标派发到独立会话中。

执行纪律：
1. 先探索理解，再动手。需要时使用 grep/glob/read 收集上下文。
2. 以目标为授权：不要等待确认，选择你认为最合理的方案并完成它。
3. 记录假设：无法验证的假设在最终回复中写明。
4. 完成即交付：最终回复包含做了什么、证据（命令/测试输出）、遗留假设。
5. 不提问：问题会中断任务。除非遇到不可绕过的阻塞（缺密钥、唯一依赖用户决策）。
6. 禁止派生下级子代理：不要调用 task 或任何子任务派发工具。`

/** 类别 agent 默认工具集；task 默认 deny 作为防递归主闸门。 */
export const CATEGORY_AGENT_TOOLS: Record<string, boolean> = {
  read: true,
  grep: true,
  glob: true,
  edit: true,
  bash: true,
  ls: true,
  task: false,
}

export interface CategoryAgentDefinition {
  description: string
  mode: "subagent"
  model: string
  variant?: string
  prompt: string
  tools: Record<string, boolean>
}

export function buildCategoryAgent(name: string, def: CategoryDef, parsed: ParsedCategoryModel): CategoryAgentDefinition {
  return {
    description: def.description,
    mode: "subagent",
    model: `${parsed.providerID}/${parsed.modelID}`,
    ...(parsed.variant !== undefined ? { variant: parsed.variant } : {}),
    prompt: SHARED_AGENT_PROMPT.replace("{{CATEGORY}}", name),
    tools: { ...CATEGORY_AGENT_TOOLS },
  }
}

/**
 * 把类别表编译为 agent 定义，并返回真正成功注入的子集 `injected`，
 * 供 system-inject 只渲染"确实存在 agent"的类别（spec §5.2）。
 */
export function planCategoryAgents(categories: CategoryConfig): {
  agents: Record<string, CategoryAgentDefinition>
  injected: CategoryConfig
} {
  const agents: Record<string, CategoryAgentDefinition> = {}
  const injected: CategoryConfig = {}
  for (const [name, def] of Object.entries(categories)) {
    const parsed = parseCategoryModel(def)
    if (!parsed) {
      console.warn(`[category-router] 类别 "${name}" 的 model 非法（需 provider/model），已跳过`)
      continue
    }
    agents[name] = buildCategoryAgent(name, def, parsed)
    injected[name] = def
  }
  return { agents, injected }
}
