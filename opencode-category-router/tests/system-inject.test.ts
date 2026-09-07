import { describe, expect, test } from "vitest"
import { renderCategoryTable } from "../src/system-inject"

describe("renderCategoryTable", () => {
  test("includes every builtin category name", () => {
    const rendered = renderCategoryTable()
    for (const name of ["visual-engineering", "ultrabrain", "deep", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]) {
      expect(rendered, name).toContain(name)
    }
  })
  test("mentions delegate_task tool", () => {
    expect(renderCategoryTable()).toContain("delegate_task")
  })
  test("includes default model column header", () => {
    expect(renderCategoryTable()).toContain("默认模型")
  })
})