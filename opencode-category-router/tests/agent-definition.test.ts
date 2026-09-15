import { describe, expect, test, vi, afterEach } from "vitest"
import { CATEGORY_AGENT_TOOLS, SHARED_AGENT_PROMPT, buildCategoryAgent, planCategoryAgents } from "../src/agent-definition"

afterEach(() => {
  vi.restoreAllMocks()
})

const parsedDeep = { providerID: "openai", modelID: "gpt-6-astra", variant: "high" }

describe("buildCategoryAgent", () => {
  test("maps a category to a subagent definition", () => {
    const agent = buildCategoryAgent("deep", { description: "deep work", model: "openai/gpt-6-astra", variant: "high" }, parsedDeep)
    expect(agent).toMatchObject({
      description: "deep work",
      mode: "subagent",
      model: "openai/gpt-6-astra",
      variant: "high",
    })
  })

  test("omits variant when neither the category nor the model string carries one", () => {
    const agent = buildCategoryAgent("quick", { description: "quick", model: "a/b" }, { providerID: "a", modelID: "b" })
    expect(agent).not.toHaveProperty("variant")
  })

  test("core tools enabled and task denied", () => {
    const agent = buildCategoryAgent("deep", { description: "d", model: "a/b" }, { providerID: "a", modelID: "b" })
    for (const toolName of ["read", "grep", "glob", "edit", "bash", "ls"] as const) {
      expect(agent.tools[toolName], toolName).toBe(true)
    }
    expect(agent.tools.task).toBe(false)
  })

  test("prompt is non-empty and contains neither category-worker nor delegate_task", () => {
    const agent = buildCategoryAgent("deep", { description: "d", model: "a/b" }, { providerID: "a", modelID: "b" })
    expect(agent.prompt.trim().length).toBeGreaterThan(50)
    expect(agent.prompt).not.toContain("category-worker")
    expect(agent.prompt).not.toContain("delegate_task")
    expect(agent.prompt).toContain("deep")
  })
})

describe("planCategoryAgents", () => {
  test("returns one agent per parseable category and mirrors the injected set", () => {
    const { agents, injected } = planCategoryAgents({
      deep: { description: "d", model: "openai/gpt-6-astra", variant: "high" },
      quick: { description: "q", model: "kimi/highspeed" },
    })
    expect(Object.keys(agents).sort()).toEqual(["deep", "quick"])
    expect(Object.keys(injected).sort()).toEqual(["deep", "quick"])
  })

  test("skips a category whose model lacks a provider prefix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { agents, injected } = planCategoryAgents({
      deep: { description: "d", model: "openai/gpt-6-astra" },
      broken: { description: "b", model: "no-provider" },
    })
    expect(Object.keys(agents)).toEqual(["deep"])
    expect(Object.keys(injected)).toEqual(["deep"])
    expect(warn).toHaveBeenCalled()
  })
})

describe("SHARED_AGENT_PROMPT / CATEGORY_AGENT_TOOLS", () => {
  test("template carries the category placeholder and no stale tool name", () => {
    expect(SHARED_AGENT_PROMPT).toContain("{{CATEGORY}}")
    expect(SHARED_AGENT_PROMPT).not.toContain("delegate_task")
  })

  test("default tools deny task", () => {
    expect(CATEGORY_AGENT_TOOLS.task).toBe(false)
  })
})
