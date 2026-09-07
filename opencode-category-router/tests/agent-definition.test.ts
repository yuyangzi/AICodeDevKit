import { describe, expect, test } from "vitest"
import { CATEGORY_WORKER_AGENT } from "../src/agent-definition"

describe("CATEGORY_WORKER_AGENT", () => {
  test("mode is subagent and name is category-worker", () => {
    expect(CATEGORY_WORKER_AGENT.name).toBe("category-worker")
    expect(CATEGORY_WORKER_AGENT.mode).toBe("subagent")
  })
  test("core tools enabled", () => {
    for (const toolName of ["read", "grep", "glob", "edit", "bash"] as const) {
      expect(CATEGORY_WORKER_AGENT.tools[toolName], toolName).toBe(true)
    }
  })
  test("delegate_task denied by default (no self-dispatch)", () => {
    expect(CATEGORY_WORKER_AGENT.tools.delegate_task).toBe(false)
  })
  test("prompt is non-empty", () => {
    expect(CATEGORY_WORKER_AGENT.prompt.trim().length).toBeGreaterThan(50)
  })
})