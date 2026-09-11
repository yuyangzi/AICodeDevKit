import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CATEGORY_WORKER_AGENT } from "../src/agent-definition"
import { pluginModule } from "../src/plugin"

type SessionOverrides = Record<string, unknown>

function makeClient(overrides: { session?: SessionOverrides } = {}) {
  const session = {
    create: async () => ({ data: { id: "ses-child" } }),
    prompt: async () => ({ data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } }),
    promptAsync: async () => ({ data: undefined }),
    messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "child result" }] }] }),
    delete: async () => ({}),
    ...(overrides.session ?? {}),
  }
  return { session }
}

type TestClient = ReturnType<typeof makeClient>

function start(client: TestClient, dir: string, options?: unknown) {
  return pluginModule.server(
    {
      client: client as never,
      directory: dir,
      worktree: dir,
      project: {} as never,
      experimental_workspace: {} as never,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    },
    options as never,
  )
}

const ctx = { sessionID: "ses-parent", abort: new AbortController().signal }

describe("CategoryRouterPlugin", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "category-router-plugin-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("config hook injects category-worker agent with delegate_task denied", async () => {
    const plugin = await start(makeClient(), dir)
    const config = {} as Record<string, unknown>
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(config)
    expect((config.agent as Record<string, unknown>)[CATEGORY_WORKER_AGENT.name]).toMatchObject({ mode: "subagent" })
  })

  test("sync mode prompts with the configured category model + variant", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      session: {
        create: async (a: unknown) => {
          calls.push({ method: "create", args: a })
          return { data: { id: "ses-child" } }
        },
        prompt: async (a: unknown) => {
          calls.push({ method: "prompt", args: a })
          return { data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } }
        },
      },
    })
    const options = { categories: { deep: { description: "deep work", model: "openai/gpt-6-astra", variant: "high" } } }
    const plugin = await start(client, dir, options)
    const result = await plugin.tool?.delegate_task?.execute(
      { category: "deep", prompt: "do x", run_in_background: false } as never,
      ctx as never,
    )
    expect(String(result)).toContain("child result")
    expect(calls[0]).toMatchObject({ method: "create", args: { body: { parentID: "ses-parent" } } })
    const promptCall = calls.find((c) => c.method === "prompt")?.args as { path: { id: string }; body: Record<string, unknown> }
    expect(promptCall.path.id).toBe("ses-child")
    expect(promptCall.body).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-6-astra" },
      variant: "high",
      agent: "category-worker",
      noReply: false,
    })
  })

  test("falls back to the bundled default template when no options are provided", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      session: {
        prompt: async (a: unknown) => {
          calls.push({ method: "prompt", args: a })
          return { data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } }
        },
      },
    })
    const plugin = await start(client, dir)
    const result = await plugin.tool?.delegate_task?.execute({ category: "deep", prompt: "do x" } as never, ctx as never)
    expect(String(result)).toContain("child result")
    const promptCall = calls[0]?.args as { body: Record<string, unknown> }
    expect(promptCall.body).toMatchObject({ model: { providerID: "openai", modelID: "gpt-6-astra" }, variant: "high" })
  })

  test("custom categories replace the defaults entirely", async () => {
    const plugin = await start(makeClient(), dir, {
      categories: { custom: { description: "custom", model: "p/m", variant: "low" } },
    })
    const toolDef = plugin.tool?.delegate_task
    expect(String(await toolDef?.execute({ category: "deep", prompt: "x" } as never, ctx as never))).toContain("Unknown category")
    expect(String(await toolDef?.execute({ category: "custom", prompt: "x" } as never, ctx as never))).toContain("child result")
  })

  test("rejects a category whose model has no provider prefix", async () => {
    const plugin = await start(makeClient(), dir, {
      categories: { bad: { description: "bad", model: "gpt-6-astra" } },
    })
    const result = await plugin.tool?.delegate_task?.execute({ category: "bad", prompt: "x" } as never, ctx as never)
    expect(String(result)).toContain("Invalid model")
  })

  test("unknown category returns an error listing available categories", async () => {
    const plugin = await start(makeClient(), dir)
    const result = await plugin.tool?.delegate_task?.execute({ category: "nope", prompt: "x" } as never, ctx as never)
    expect(String(result)).toContain("Unknown category")
    expect(String(result)).toContain("deep")
  })

  test("background mode returns task_id and registers the task", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      session: {
        create: async (a: unknown) => {
          calls.push({ method: "create", args: a })
          return { data: { id: "ses-bg" } }
        },
        promptAsync: async (a: unknown) => {
          calls.push({ method: "promptAsync", args: a })
          return { data: undefined }
        },
      },
    })
    const plugin = await start(client, dir)
    const result = await plugin.tool?.delegate_task?.execute(
      { category: "quick", prompt: "do y", run_in_background: true } as never,
      ctx as never,
    )
    expect(String(result)).toContain("task_id")
    expect(calls.some((c) => c.method === "promptAsync")).toBe(true)
  })

  test("system.transform injects the category table", async () => {
    const plugin = await start(makeClient(), dir)
    const output = { system: [] as string[] }
    const hook = plugin["experimental.chat.system.transform"] as (i: unknown, o: { system: string[] }) => Promise<void>
    await hook({}, output)
    expect(output.system.join("\n")).toContain("delegate_task")
    expect(output.system.join("\n")).toContain("deep")
  })

  test("event hook wakes the parent on child session.idle", async () => {
    const calls: Array<unknown> = []
    const client = makeClient({
      session: {
        promptAsync: async (a: unknown) => {
          calls.push(a)
          return { data: undefined }
        },
      },
    })
    const plugin = await start(client, dir)
    await plugin.tool?.delegate_task?.execute({ category: "deep", prompt: "do z", run_in_background: true } as never, ctx as never)
    const callsAfterStart = calls.length
    await (plugin.event as (i: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>)({
      event: { type: "session.idle", properties: { sessionID: "ses-child" } },
    })
    expect(calls.length).toBeGreaterThan(callsAfterStart)
  })

  test("event hook does not wake the parent when the child has no assistant reply", async () => {
    const calls: Array<unknown> = []
    const client = makeClient({
      session: {
        messages: async () => ({ data: [{ info: { role: "user" }, parts: [{ type: "text", text: "the task prompt" }] }] }),
        promptAsync: async (a: unknown) => {
          calls.push(a)
          return { data: undefined }
        },
      },
    })
    const plugin = await start(client, dir)
    await plugin.tool?.delegate_task?.execute({ category: "deep", prompt: "do w", run_in_background: true } as never, ctx as never)
    const callsAfterStart = calls.length
    await (plugin.event as (i: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>)({
      event: { type: "session.idle", properties: { sessionID: "ses-child" } },
    })
    expect(calls.length).toBe(callsAfterStart)
  })
})
