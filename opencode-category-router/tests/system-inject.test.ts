import { describe, expect, test } from "vitest"
import { renderCategoryTable } from "../src/system-inject"
import { DEFAULT_CATEGORIES, type CategoryConfig } from "../src/category-config"

describe("renderCategoryTable", () => {
  test("includes every configured category name", () => {
    const rendered = renderCategoryTable(DEFAULT_CATEGORIES)
    for (const name of Object.keys(DEFAULT_CATEGORIES)) {
      expect(rendered, name).toContain(name)
    }
  })

  test("mentions delegate_task tool and the default model column header", () => {
    const rendered = renderCategoryTable(DEFAULT_CATEGORIES)
    expect(rendered).toContain("delegate_task")
    expect(rendered).toContain("默认模型")
  })

  test("renders an arbitrary config without leaking default categories", () => {
    const config: CategoryConfig = { custom: { description: "自定义", model: "p/m", variant: "low" } }
    const rendered = renderCategoryTable(config)
    expect(rendered).toContain("`custom`")
    expect(rendered).toContain("p/m (low)")
    expect(rendered).not.toContain("deep")
  })
})
