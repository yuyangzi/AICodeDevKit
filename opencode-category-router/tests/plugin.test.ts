import { describe, expect, test, vi, afterEach } from "vitest"
import { pluginModule } from "../src/plugin"

afterEach(() => {
  vi.restoreAllMocks()
})

function start(options?: unknown) {
  return pluginModule.server(
    {
      client: {} as never,
      directory: "/tmp",
      worktree: "/tmp",
      project: {} as never,
      experimental_workspace: {} as never,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    },
    options as never,
  )
}

type ConfigHook = (config: Record<string, unknown>) => Promise<void>
type TransformHook = (input: unknown, output: { system: string[] }) => Promise<void>

describe("CategoryRouterPlugin", () => {
  test("config hook injects one subagent per category with model and variant", async () => {
    const plugin = await start({
      categories: { deep: { description: "deep work", model: "openai/gpt-6-astra", variant: "high" } },
    })
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    const agent = (config.agent as Record<string, Record<string, unknown>>).deep
    expect(agent).toMatchObject({ mode: "subagent", model: "openai/gpt-6-astra", variant: "high", description: "deep work" })
    expect((agent.tools as Record<string, boolean>).task).toBe(false)
  })

  test("falls back to the bundled defaults when no options are provided", async () => {
    const plugin = await start()
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    const names = Object.keys(config.agent as Record<string, unknown>)
    expect(names).toContain("deep")
    expect(names).toContain("quick")
    expect(names.length).toBe(8)
  })

  test("explicit empty categories disable all agents", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const plugin = await start({ categories: {} })
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    expect(config.agent).toBeUndefined()
    const output = { system: [] as string[] }
    await (plugin["experimental.chat.system.transform"] as TransformHook)({}, output)
    expect(output.system).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  test("skips a category whose model lacks a provider prefix", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const plugin = await start({
      categories: {
        deep: { description: "d", model: "openai/gpt-6-astra" },
        broken: { description: "b", model: "no-provider" },
      },
    })
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    const names = Object.keys(config.agent as Record<string, unknown>)
    expect(names).toEqual(["deep"])
    expect(warn).toHaveBeenCalled()
  })

  test("user override keeps its own tool keys and still forces task:false", async () => {
    const plugin = await start({ categories: { deep: { description: "d", model: "openai/gpt-6-astra" } } })
    const config: Record<string, unknown> = {
      agent: { deep: { tools: { read: true }, description: "mine" } },
    }
    await (plugin.config as ConfigHook)(config)
    const agent = (config.agent as Record<string, Record<string, unknown>>).deep
    expect(agent.description).toBe("mine")
    expect(agent.mode).toBe("subagent")
    expect(agent.tools).toEqual({ read: true, task: false })
  })

  test("user may explicitly re-enable task for a same-named agent", async () => {
    const plugin = await start({ categories: { deep: { description: "d", model: "openai/gpt-6-astra" } } })
    const config: Record<string, unknown> = { agent: { deep: { tools: { task: true } } } }
    await (plugin.config as ConfigHook)(config)
    const agent = (config.agent as Record<string, Record<string, unknown>>).deep
    expect(agent.tools).toEqual({ task: true })
  })

  test("system.transform injects the category table with the native task call", async () => {
    const plugin = await start()
    const output = { system: [] as string[] }
    await (plugin["experimental.chat.system.transform"] as TransformHook)({}, output)
    const text = output.system.join("\n")
    expect(text).toContain("task(subagent_type=")
    expect(text).toContain("deep")
    expect(text).not.toContain("delegate_task")
  })

  test("does not expose the removed tool or event hooks", async () => {
    const plugin = await start()
    expect((plugin as Record<string, unknown>).tool).toBeUndefined()
    expect((plugin as Record<string, unknown>).event).toBeUndefined()
  })
})
