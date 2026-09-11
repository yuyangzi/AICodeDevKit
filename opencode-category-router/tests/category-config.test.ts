import { describe, expect, test, vi } from "vitest"
import { DEFAULT_CATEGORIES, loadCategoryConfig, parseCategoryModel, sanitizeConfig } from "../src/category-config"

function silencedWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "warn").mockImplementation(() => {})
}

const expectedNames = [
  "artistry",
  "deep",
  "quick",
  "ultrabrain",
  "unspecified-high",
  "unspecified-low",
  "visual-engineering",
  "writing",
]

describe("DEFAULT_CATEGORIES", () => {
  test("contains exactly the 8 builtin categories", () => {
    expect(Object.keys(DEFAULT_CATEGORIES).sort()).toEqual(expectedNames)
  })

  test("every category has a provider/model and no fallback chain", () => {
    for (const [name, cat] of Object.entries(DEFAULT_CATEGORIES)) {
      expect(cat.model, name).toMatch(/^[^/]+\/[^/]+$/)
      expect(cat.description.trim().length, name).toBeGreaterThan(0)
      expect(cat, name).not.toHaveProperty("fallbackChain")
    }
  })
})

describe("loadCategoryConfig", () => {
  test("uses bundled defaults when options are absent", () => {
    expect(loadCategoryConfig(undefined)).toEqual(DEFAULT_CATEGORIES)
    expect(loadCategoryConfig({})).toEqual(DEFAULT_CATEGORIES)
  })

  test("uses user categories when valid", () => {
    const config = loadCategoryConfig({
      categories: { custom: { description: "c", model: "openai/gpt-6-astra", variant: "high" } },
    })
    expect(Object.keys(config)).toEqual(["custom"])
    expect(config.custom).toEqual({ description: "c", model: "openai/gpt-6-astra", variant: "high" })
  })

  test("falls back to defaults and warns when categories are malformed", () => {
    const warn = silencedWarn()
    expect(loadCategoryConfig({ categories: { bad: { model: "no-provider" } } })).toEqual(DEFAULT_CATEGORIES)
    expect(loadCategoryConfig({ categories: {} })).toEqual(DEFAULT_CATEGORIES)
    expect(loadCategoryConfig({ categories: "nope" })).toEqual(DEFAULT_CATEGORIES)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  test("does not warn when categories are absent", () => {
    const warn = silencedWarn()
    loadCategoryConfig(undefined)
    loadCategoryConfig({})
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("sanitizeConfig", () => {
  test("strips unknown fields such as fallbackChain", () => {
    const out = sanitizeConfig({ x: { description: "d", model: "a/b", variant: "low", fallbackChain: [] } })
    expect(out).toEqual({ x: { description: "d", model: "a/b", variant: "low" } })
  })

  test("rejects a __proto__ category name", () => {
    const input = JSON.parse('{"__proto__": {"description": "d", "model": "a/b"}}')
    expect(sanitizeConfig(input)).toBeUndefined()
  })
})

describe("parseCategoryModel", () => {
  test("splits provider/model and keeps configured variant", () => {
    expect(parseCategoryModel({ description: "d", model: "openai/gpt-6-astra", variant: "high" })).toEqual({
      providerID: "openai",
      modelID: "gpt-6-astra",
      variant: "high",
    })
  })

  test("falls back to the model-embedded variant", () => {
    expect(parseCategoryModel({ description: "d", model: "openai/gpt-6-astra:max" })).toEqual({
      providerID: "openai",
      modelID: "gpt-6-astra",
      variant: "max",
    })
  })

  test("configured variant wins over the embedded one", () => {
    expect(parseCategoryModel({ description: "d", model: "openai/gpt-6-astra:max", variant: "low" })).toEqual({
      providerID: "openai",
      modelID: "gpt-6-astra",
      variant: "low",
    })
  })

  test("returns undefined without a provider prefix", () => {
    expect(parseCategoryModel({ description: "d", model: "gpt-6-astra" })).toBeUndefined()
  })
})
