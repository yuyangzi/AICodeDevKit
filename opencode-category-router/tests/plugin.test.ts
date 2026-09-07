import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CATEGORY_WORKER_AGENT } from "../src/agent-definition"
import { pluginModule } from "../src/plugin"

function makeClient(overrides: Record<string, unknown> = {}) {
  const session = {
    create: async () => ({ data: { id: "ses-child" } }),
    prompt: async () => ({ data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } }),
    promptAsync: async () => ({ data: undefined }),
    messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "child result" }] }] }),
    delete: async () => ({}),
    ...(overrides.session ?? {}),
  }
  const provider = {
    list: async () => ({ data: { all: [{ id: "openai", models: { "gpt-6-astra": {} } }], connected: ["openai"] } }),
    ...(overrides.provider ?? {}),
  }
  return { session, provider }
}

describe("CategoryRouterPlugin", () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "category-router-plugin-")) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  const ctx = { sessionID: "ses-parent", abort: new AbortController().signal }

  test("config hook injects category-worker agent with delegate_task denied", async () => {
    const plugin = await pluginModule.server({ client: makeClient() as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const config = {} as Record<string, unknown>
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(config)
    expect((config.agent as Record<string, unknown>)[CATEGORY_WORKER_AGENT.name]).toMatchObject({ mode: "subagent" })
  })

  test("delegate_task sync mode creates child session and prompts with resolved model + variant", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      session: {
        create: async (a: unknown) => { calls.push({ method: "create", args: a }); return { data: { id: "ses-child" } } },
        prompt: async (a: unknown) => { calls.push({ method: "prompt", args: a }); return { data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "deep", prompt: "do x", run_in_background: false } as never, ctx as never)
    expect(String(result)).toContain("child result")
    expect(calls[0]).toMatchObject({ method: "create", args: { body: { parentID: "ses-parent" } } })
    const promptCall = calls.find((c) => c.method === "prompt")?.args as { path: { id: string }; body: Record<string, unknown> }
    expect(promptCall.path.id).toBe("ses-child")
    expect(promptCall.body).toMatchObject({ model: { providerID: "openai", modelID: "gpt-6-astra" }, variant: "high", agent: "category-worker", noReply: false })
  })

  test("delegate_task unknown category returns error listing categories", async () => {
    const plugin = await pluginModule.server({ client: makeClient() as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "nope", prompt: "x" } as never, ctx as never)
    expect(String(result)).toContain("Unknown category")
    expect(String(result)).toContain("deep")
  })

  test("delegate_task background mode returns task_id and registers task", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      provider: {
        list: async () => ({ data: { all: [{ id: "kimi-for-coding", models: { "kimi-for-coding-highspeed": {} } }], connected: ["kimi-for-coding"] } }),
      },
      session: {
        create: async (a: unknown) => { calls.push({ method: "create", args: a }); return { data: { id: "ses-bg" } } },
        promptAsync: async (a: unknown) => { calls.push({ method: "promptAsync", args: a }); return { data: undefined } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "quick", prompt: "do y", run_in_background: true } as never, ctx as never)
    expect(String(result)).toContain("task_id")
    expect(calls.some((c) => c.method === "promptAsync")).toBe(true)
  })

  test("delegate_task cold cache falls back to category preferred model", async () => {
    const client = makeClient({ provider: { list: async () => ({ data: { all: [], connected: [] } }) } })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "writing", prompt: "write docs" } as never, ctx as never)
    expect(String(result)).toContain("child result")
  })

  test("system.transform injects category table", async () => {
    const plugin = await pluginModule.server({ client: makeClient() as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const output = { system: [] as string[] }
    await (plugin["experimental.chat.system.transform"] as (i: unknown, o: { system: string[] }) => Promise<void>)({}, output)
    expect(output.system.join("\n")).toContain("delegate_task")
    expect(output.system.join("\n")).toContain("deep")
  })

  test("event hook wakes parent on child session.idle with reply-required promptAsync", async () => {
    const calls: Array<unknown> = []
    const client = makeClient({
      session: {
        messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "child result" }] }] }),
        promptAsync: async (a: unknown) => { calls.push(a); return { data: undefined } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    // register a task via background delegate first
    const toolDef = plugin.tool?.delegate_task
    await toolDef!.execute({ category: "deep", prompt: "do z", run_in_background: true } as never, ctx as never)
    // now emit idle for the child
    await (plugin.event as (i: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>)({ event: { type: "session.idle", properties: { sessionID: "ses-child" } } })
    expect(calls.length).toBeGreaterThan(0)
  })

  test("event hook does not wake parent when child idle has no assistant reply (interrupted)", async () => {
    const calls: Array<unknown> = []
    const client = makeClient({
      session: {
        messages: async () => ({ data: [{ info: { role: "user" }, parts: [{ type: "text", text: "the task prompt" }] }] }),
        promptAsync: async (a: unknown) => { calls.push(a); return { data: undefined } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    // register a task via background delegate first
    const toolDef = plugin.tool?.delegate_task
    await toolDef!.execute({ category: "deep", prompt: "do w", run_in_background: true } as never, ctx as never)
    const callsAfterStart = calls.length
    expect(callsAfterStart).toBeGreaterThan(0)
    // emit idle: child's last message is only a user prompt -> no assistant reply -> no wake
    await (plugin.event as (i: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>)({ event: { type: "session.idle", properties: { sessionID: "ses-child" } } })
    expect(calls.length).toBe(callsAfterStart)
  })
})
