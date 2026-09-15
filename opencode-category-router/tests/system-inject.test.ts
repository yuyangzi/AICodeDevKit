import { describe, expect, test } from "vitest"
import { renderCategoryTable } from "../src/system-inject"
import { DEFAULT_CATEGORIES, type CategoryConfig } from "../src/category-config"

describe("renderCategoryTable", () => {
  test("includes every configured category name and the model column header", () => {
    const rendered = renderCategoryTable(DEFAULT_CATEGORIES)
    for (const name of Object.keys(DEFAULT_CATEGORIES)) {
      expect(rendered, name).toContain(name)
    }
    expect(rendered).toContain("默认模型")
  })

  test("teaches the native task tool and no longer mentions delegate_task", () => {
    const rendered = renderCategoryTable(DEFAULT_CATEGORIES)
    expect(rendered).toContain("task(subagent_type=")
    expect(rendered).not.toContain("delegate_task")
  })

  test("renders an arbitrary config without leaking defaults", () => {
    const config: CategoryConfig = { custom: { description: "自定义", model: "p/m", variant: "low" } }
    const rendered = renderCategoryTable(config)
    expect(rendered).toContain("`custom`")
    expect(rendered).toContain("p/m (low)")
    expect(rendered).not.toContain("deep")
  })

  test("escapes pipes and newlines in the description", () => {
    const config: CategoryConfig = { custom: { description: "a | b\nc", model: "p/m" } }
    const rendered = renderCategoryTable(config)
    expect(rendered).toContain("a \\| b c")
  })

  test("returns an empty string for zero categories", () => {
    expect(renderCategoryTable({})).toBe("")
  })
})
