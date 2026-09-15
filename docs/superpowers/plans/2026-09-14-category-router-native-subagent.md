# 类别路由插件改造（类别 subagent + 原生 task）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 opencode-category-router 从"自研 `delegate_task` 派发器"改造为"每类别注册一个同名 `mode:"subagent"` agent，由编排者调用原生 `task(subagent_type=...)`"，从而获得原生可点击子代理卡片。

**Architecture:** 插件只保留两个 hook——`config` 把类别映射为 subagent 定义并注入，`experimental.chat.system.transform` 注入类别表并教编排者用原生 `task`。子会话创建/运行/后台/权限/深度全部交给 opencode 原生 `task`。自研 `delegate_task` 工具、`TaskRegistry`、`subagent.ts`、`event` 唤醒 hook 全部删除。

**Tech Stack:** TypeScript（strict, ESNext）+ vitest + esbuild + `@opencode-ai/plugin`。Node 工具链（npm），`src/` 只用 `node:*` 与标准 API。

**Spec:** `docs/superpowers/specs/2026-09-14-category-router-native-subagent.md`（已通过两轮 design-critic 审查）

## Global Constraints

- 全程中文：commit message、注释、文档用中文；代码标识符与文件名保持英文。
- 只在 `opencode-category-router/` 内改动；不动 `docs/superpowers/`、`agents/`、`commands/`、`.worktrees/`。
- `src/` 禁止引入 Bun API，只用 `node:*` 与平台无关标准 API；测试用 vitest（不用 `bun:test`）。
- 配置语义（spec §5.3）：`categories` 缺失 → 内置默认；非对象/数组 → 内置默认 + warn；显式 `{}` → 禁用全部（不注入、不回落）+ warn；单条非法 → 仅跳过该条 + warn。
- 类别名约束：`^[A-Za-z0-9][A-Za-z0-9._-]*$`，另有 `__proto__` 禁名（spec §4.4）。
- 递归闸门不变量（spec §4.1/§4.2）：类别 agent 的 `tools.task` 除非用户显式写 `task`，否则一律为 `false`。
- 类别表数据源 = 成功注入的类别集（spec §5.2）；零类别时不注入表格与尾注。
- 注入文案面向编排者，不得再出现 `delegate_task`；共享 prompt 不得再出现 `category-worker` / `delegate_task`（spec §4.3）。
- 每完成一个 Task 跑一次 `cd opencode-category-router && npm test`，并提交。
- 除非用户明确要求，不要 push；只做本地 commit。

---

### Task 1: category-config 语义改造（逐条校验 + 空表禁用）

**Files:**
- Modify: `opencode-category-router/src/category-config.ts`（整体重写）
- Test: `opencode-category-router/tests/category-config.test.ts`（整体重写）

**Interfaces:**
- Consumes: `./model-utils` 的 `parseModelString(model: string): { providerID: string; modelID: string; variant?: string } | undefined`
- Produces:
  - `export interface CategoryDef { description: string; model: string; variant?: string }`
  - `export type CategoryConfig = Record<string, CategoryDef>`
  - `export interface ParsedCategoryModel { providerID: string; modelID: string; variant?: string }`
  - `export const CATEGORY_NAME_RE: RegExp`
  - `export function isValidCategoryName(name: string): boolean`
  - `export function sanitizeConfig(input: unknown): CategoryConfig | undefined`（非对象/数组 → `undefined`；否则逐条过滤，非法条目 warn 后跳过）
  - `export const DEFAULT_CATEGORIES: CategoryConfig`
  - `export function loadCategoryConfig(options: unknown): CategoryConfig`（可能返回 `{}` 表示禁用）
  - `export function parseCategoryModel(category: CategoryDef): ParsedCategoryModel | undefined`

- [ ] **Step 1: 重写失败测试**

`opencode-category-router/tests/category-config.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd opencode-category-router && npm test tests/category-config.test.ts`
Expected: FAIL（`sanitizeConfig(input)` 对 `__proto__` 现在返回 `undefined`、空表现在回落默认；新语义未实现）

- [ ] **Step 3: 重写实现**

`opencode-category-router/src/category-config.ts`:

```ts
import defaultCategories from "./default-categories.json"
import { parseModelString } from "./model-utils"

export interface CategoryDef {
  description: string
  model: string
  variant?: string
}

export type CategoryConfig = Record<string, CategoryDef>

export interface ParsedCategoryModel {
  providerID: string
  modelID: string
  variant?: string
}

// 防止用户配置里的 "__proto__" 键落到普通对象的原型上。
const FORBIDDEN_CATEGORY_KEYS = new Set(["__proto__"])

// 类别名即 agent 名，须落在 opencode agent 名的安全字符集内。
export const CATEGORY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isValidCategoryName(name: string): boolean {
  return name.trim().length > 0 && !FORBIDDEN_CATEGORY_KEYS.has(name) && CATEGORY_NAME_RE.test(name)
}

function isCategoryDef(value: unknown): value is CategoryDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const def = value as Record<string, unknown>
  if (typeof def.description !== "string") return false
  if (typeof def.model !== "string" || def.model.trim().length === 0) return false
  if (def.variant !== undefined && typeof def.variant !== "string") return false
  return true
}

/**
 * 逐条校验：非对象/数组 → undefined；否则只保留合法条目，非法条目 warn 后跳过。
 * 注意：不校验 provider 前缀（那是 parseCategoryModel 的职责）。
 */
export function sanitizeConfig(input: unknown): CategoryConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const out: CategoryConfig = {}
  for (const [name, def] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidCategoryName(name)) {
      console.warn(`[category-router] 忽略非法类别名 "${name}"（需匹配 ${CATEGORY_NAME_RE} 且非 __proto__）`)
      continue
    }
    if (!isCategoryDef(def)) {
      console.warn(`[category-router] 忽略格式非法的类别 "${name}"（需 { description, model, variant? }）`)
      continue
    }
    out[name] = {
      description: def.description,
      model: def.model,
      ...(def.variant !== undefined ? { variant: def.variant } : {}),
    }
  }
  return out
}

function cloneConfig(config: CategoryConfig): CategoryConfig {
  return Object.fromEntries(Object.entries(config).map(([name, def]) => [name, { ...def }]))
}

/** Bundled fallback template, used when the plugin receives no valid `categories` option. */
export const DEFAULT_CATEGORIES: CategoryConfig = sanitizeConfig(defaultCategories) ?? {}

/**
 * 语义（spec §5.3）：
 * - 缺失 categories → 内置默认模板（不 warn）
 * - 非对象/数组 → 内置默认模板 + warn
 * - 显式 {} 或全部条目非法 → 返回 {}（禁用全部）+ warn
 * - 部分条目非法 → 仅跳过该条，其余生效
 */
export function loadCategoryConfig(options: unknown): CategoryConfig {
  const raw = (options as { categories?: unknown } | undefined)?.categories
  if (raw === undefined) return cloneConfig(DEFAULT_CATEGORIES)

  const sanitized = sanitizeConfig(raw)
  if (sanitized === undefined) {
    console.warn("[category-router] categories 配置类型非法（需为对象），已改用内置默认模板。")
    return cloneConfig(DEFAULT_CATEGORIES)
  }
  if (Object.keys(sanitized).length === 0) {
    console.warn("[category-router] categories 为空或全部条目非法，视为禁用全部类别。")
    return {}
  }
  return sanitized
}

/** Split a configured `provider/model[:variant]` string into prompt body parts. */
export function parseCategoryModel(category: CategoryDef): ParsedCategoryModel | undefined {
  const parsed = parseModelString(category.model)
  if (!parsed) return undefined
  const variant = category.variant ?? parsed.variant
  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    ...(variant !== undefined ? { variant } : {}),
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd opencode-category-router && npm test tests/category-config.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
cd opencode-category-router && npm run typecheck
git add opencode-category-router/src/category-config.ts opencode-category-router/tests/category-config.test.ts
git commit -m "refactor(category-router): 类别配置改为逐条校验与空表禁用语义"
```

---

### Task 2: agent-definition 重写（类别 agent 映射 + prompt 改写）

**Files:**
- Modify: `opencode-category-router/src/agent-definition.ts`（整体重写）
- Test: `opencode-category-router/tests/agent-definition.test.ts`（整体重写）

**Interfaces:**
- Consumes: Task 1 的 `CategoryDef` / `CategoryConfig` / `ParsedCategoryModel` / `parseCategoryModel`
- Produces:
  - `export const SHARED_AGENT_PROMPT: string`（含占位符 `{{CATEGORY}}`）
  - `export const CATEGORY_AGENT_TOOLS: Record<string, boolean>`
  - `export interface CategoryAgentDefinition { description: string; mode: "subagent"; model: string; variant?: string; prompt: string; tools: Record<string, boolean> }`
  - `export function buildCategoryAgent(name: string, def: CategoryDef, parsed: ParsedCategoryModel): CategoryAgentDefinition`
  - `export function planCategoryAgents(categories: CategoryConfig): { agents: Record<string, CategoryAgentDefinition>; injected: CategoryConfig }`

- [ ] **Step 1: 重写失败测试**

`opencode-category-router/tests/agent-definition.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd opencode-category-router && npm test tests/agent-definition.test.ts`
Expected: FAIL（`buildCategoryAgent` / `planCategoryAgents` / `SHARED_AGENT_PROMPT` 未定义）

- [ ] **Step 3: 重写实现**

`opencode-category-router/src/agent-definition.ts`:

```ts
import { parseCategoryModel, type CategoryConfig, type CategoryDef, type ParsedCategoryModel } from "./category-config"

/** 共享执行 prompt；`{{CATEGORY}}` 由 buildCategoryAgent 替换为类别名。 */
export const SHARED_AGENT_PROMPT = `你是类别 "{{CATEGORY}}" 的工作代理，被编排者以明确目标派发到独立会话中。

执行纪律：
1. 先探索理解，再动手。需要时使用 grep/glob/read 收集上下文。
2. 以目标为授权：不要等待确认，选择你认为最合理的方案并完成它。
3. 记录假设：无法验证的假设在最终回复中写明。
4. 完成即交付：最终回复包含做了什么、证据（命令/测试输出）、遗留假设。
5. 不提问：问题会中断任务。除非遇到不可绕过的阻塞（缺密钥、唯一依赖用户决策）。
6. 禁止派生下级子代理：不要调用 task 或任何子任务派发工具。`

/** 类别 agent 默认工具集；task 默认 deny 作为防递归主闸门。 */
export const CATEGORY_AGENT_TOOLS: Record<string, boolean> = {
  read: true,
  grep: true,
  glob: true,
  edit: true,
  bash: true,
  ls: true,
  task: false,
}

export interface CategoryAgentDefinition {
  description: string
  mode: "subagent"
  model: string
  variant?: string
  prompt: string
  tools: Record<string, boolean>
}

export function buildCategoryAgent(name: string, def: CategoryDef, parsed: ParsedCategoryModel): CategoryAgentDefinition {
  return {
    description: def.description,
    mode: "subagent",
    model: `${parsed.providerID}/${parsed.modelID}`,
    ...(parsed.variant !== undefined ? { variant: parsed.variant } : {}),
    prompt: SHARED_AGENT_PROMPT.replace("{{CATEGORY}}", name),
    tools: { ...CATEGORY_AGENT_TOOLS },
  }
}

/**
 * 把类别表编译为 agent 定义，并返回真正成功注入的子集 `injected`，
 * 供 system-inject 只渲染"确实存在 agent"的类别（spec §5.2）。
 */
export function planCategoryAgents(categories: CategoryConfig): {
  agents: Record<string, CategoryAgentDefinition>
  injected: CategoryConfig
} {
  const agents: Record<string, CategoryAgentDefinition> = {}
  const injected: CategoryConfig = {}
  for (const [name, def] of Object.entries(categories)) {
    const parsed = parseCategoryModel(def)
    if (!parsed) {
      console.warn(`[category-router] 类别 "${name}" 的 model 非法（需 provider/model），已跳过`)
      continue
    }
    agents[name] = buildCategoryAgent(name, def, parsed)
    injected[name] = def
  }
  return { agents, injected }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd opencode-category-router && npm test tests/agent-definition.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd opencode-category-router && npm run typecheck
git add opencode-category-router/src/agent-definition.ts opencode-category-router/tests/agent-definition.test.ts
git commit -m "feat(category-router): 类别映射为 subagent 定义并改写共享 prompt"
```

---

### Task 3: system-inject 尾注改写与表格转义

**Files:**
- Modify: `opencode-category-router/src/system-inject.ts`（整体重写）
- Test: `opencode-category-router/tests/system-inject.test.ts`（整体重写）

**Interfaces:**
- Consumes: Task 1 的 `CategoryConfig`
- Produces: `export function renderCategoryTable(categories: CategoryConfig): string`（空集返回 `""`）

- [ ] **Step 1: 重写失败测试**

`opencode-category-router/tests/system-inject.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd opencode-category-router && npm test tests/system-inject.test.ts`
Expected: FAIL（当前尾注仍写 `delegate_task`；空集未返回 `""`；转义缺失）

- [ ] **Step 3: 重写实现**

`opencode-category-router/src/system-inject.ts`:

```ts
import type { CategoryConfig } from "./category-config"

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

export function renderCategoryTable(categories: CategoryConfig): string {
  const names = Object.keys(categories).sort()
  if (names.length === 0) return ""

  const rows = names
    .map((name) => {
      const cat = categories[name]
      const variant = cat.variant ? ` (${cat.variant})` : ""
      return `| \`${name}\` | ${escapeCell(cat.description)} | ${cat.model}${variant} |`
    })
    .join("\n")

  return `### 可用任务类别

| 类别 | 用途 | 默认模型 |
|---|---|---|
${rows}

（编排者）委托子任务时使用 task(subagent_type="<类别名>", prompt=..., description=...)，指定工作类型，不要手动选模型；子代理自身不应再派发下级子任务。`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd opencode-category-router && npm test tests/system-inject.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd opencode-category-router && npm run typecheck
git add opencode-category-router/src/system-inject.ts opencode-category-router/tests/system-inject.test.ts
git commit -m "feat(category-router): 类别表改教原生 task 用法并转义单元格"
```

---

### Task 4: plugin 重写 + 删除自研派发层 + README 同步

**Files:**
- Modify: `opencode-category-router/src/plugin.ts`（整体重写）
- Modify: `opencode-category-router/README.md`
- Delete: `opencode-category-router/src/subagent.ts`
- Delete: `opencode-category-router/tests/registry.test.ts`
- Delete: `opencode-category-router/tests/subagent.test.ts`
- Test: `opencode-category-router/tests/plugin.test.ts`（整体重写）

**Interfaces:**
- Consumes: Task 1 的 `loadCategoryConfig`；Task 2 的 `planCategoryAgents` / `CategoryAgentDefinition`；Task 3 的 `renderCategoryTable`
- Produces:
  - `export const CategoryRouterPlugin: Plugin`
  - `export const pluginModule: PluginModule`（与 `export default pluginModule` 保持不变）
  - 返回的 hooks 仅含 `config` 与 `"experimental.chat.system.transform"`（不再有 `tool` / `event`）

- [ ] **Step 1: 重写失败测试**

`opencode-category-router/tests/plugin.test.ts`:

```ts
import { describe, expect, test, vi, afterEach } from "vitest"
import { pluginModule } from "../src/plugin"

afterEach(() => {
  vi.restoreAllMocks()
})

function start(options?: unknown) {
  return pluginModule.server(
    {
      client: {} as never,
      directory: "/tmp",
      worktree: "/tmp",
      project: {} as never,
      experimental_workspace: {} as never,
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    },
    options as never,
  )
}

type ConfigHook = (config: Record<string, unknown>) => Promise<void>
type TransformHook = (input: unknown, output: { system: string[] }) => Promise<void>

describe("CategoryRouterPlugin", () => {
  test("config hook injects one subagent per category with model and variant", async () => {
    const plugin = await start({
      categories: { deep: { description: "deep work", model: "openai/gpt-6-astra", variant: "high" } },
    })
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    const agent = (config.agent as Record<string, Record<string, unknown>>).deep
    expect(agent).toMatchObject({ mode: "subagent", model: "openai/gpt-6-astra", variant: "high", description: "deep work" })
    expect((agent.tools as Record<string, boolean>).task).toBe(false)
  })

  test("falls back to the bundled defaults when no options are provided", async () => {
    const plugin = await start()
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    const names = Object.keys(config.agent as Record<string, unknown>)
    expect(names).toContain("deep")
    expect(names).toContain("quick")
    expect(names.length).toBe(8)
  })

  test("explicit empty categories disable all agents", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const plugin = await start({ categories: {} })
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    expect(config.agent).toBeUndefined()
    const output = { system: [] as string[] }
    await (plugin["experimental.chat.system.transform"] as TransformHook)({}, output)
    expect(output.system).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  test("skips a category whose model lacks a provider prefix", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const plugin = await start({
      categories: {
        deep: { description: "d", model: "openai/gpt-6-astra" },
        broken: { description: "b", model: "no-provider" },
      },
    })
    const config: Record<string, unknown> = {}
    await (plugin.config as ConfigHook)(config)
    const names = Object.keys(config.agent as Record<string, unknown>)
    expect(names).toEqual(["deep"])
    expect(warn).toHaveBeenCalled()
  })

  test("user override keeps its own tool keys and still forces task:false", async () => {
    const plugin = await start({ categories: { deep: { description: "d", model: "openai/gpt-6-astra" } } })
    const config: Record<string, unknown> = {
      agent: { deep: { tools: { read: true }, description: "mine" } },
    }
    await (plugin.config as ConfigHook)(config)
    const agent = (config.agent as Record<string, Record<string, unknown>>).deep
    expect(agent.description).toBe("mine")
    expect(agent.mode).toBe("subagent")
    expect(agent.tools).toEqual({ read: true, task: false })
  })

  test("user may explicitly re-enable task for a same-named agent", async () => {
    const plugin = await start({ categories: { deep: { description: "d", model: "openai/gpt-6-astra" } } })
    const config: Record<string, unknown> = { agent: { deep: { tools: { task: true } } } }
    await (plugin.config as ConfigHook)(config)
    const agent = (config.agent as Record<string, Record<string, unknown>>).deep
    expect(agent.tools).toEqual({ task: true })
  })

  test("system.transform injects the category table with the native task call", async () => {
    const plugin = await start()
    const output = { system: [] as string[] }
    await (plugin["experimental.chat.system.transform"] as TransformHook)({}, output)
    const text = output.system.join("\n")
    expect(text).toContain("task(subagent_type=")
    expect(text).toContain("deep")
    expect(text).not.toContain("delegate_task")
  })

  test("does not expose the removed tool or event hooks", async () => {
    const plugin = await start()
    expect((plugin as Record<string, unknown>).tool).toBeUndefined()
    expect((plugin as Record<string, unknown>).event).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd opencode-category-router && npm test tests/plugin.test.ts`
Expected: FAIL（现 `plugin.ts` 仍注册 `delegate_task` 与 `event`，`config` 注入的是 `category-worker`）

- [ ] **Step 3: 重写实现**

`opencode-category-router/src/plugin.ts`:

```ts
import { type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { loadCategoryConfig } from "./category-config"
import { planCategoryAgents, type CategoryAgentDefinition } from "./agent-definition"
import { renderCategoryTable } from "./system-inject"

/**
 * 合并插件默认 agent 与用户 JSONC 同名 agent：
 * - 用户字段逐一覆盖默认值；
 * - tools 采用用户提供的键值；唯一例外是递归闸门 `task`——
 *   除非用户显式写了 `task` 键，否则强制补 `task:false`（spec §4.1/§4.2）。
 */
function mergeAgent(
  defaultAgent: CategoryAgentDefinition,
  userAgent: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!userAgent) return defaultAgent
  const userTools = userAgent.tools as Record<string, boolean> | undefined
  const tools = userTools
    ? { ...userTools, ...(Object.hasOwn(userTools, "task") ? {} : { task: false }) }
    : defaultAgent.tools
  return { ...defaultAgent, ...userAgent, tools }
}

export const CategoryRouterPlugin: Plugin = async (_input, options) => {
  const { agents, injected } = planCategoryAgents(loadCategoryConfig(options))
  const categoryNames = Object.keys(injected)

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (categoryNames.length === 0) return
      output.system.push(renderCategoryTable(injected))
    },

    config: async (config) => {
      if (Object.keys(agents).length === 0) return
      const cfg = config as Record<string, unknown>
      const existing = (cfg.agent ?? {}) as Record<string, Record<string, unknown> | undefined>
      for (const [name, agent] of Object.entries(agents)) {
        existing[name] = mergeAgent(agent, existing[name])
      }
      cfg.agent = existing
    },
  }
}

// opencode 插件加载契约：模块必须导出 { id, server: Plugin }（PluginModule 形状），
// 裸函数导出会导致加载器找不到 server 属性、插件不加载；
// 文件路径插件（file://，含 plugins/*.js 平铺安装）额外要求默认导出携带 id。
export const pluginModule: PluginModule = { id: "category-router", server: CategoryRouterPlugin }
export default pluginModule
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd opencode-category-router && npm test tests/plugin.test.ts`
Expected: PASS

- [ ] **Step 5: 删除自研派发层**

```bash
git rm opencode-category-router/src/subagent.ts opencode-category-router/tests/registry.test.ts opencode-category-router/tests/subagent.test.ts
```

- [ ] **Step 6: 同步 README**

把 `opencode-category-router/README.md` 替换为：

````markdown
# opencode-category-router

按任务类别派发不同模型的 opencode 插件。每个类别注册为一个同名 subagent（`mode: "subagent"`），编排者用 opencode **原生** `task` 工具调用，从而获得原生的可点击子代理会话卡片。类别与模型全部来自 JSON 配置，插件源码不含任何模型数据。

## 安装与配置

在 `opencode.jsonc` 的 `plugin` 字段里用二元组 `[插件路径, options]` 引入，`options.categories` 即配置：

```jsonc
{
  "plugin": [
    ["./opencode-category-router/dist/index.js", {
      "categories": {
        "deep":    { "description": "深度自主问题求解", "model": "openai/gpt-6-astra", "variant": "high" },
        "writing": { "description": "文档与写作",       "model": "anthropic/claude-fable-5-1", "variant": "medium" }
      }
    }]
  ]
}
```

- 先构建：`cd opencode-category-router && npm install && npm run build`（产出 `dist/index.js`）。
- `categories` 为 `{ 类别名: { description, model, variant? } }`；`model` 必须是 `provider/model` 形式（也可写成 `provider/model:variant`），`variant` 可选。
- 类别名即 subagent 名，须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`。
- **配置语义**：未提供 `categories` 或类型非法 → 回落到内置默认模板（8 个类别，见 `src/default-categories.json`）；显式写 `categories: {}` → **禁用全部类别**（不注入、不回落）；单条非法 → 仅跳过该条。
- 若只想要默认类别，也可把 `dist/index.js` 平铺/软链到 `~/.config/opencode/plugins/`，但该方式无法传入 options。

重启 opencode 后生效。插件为每个类别注入一个 subagent 并注入类别表。

## 用法

编排者调用**原生** `task` 工具：

```
task(subagent_type="deep", prompt="...", description="...")
```

- 子会话在 TUI 中呈现为原生子代理卡片，可点击或按 `session_child_first`（默认 `<leader>+↓`）进入查看详情。
- 后台运行：`task(..., background=true)`，需要 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`；关闭时该参数直接报错。
- 类别不存在或 `model` 非法时不会注册对应 subagent；编排者传未注册的 `subagent_type` 会得到原生 `Unknown agent type` 错误。

## 已知限制

- 每类别只有单一 `model`，无回退链；可用性由 opencode 运行时处理。
- 后台能力依赖上述 experimental 开关。
- 旧版插件遗留的 `<project>/.opencode/category-router/tasks.json` 已无消费者，可手动删除。
````

- [ ] **Step 7: 全量测试 + 提交**

```bash
cd opencode-category-router && npm run typecheck && npm test
git add opencode-category-router/src/plugin.ts opencode-category-router/tests/plugin.test.ts opencode-category-router/README.md
git commit -m "feat(category-router): 改为类别 subagent + 原生 task 派发"
```

---

### Task 5: 构建与运行时验证（含 V1/V2 手动确认）

**Files:**
- Modify: `opencode-category-router/dist/index.js`（由构建产出，`dist/` 已 gitignore，不提交）

**Interfaces:**
- Consumes: 前四个 Task 的全部产物
- Produces: 可被 opencode 加载的 `dist/index.js`；V1/V2 的验证结论

- [ ] **Step 1: 全量测试与类型检查**

Run: `cd opencode-category-router && npm run typecheck && npm test`
Expected: PASS，无 TS 错误，无残留的 `delegate_task` / `registry` / `subagent` 测试

- [ ] **Step 2: 确认无残留引用**

Run: `cd opencode-category-router && grep -rn "delegate_task\|category-worker\|TaskRegistry" src tests README.md`
Expected: 无输出（退出码 1）

- [ ] **Step 3: 构建**

Run: `cd opencode-category-router && npm run build`
Expected: 产出 `dist/index.js`，无报错

- [ ] **Step 4: 运行时手动验证（需真实 opencode 会话）**

在 `opencode.jsonc` 中引入构建产物并重启 opencode，然后：

1. 主会话内让编排者调用 `task(subagent_type="deep", description="smoke", prompt="列出当前目录文件")`。
2. **预期（原生卡片）**：TUI 出现原生子代理卡片，点击/`<leader>+↓` 可进入子会话查看详情。
3. **验证 V1（variant 传播）**：给该类别配 `variant=high`，进入子会话检查其实际请求所用 variant 是否为 `high`。
   - 若为 `high` → 记录"V1 成立"。
   - 若未生效 → 按 spec §10 V1 降级方案处理（记录为已知限制，或改用 `provider/model:variant` 形式），并更新 README 已知限制。
4. **验证 V2（subagent_depth 默认值）**：进入类别子会话，尝试让其再派发下级子代理（`task`）——预期被拒绝（`tools.task=false`）。
5. 后台：设置 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 后调用 `task(..., background=true)`，确认立即返回且完成后父会话被唤醒；关闭该开关时确认 `background=true` 报错。

- [ ] **Step 5: 记录验证结论并提交**

把 V1/V2 的实际观察写入 `docs/superpowers/specs/2026-09-14-category-router-native-subagent.md` 的 §10（把"待验证假设"就地更新为"已验证/已降级"）。

```bash
git add docs/superpowers/specs/2026-09-14-category-router-native-subagent.md
git commit -m "docs(category-router): 回填 V1/V2 运行时验证结论"
```

---

## Self-Review

**1. Spec 覆盖：**
- §4 类别→agent 映射 → Task 2（`buildCategoryAgent`）
- §4.1 用户覆盖与合并（含 task 强制）→ Task 4（`mergeAgent`）+ 测试
- §4.2 递归闸门 → Task 2（`CATEGORY_AGENT_TOOLS.task=false`）+ Task 4（合并不变量）
- §4.3 prompt 改写 → Task 2（`SHARED_AGENT_PROMPT` + 测试断言无残留）
- §4.4 类别名约束 + 表格转义 → Task 1（`isValidCategoryName`）+ Task 3（`escapeCell`）
- §5.1 config 注入 + `injected` 集 → Task 2（`planCategoryAgents`）+ Task 4
- §5.2 类别表与零类别边界 → Task 3 + Task 4
- §5.3 配置语义（缺失/非法/空表/单条）→ Task 1 + 测试
- §6/§7 数据流与错误 → Task 4 hooks + README
- §8 文件结构（删 subagent.ts / registry.test.ts / subagent.test.ts）→ Task 4 Step 5
- §10 V1/V2 + 能力缺口 → Task 5 Step 4；README 已知限制
- §11 证据 → 设计文档内，无需实现

**2. 占位符扫描：** 无 TODO/TBD；每个代码步骤均含完整代码。

**3. 类型一致性：** `CategoryAgentDefinition`（Task 2 定义，Task 4 使用）；`injected: CategoryConfig`（Task 2 产出，Task 4 渲染）；`renderCategoryTable(CategoryConfig)`（Task 3）；`loadCategoryConfig` 返回 `{}` 表示禁用（Task 1，Task 4 据 `categoryNames.length === 0` 判断）。
