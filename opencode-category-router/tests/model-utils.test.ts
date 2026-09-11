import { describe, expect, test } from "vitest"
import { parseModelString } from "../src/model-utils"

describe("parseModelString", () => {
  test("parses provider/model with variant suffix", () => {
    expect(parseModelString("openai/gpt-5.6-sol:high")).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol", variant: "high" })
  })

  test("parses provider/model with space variant", () => {
    expect(parseModelString("openai/gpt-5.4 high")).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
  })

  test("keeps the :max suffix for provider-prefixed models", () => {
    expect(parseModelString("openai/gpt-6-astra:max")).toEqual({ providerID: "openai", modelID: "gpt-6-astra", variant: "max" })
  })

  test("parses a parenthesized variant", () => {
    expect(parseModelString("openai/gpt-5.4(high)")).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
  })

  test("bare model without provider returns undefined", () => {
    expect(parseModelString("gpt-5.4")).toBeUndefined()
  })
})
