import { describe, expect, test } from "vitest"
import { buildPromptBody } from "../src/subagent"

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