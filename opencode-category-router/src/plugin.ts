import { type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { loadCategoryConfig } from "./category-config"
import { planCategoryAgents, type CategoryAgentDefinition } from "./agent-definition"
import { renderCategoryTable } from "./system-inject"

/**
 * 合并插件默认 agent 与用户 JSONC 同名 agent：
 * - 用户字段逐一覆盖默认值；
 * - tools 采用用户提供的键值；唯一例外是递归闸门 `task`——
 *   除非用户显式写了 `task` 键，否则强制补 `task:false`（spec §4.1/§4.2）。
 */
function mergeAgent(
  defaultAgent: CategoryAgentDefinition,
  userAgent: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!userAgent) return { ...defaultAgent }
  const userTools = userAgent.tools as Record<string, boolean> | undefined
  const tools = userTools
    ? { ...userTools, ...(Object.hasOwn(userTools, "task") ? {} : { task: false }) }
    : defaultAgent.tools
  return { ...defaultAgent, ...userAgent, tools }
}

export const CategoryRouterPlugin: Plugin = async (_input, options) => {
  const { agents, injected } = planCategoryAgents(loadCategoryConfig(options))
  const categoryNames = Object.keys(injected)

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (categoryNames.length === 0) return
      output.system.push(renderCategoryTable(injected))
    },

    config: async (config) => {
      if (Object.keys(agents).length === 0) return
      const cfg = config as Record<string, unknown>
      const existing = (cfg.agent ?? {}) as Record<string, Record<string, unknown> | undefined>
      for (const [name, agent] of Object.entries(agents)) {
        existing[name] = mergeAgent(agent, existing[name])
      }
      cfg.agent = existing
    },
  }
}

// opencode 插件加载契约：模块必须导出 { id, server: Plugin }（PluginModule 形状），
// 裸函数导出会导致加载器找不到 server 属性、插件不加载；
// 文件路径插件（file://，含 plugins/*.js 平铺安装）额外要求默认导出携带 id。
export const pluginModule: PluginModule = { id: "category-router", server: CategoryRouterPlugin }
export default pluginModule
