import { describe, expect, test } from "vitest"
import { fuzzyMatchModel, parseModelString, parseVariantFromModelID, isModelAvailable } from "../src/model-utils"

describe("fuzzyMatchModel", () => {
  test("exact match wins", () => {
    const available = new Set(["openai/gpt-5.6-sol", "openai/gpt-5.4"])
    expect(fuzzyMatchModel("openai/gpt-5.6-sol", available)).toBe("openai/gpt-5.6-sol")
  })

  test("shortest substring match wins", () => {
    const available = new Set(["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4-6-xhigh"])
    expect(fuzzyMatchModel("anthropic/claude-sonnet-4-6", available)).toBe("anthropic/claude-sonnet-4-6")
  })

  test("provider filter narrows candidates", () => {
    const available = new Set(["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"])
    expect(fuzzyMatchModel("gpt-5.4", available, ["openai"])).toBe("openai/gpt-5.4")
    expect(fuzzyMatchModel("gpt-5.4", available, ["anthropic"])).toBeNull()
  })

  test("empty available returns null", () => {
    expect(fuzzyMatchModel("x/y", new Set())).toBeNull()
  })
})

describe("parseModelString", () => {
  test("parses provider/model with variant suffix", () => {
    expect(parseModelString("openai/gpt-5.6-sol:high")).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol", variant: "high" })
  })

  test("parses provider/model with space variant", () => {
    expect(parseModelString("openai/gpt-5.4 high")).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
  })

  test("bare model without provider returns undefined", () => {
    expect(parseModelString("gpt-5.4")).toBeUndefined()
  })
})

describe("isModelAvailable", () => {
  test("true when fuzzy match exists", () => {
    expect(isModelAvailable("openai/gpt-5.6-sol", new Set(["openai/gpt-5.6-sol-preview"]))).toBe(true)
  })
})