import { describe, expect, test } from "vitest"
import { CATEGORIES, CATEGORY_NAMES } from "../src/categories"

describe("CATEGORIES", () => {
  const expected = ["visual-engineering", "ultrabrain", "deep", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]

  test("contains exactly the 8 builtin categories", () => {
    expect(Object.keys(CATEGORIES).sort()).toEqual([...expected].sort())
    expect(CATEGORY_NAMES).toEqual([...expected].sort())
  })

  test("every category has a preferred model in provider/model format", () => {
    for (const [name, cat] of Object.entries(CATEGORIES)) {
      expect(cat.model, name).toMatch(/^[^/]+\/[^/]+$/)
    }
  })

  test("every category has a non-empty fallback chain", () => {
    for (const [name, cat] of Object.entries(CATEGORIES)) {
      expect(cat.fallbackChain.length, name).toBeGreaterThan(0)
      for (const entry of cat.fallbackChain) {
        expect(entry.providers.length, name).toBeGreaterThan(0)
        expect(entry.model, name).toBeTruthy()
      }
    }
  })

  test("every category has a description", () => {
    for (const [name, cat] of Object.entries(CATEGORIES)) {
      expect(cat.description.trim().length, name).toBeGreaterThan(0)
    }
  })

  test("fallback chain first rung matches the preferred model + variant", () => {
    for (const [name, cat] of Object.entries(CATEGORIES)) {
      const first = cat.fallbackChain[0]
      // cat.model 是 provider/model 全串；fallbackChain 的 model 是裸模型名（对齐 omO CATEGORY_MODEL_REQUIREMENTS）
      expect(first.model, name).toBe(cat.model.split("/").slice(1).join("/"))
      expect(first.variant, name).toBe(cat.variant)
    }
  })

  test("deep and ultrabrain gate on GPT flagships via first rung", () => {
    expect(["deep", "ultrabrain"].every((n) => CATEGORIES[n].fallbackChain.some((e) => e.model === "gpt-6-astra" || e.model === "gpt-5.6-sol"))).toBe(true)
  })
})