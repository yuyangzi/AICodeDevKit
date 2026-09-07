import { describe, expect, test } from "vitest"
import { resolveAvailableModels, buildPromptBody } from "../src/subagent"

describe("resolveAvailableModels", () => {
  test("#given provider.list with connected providers #then aggregates connected models only", async () => {
    const client = {
      provider: {
        list: async () => ({
          data: {
            all: [
              { id: "openai", models: { "gpt-5.6-sol": {}, "gpt-5.4": {} } },
              { id: "anthropic", models: { "claude-sonnet-4-6": {} } },
              { id: "disconnected-provider", models: { "foo-1": {} } },
            ],
            connected: ["openai", "anthropic"],
          },
        }),
      },
    }
    const models = await resolveAvailableModels(client as never)
    expect(models).toEqual(new Set(["openai/gpt-5.6-sol", "openai/gpt-5.4", "anthropic/claude-sonnet-4-6"]))
  })

  test("#given provider.list fails #then returns empty set", async () => {
    const client = { provider: { list: async () => { throw new Error("boom") } } }
    const models = await resolveAvailableModels(client as never)
    expect(models.size).toBe(0)
  })
})

describe("buildPromptBody", () => {
  test("#given model and variant #then body carries top-level variant", () => {
    const body = buildPromptBody({ providerID: "openai", modelID: "gpt-6-astra" }, "high", {
      agent: "category-worker",
      parts: [{ type: "text", text: "hello" }],
      noReply: false,
    })
    expect(body).toMatchObject({ model: { providerID: "openai", modelID: "gpt-6-astra" }, variant: "high", agent: "category-worker", noReply: false })
  })
})