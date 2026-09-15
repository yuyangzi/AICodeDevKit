import { describe, expect, test, vi, afterEach } from "vitest"
import { DEFAULT_CATEGORIES, loadCategoryConfig, parseCategoryModel, sanitizeConfig } from "../src/category-config"

function silencedWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "warn").mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

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
  test("uses bundled defaults when the categories option is absent", () => {
    expect(loadCategoryConfig(undefined)).toEqual(DEFAULT_CATEGORIES)
    expect(loadCategoryConfig({})).toEqual(DEFAULT_CATEGORIES)
  })

  test("does not warn when categories are absent", () => {
    const warn = silencedWarn()
    loadCategoryConfig(undefined)
    loadCategoryConfig({})
    expect(warn).not.toHaveBeenCalled()
  })

  test("uses user categories when valid", () => {
    const config = loadCategoryConfig({
      categories: { custom: { description: "c", model: "openai/gpt-6-astra", variant: "high" } },
    })
    expect(Object.keys(config)).toEqual(["custom"])
    expect(config.custom).toEqual({ description: "c", model: "openai/gpt-6-astra", variant: "high" })
  })

  test("falls back to defaults and warns when categories is not an object", () => {
    const warn = silencedWarn()
    expect(loadCategoryConfig({ categories: "nope" })).toEqual(DEFAULT_CATEGORIES)
    expect(loadCategoryConfig({ categories: ["a"] })).toEqual(DEFAULT_CATEGORIES)
    expect(warn).toHaveBeenCalled()
  })

  test("treats an explicit empty table as disabling all categories", () => {
    const warn = silencedWarn()
    expect(loadCategoryConfig({ categories: {} })).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  test("skips a malformed single entry and keeps the rest", () => {
    const warn = silencedWarn()
    const config = loadCategoryConfig({
      categories: {
        ok: { description: "good", model: "openai/gpt-6-astra" },
        bad: { model: "no-description" } as never,
      },
    })
    expect(Object.keys(config)).toEqual(["ok"])
    expect(warn).toHaveBeenCalled()
  })

  test("skips an entry whose name is not a valid agent name", () => {
    const warn = silencedWarn()
    const config = loadCategoryConfig({
      categories: { "bad name": { description: "d", model: "a/b" } },
    })
    expect(config).toEqual({})
    expect(warn).toHaveBeenCalled()
  })
})

describe("sanitizeConfig", () => {
  test("strips unknown fields such as fallbackChain", () => {
    const out = sanitizeConfig({ x: { description: "d", model: "a/b", variant: "low", fallbackChain: [] } })
    expect(out).toEqual({ x: { description: "d", model: "a/b", variant: "low" } })
  })

  test("skips a __proto__ category name instead of yielding undefined", () => {
    const input = JSON.parse('{"__proto__": {"description": "d", "model": "a/b"}}')
    const warn = silencedWarn()
    expect(sanitizeConfig(input)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  test("returns undefined for non-object or array input", () => {
    expect(sanitizeConfig("nope")).toBeUndefined()
    expect(sanitizeConfig(["a"])).toBeUndefined()
    expect(sanitizeConfig(null)).toBeUndefined()
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
