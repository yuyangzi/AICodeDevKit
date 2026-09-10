# Category Router Plugin 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AICodeDevKit 下从零构建一个独立的 opencode 插件 `opencode-category-router`，实现"任务类别→模型"派发：`delegate_task(category, prompt)` 创建指定模型的子会话，8 内置类别 + 7 步决议 + 回退链 + fuzzy 匹配。

**Architecture:** 插件导出 4 个 hook（`tool`/`event`/`experimental.chat.system.transform`/`config`）。纯函数解析层（fuzzy 匹配、模型决议、类别表）从 oh-my-openagent 仓库拷贝（逐字保留源文件注释），harness 适配层（子会话管理、任务注册表、hook 组装）为新写代码。子会话模型通过 `prompt`/`promptAsync` body 顶层 `model` + `variant` 字段指定，无 `chat.params` hook、无按 session 的 variant 状态。

**Tech Stack:** Node 18+（**全 Node 工具链**：vitest + esbuild + npm）、TypeScript strict、`@opencode-ai/plugin`（类型 + `tool()` 工厂）、`@opencode-ai/sdk`（类型/mock）、zod。插件 src/ 代码只用 Node 标准 API（`node:fs`、`node:path`），**无任何 Bun API**；测试用 vitest（Node 上跑），构建用 esbuild（bundle 打进 `@opencode-ai/plugin`，产出自包含 `dist/index.js`）。

**Spec:** `docs/superpowers/specs/2026-09-06-category-router-plugin.md`（已通过第三轮审查）

## Global Constraints

（来自 spec，逐条强制执行）

- 工具名必须为 `delegate_task`，严禁注册 `task`（避开 opencode 内置 TaskTool）。
- 执行代理名必须为 `category-worker`，`mode: "subagent"`，tools 默认 `delegate_task: false`（deny 自我派发）。
- variant 只能通过 `prompt`/`promptAsync` body 顶层 `variant` 字段传递；**无 `chat.params` hook，无按 session 的 variant 内存状态**。
- background 用 `session.promptAsync({ path:{id}, body:{..., noReply:false } })`（`noReply:false` 让 loop 后台运行；`noReply:true` 会跳过 loop）。
- sync 用 `session.prompt({ path:{id}, body })` 并 `await` 响应体；以 `info.error` 为主错误信号，`session.error` 事件为兜底。
- parent-wake 正常路径 reply-required（`noReply:false`）；父会话 busy 时降级 `noReply:true`。
- 任务注册表落盘 `<project>/.opencode/category-router/tasks.json`（项目级，避免多实例互踩）；启动对账补发；防重入（`notified` 标记）。
- `experimental.chat.system.transform` 统一注入类别表（不区分主/子会话）。
- 不依赖 `model-capabilities`；不做 variant 能力 clamp。
- 测试用 **vitest**（Node 上运行，`import { describe, expect, test } from "vitest"`），不测真实模型调用。
- 构建用 **esbuild**（`--bundle --platform=node --format=esm`，把 `@opencode-ai/plugin` 打进产物），产出自包含 `dist/index.js`。
- 包管理用 **npm**。运行时代码（src/）禁用 Bun API，只用 Node 标准 API。
- 从 omO 拷贝的源码保留源文件原有注释（如实逐字拷贝，不增删）；omO 仓库根路径下文记为 `OMO=/mnt/c/Development/Github/oh-my-openagent`。

---

### Task 1: 项目脚手架

**Files:**
- Create: `opencode-category-router/package.json`
- Create: `opencode-category-router/tsconfig.json`
- Create: `opencode-category-router/vitest.config.ts`
- Create: `opencode-category-router/.gitignore`
- Create: `opencode-category-router/src/`、`opencode-category-router/tests/` 目录
- Create: `opencode-category-router/tests/smoke.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 Node 工程骨架，后续任务填充 `src/*.ts`

- [ ] **Step 1: 写冒烟测试**

`opencode-category-router/tests/smoke.test.ts`:
```typescript
import { describe, expect, test } from "vitest"

describe("smoke", () => {
  test("vitest test runner works", () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: 创建工程文件**

`opencode-category-router/package.json`:
```json
{
  "name": "opencode-category-router",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "esbuild src/plugin.ts --bundle --platform=node --format=esm --outfile=dist/index.js"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.18.0"
  },
  "devDependencies": {
    "@opencode-ai/sdk": "^1.18.0",
    "@types/node": "^22.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "zod": "^4.1.0"
  }
}
```

`opencode-category-router/tsconfig.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

`opencode-category-router/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
```

`opencode-category-router/.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 3: 安装依赖并跑测试**

Run: `cd opencode-category-router && npm install && npm test`
Expected: smoke.test.ts PASS（1 passing）

- [ ] **Step 4: 提交**

```bash
git add opencode-category-router
git commit -m "chore: scaffold category-router plugin project"
```

---

### Task 2: model-utils.ts（拷贝纯函数）

**Files:**
- Create: `opencode-category-router/src/model-utils.ts`
- Test: `opencode-category-router/tests/model-utils.test.ts`

**Interfaces:**
- Consumes: 无（全部自包含纯函数）
- Produces:
  - `normalizeModel(model?: string): string | undefined`
  - `parseModelString(model: string): { providerID: string; modelID: string; variant?: string } | undefined`
  - `parseVariantFromModelID(raw: string, opts?): { modelID: string; variant?: string }`
  - `fuzzyMatchModel(target: string, available: Set<string>, providers?: string[]): string | null`
  - `isModelAvailable(target: string, available: Set<string>): boolean`
  - `splitReasoningSuffix(model: string, opts?): { base: string; level?: string }`
  - `transformModelForProvider(provider: string, model: string): string`

- [ ] **Step 1: 写失败测试**

`opencode-category-router/tests/model-utils.test.ts`:
```typescript
import { describe, expect, test } from "vitest"
import { fuzzyMatchModel, parseModelString, parseVariantFromModelID, isModelAvailable } from "../src/model-utils"

describe("fuzzyMatchModel", () => {
  test("exact match wins", () => {
    const available = new Set(["openai/gpt-5.6-sol", "openai/gpt-5.4"])
    expect(fuzzyMatchModel("openai/gpt-5.6-sol", available)).toBe("openai/gpt-5.6-sol")
  })

  test("shortest substring match wins", () => {
    const available = new Set(["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4-6-xhigh"])
    expect(fuzzyMatchModel("anthropic/claude-sonnet-4-6", available)).toBe("anthropic/claude-sonnet-4-6")
  })

  test("provider filter narrows candidates", () => {
    const available = new Set(["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"])
    expect(fuzzyMatchModel("gpt-5.4", available, ["openai"])).toBe("openai/gpt-5.4")
    expect(fuzzyMatchModel("gpt-5.4", available, ["anthropic"])).toBeNull()
  })

  test("empty available returns null", () => {
    expect(fuzzyMatchModel("x/y", new Set())).toBeNull()
  })
})

describe("parseModelString", () => {
  test("parses provider/model with variant suffix", () => {
    expect(parseModelString("openai/gpt-5.6-sol:high")).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol", variant: "high" })
  })

  test("parses provider/model with space variant", () => {
    expect(parseModelString("openai/gpt-5.4 high")).toEqual({ providerID: "openai", modelID: "gpt-5.4", variant: "high" })
  })

  test("bare model without provider returns undefined", () => {
    expect(parseModelString("gpt-5.4")).toBeUndefined()
  })
})

describe("isModelAvailable", () => {
  test("true when fuzzy match exists", () => {
    expect(isModelAvailable("openai/gpt-5.6-sol", new Set(["openai/gpt-5.6-sol-preview"]))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd opencode-category-router && npm test tests/model-utils.test.ts`
Expected: FAIL，`Cannot find module "../src/model-utils"`

- [ ] **Step 3: 拷贝实现到 src/model-utils.ts**

按以下顺序将 omO 源码**逐字拷贝**合并进 `src/model-utils.ts`，每个函数体原样保留（含源文件原有注释；omO 这些源文件无版权头，无需额外添加）：

1. `$OMO/packages/model-core/src/model-normalization.ts`（8 行）→ 全部
2. `$OMO/packages/model-core/src/reasoning-level.ts`（52 行）→ 全部
3. `$OMO/packages/model-core/src/model-string-parser.ts`（65 行）→ 全部
4. `$OMO/packages/model-core/src/model-availability.ts`（66 行）→ 全部
5. `$OMO/packages/model-core/src/provider-model-id-transform.ts`（74 行）→ 全部

5 个源文件的函数本就是顶层 `export function`/`export const`，合并后**直接保留这些导出即可，无需再追加 barrel re-export**（追加 `export {...} from "./model-utils"` 会形成自引用，esbuild/vitest 下无必要且脆弱）。合并后导出面应为：

`normalizeModel`、`normalizeModelID`、`REASONING_LEVELS`、`REASONING_AUTO`（const）、`type ReasoningLevel`、`isReasoningLevel`、`isReasoningLevelOrAuto`、`normalizeReasoning`、`clampReasoningLevel`、`splitReasoningSuffix`、`parseVariantFromModelID`、`parseModelString`、`fuzzyMatchModel`、`isModelAvailable`、`transformModelForProvider`、`transformModelForProviderDisplay`。

验证拷贝完整：5 个源文件合计 265 行，合并后文件行数应约等于 265 + 头注 + 注释。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd opencode-category-router && npm test tests/model-utils.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 5: 提交**

```bash
git add opencode-category-router/src/model-utils.ts opencode-category-router/tests/model-utils.test.ts
git commit -m "feat: port model resolution pure functions from omo"
```

---

### Task 3: resolve-model.ts（拷贝 7 步决议）

**Files:**
- Create: `opencode-category-router/src/resolve-model.ts`
- Test: `opencode-category-router/tests/resolve-model.test.ts`

**Interfaces:**
- Consumes: `./model-utils`（`fuzzyMatchModel`、`normalizeModel`、`parseModelString`、`parseVariantFromModelID`、`transformModelForProvider`）
- Produces:
  - `type DelegateFallbackEntry = { providers: string[]; model: string; variant?: string }`
  - `type DelegateModelResolutionInput = { userModel?; userFallbackModels?; categoryDefaultModel?; isUserConfiguredCategoryModel?; fallbackChain?; availableModels: ReadonlySet<string>; systemDefaultModel? }`
  - `type DelegateModelResolutionResult = { model; variant?; fallbackEntry?; matchedFallback? } | { skipped: true } | undefined`
  - `type DelegateModelResolutionDeps = { connectedProviders: string[] | null; hasProviderModelsCache: boolean; hasConnectedProvidersCache: boolean; log? }`
  - `resolveModelForDelegateTask(input, deps): DelegateModelResolutionResult`

- [ ] **Step 1: 写失败测试（移植 omO 用例）**

`opencode-category-router/tests/resolve-model.test.ts`（移植自 `$OMO/packages/delegate-core/src/model-selection.test.ts`，167 行共 **9 个用例**。**按 omO 源文件逐字移植全部用例**（只改两处：顶部 import 从 `./model-selection` 改为 `../src/resolve-model`；`bun:test` 改为 `vitest`；`gpt56SolFallbackChain` 按 omO 原样保留命名条目 `nativeSolEntry`/`copilotSolEntry`/`legacyGptEntry`）。下方展示为**必选核心子集**（覆盖 skipped 哨兵、fallback 提升、connected provider、Vercel 变换、精确匹配），完整移植时以 omO 源为准、不得遗漏其余用例）:
```typescript
import { describe, expect, test } from "vitest"
import { resolveModelForDelegateTask, type DelegateFallbackEntry, type DelegateModelResolutionDeps } from "../src/resolve-model"

const noCacheDeps: DelegateModelResolutionDeps = {
  connectedProviders: null,
  hasProviderModelsCache: false,
  hasConnectedProvidersCache: false,
}

const gpt56SolFallbackChain: DelegateFallbackEntry[] = [
  { providers: ["openai", "vercel"], model: "gpt-5.6-sol", variant: "xhigh" },
  { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
  { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "xhigh" },
]

describe("resolveModelForDelegateTask", () => {
  test("#given no provider cache #when no user override #then returns skipped sentinel", () => {
    const result = resolveModelForDelegateTask({ availableModels: new Set(), categoryDefaultModel: "openai/gpt-5.4" }, noCacheDeps)
    expect(result).toEqual({ skipped: true })
  })

  test("#given user primary unreachable #when fallback_models reachable #then promotes fallback with variant", () => {
    const result = resolveModelForDelegateTask({
      userModel: "quotio/claude-haiku-4-5-unavailable",
      userFallbackModels: ["openai/gpt-5.4 high"],
      availableModels: new Set(["openai/gpt-5.4-preview"]),
    }, noCacheDeps)
    expect(result).toEqual({ model: "openai/gpt-5.4-preview", variant: "high", matchedFallback: true })
  })

  test("#given connected providers cache #when fallback chain starts disconnected #then selects first connected provider", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(),
      fallbackChain: [
        { providers: ["anthropic"], model: "claude-sonnet-4-6" },
        { providers: ["openai"], model: "gpt-5.4", variant: "medium" },
      ],
    }, { connectedProviders: ["openai"], hasProviderModelsCache: true, hasConnectedProvidersCache: true })
    expect(result).toEqual({ model: "openai/gpt-5.4", variant: "medium", fallbackEntry: { providers: ["openai"], model: "gpt-5.4", variant: "medium" }, matchedFallback: true })
  })

  test("#given only Vercel GPT-5.6 Sol #when fallback resolves #then keeps native xhigh rung", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["vercel/openai/gpt-5.6-sol"]),
      fallbackChain: gpt56SolFallbackChain,
      systemDefaultModel: "system/default",
    }, noCacheDeps)
    expect(result).toEqual({ model: "vercel/openai/gpt-5.6-sol", variant: "xhigh", fallbackEntry: gpt56SolFallbackChain[0], matchedFallback: true })
  })

  test("#given only Copilot GPT-5.6 Sol #then dedicated high rung wins", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["github-copilot/gpt-5.6-sol"]),
      fallbackChain: gpt56SolFallbackChain,
    }, noCacheDeps)
    expect(result).toEqual({ model: "github-copilot/gpt-5.6-sol", variant: "high", fallbackEntry: gpt56SolFallbackChain[1], matchedFallback: true })
  })

  test("#given category default exact match #then returns matched model", () => {
    const result = resolveModelForDelegateTask({
      availableModels: new Set(["anthropic/claude-sonnet-4-6"]),
      categoryDefaultModel: "anthropic/claude-sonnet-4-6",
    }, noCacheDeps)
    expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6" })
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd opencode-category-router && npm test tests/resolve-model.test.ts`
Expected: FAIL，`Cannot find module "../src/resolve-model"`

- [ ] **Step 3: 拷贝实现**

将 `$OMO/packages/delegate-core/src/model-selection.ts`（279 行）**逐字拷贝**（含源文件原有注释，如实保留）到 `src/resolve-model.ts`。仅两处适配：
- 顶部 import 从 `@oh-my-opencode/model-core` 改为相对导入 `./model-utils`（`fuzzyMatchModel`、`normalizeModel`、`parseModelString`、`parseVariantFromModelID`、`transformModelForProvider`）。
- **文件内 `export { transformModelForProvider } from "@oh-my-opencode/model-core"` 这行 re-export 必须同步改为 `from "./model-utils"`**——该函数在决议主体内部（约 L216/230/237）被使用，不能删除；遗漏会导致 `npm run typecheck` / esbuild 构建失败。
- 其余（`DelegateFallbackEntry` 等类型、`resolveModelForDelegateTask` 主体）原样保留。

拷贝后自检：`grep -n "oh-my-opencode" src/resolve-model.ts` 应无任何输出（所有 `@oh-my-opencode/*` 引用均已替换为相对路径）。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd opencode-category-router && npm test tests/resolve-model.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add opencode-category-router/src/resolve-model.ts opencode-category-router/tests/resolve-model.test.ts
git commit -m "feat: port delegate model resolution (7-step) from omo"
```

---

### Task 4: categories.ts（8 类别表）

**Files:**
- Create: `opencode-category-router/src/categories.ts`
- Test: `opencode-category-router/tests/categories.test.ts`

**Interfaces:**
- Consumes: `./resolve-model`（`DelegateFallbackEntry` 类型）
- Produces:
  - `interface CategoryDef { model: string; variant?: string; description: string; fallbackChain: DelegateFallbackEntry[] }`
  - `CATEGORIES: Record<string, CategoryDef>`（8 键）
  - `CATEGORY_NAMES: string[]`（升序）

- [ ] **Step 1: 写失败测试**

`opencode-category-router/tests/categories.test.ts`:
```typescript
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd opencode-category-router && npm test tests/categories.test.ts`
Expected: FAIL，`Cannot find module "../src/categories"`

- [ ] **Step 3: 实现 categories.ts**

```typescript
import type { DelegateFallbackEntry } from "./resolve-model"

export interface CategoryDef {
  model: string
  variant?: string
  description: string
  fallbackChain: DelegateFallbackEntry[]
}

export const CATEGORIES: Record<string, CategoryDef> = {
  "visual-engineering": {
    model: "anthropic/claude-fable-5-1",
    variant: "max",
    description: "Visual design, UI/UX, frontend, styling, animation, and design systems",
    fallbackChain: [
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
    ],
  },
  ultrabrain: {
    model: "openai/gpt-6-astra",
    variant: "max",
    description: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-6-astra", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "max" },
    ],
  },
  deep: {
    model: "openai/gpt-6-astra",
    variant: "high",
    description: "Deep autonomous problem-solving for complex research. ONE goal + ONE deliverable per call.",
    fallbackChain: [
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "high" },
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-sol", variant: "medium" },
    ],
  },
  artistry: {
    model: "anthropic/claude-fable-5-1",
    variant: "max",
    description: "Complex problem-solving with unconventional, creative approaches",
    fallbackChain: [
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "xhigh" },
    ],
  },
  quick: {
    model: "kimi-for-coding/kimi-for-coding-highspeed",
    description: "Trivial tasks - single file changes, typo fixes, simple modifications",
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed" },
      { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "off" },
      { providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"], model: "qwen3.6-flash", variant: "low" },
      { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      { providers: ["anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-4-5", variant: "off" },
    ],
  },
  "unspecified-low": {
    model: "xai/grok-4.6",
    variant: "xhigh",
    description: "Tasks that don't fit other categories, low effort required",
    fallbackChain: [
      { providers: ["xai", "github-copilot", "opencode"], model: "grok-4.6", variant: "xhigh" },
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-terra", variant: "high" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-sonnet-5", variant: "low" },
      { providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"], model: "qwen3.8-max-preview", variant: "max" },
      { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" },
    ],
  },
  "unspecified-high": {
    model: "openai/gpt-6-astra",
    variant: "high",
    description: "Tasks that don't fit other categories, high effort required",
    fallbackChain: [
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "high" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "xhigh" },
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
    ],
  },
  writing: {
    model: "anthropic/claude-fable-5-1",
    variant: "medium",
    description: "Documentation, prose, and writing tasks",
    fallbackChain: [
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "medium" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
    ],
  },
}

export const CATEGORY_NAMES: string[] = Object.keys(CATEGORIES).sort()
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd opencode-category-router && npm test tests/categories.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add opencode-category-router/src/categories.ts opencode-category-router/tests/categories.test.ts
git commit -m "feat: add 8 builtin categories with fallback chains"
```

---

### Task 5: subagent.ts（会话封装 + 任务注册表）

**Files:**
- Create: `opencode-category-router/src/subagent.ts`
- Test: `opencode-category-router/tests/registry.test.ts`
- Test: `opencode-category-router/tests/subagent.test.ts`

**Interfaces:**
- Consumes: `./model-utils`（`parseModelString`）
- Produces:
  - `resolveAvailableModels(client): Promise<Set<string>>`（`provider.list()` → 聚合已连接 provider 的 `provider/model` 集）
  - `interface RegisteredTask { sessionID: string; parentID: string; taskId: string; category: string; notified: boolean; failed: boolean }`
  - `class TaskRegistry`：`constructor(projectRoot: string)`、`load(): Promise<void>`、`add(task): Promise<void>`、`get(sessionID): RegisteredTask | undefined`、`markNotified(sessionID, failed): Promise<void>`、`reconcile(client, notify: (task, failed) => Promise<void>): Promise<void>`
  - `buildPromptBody(model: {providerID; modelID}, variant: string | undefined, opts: {agent; parts; noReply}): object`（body 含顶层 `variant`，用类型断言绕过 SDK 缺失字段）

- [ ] **Step 1: 写失败测试（registry）**

`opencode-category-router/tests/registry.test.ts`:
```typescript
import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TaskRegistry, type RegisteredTask } from "../src/subagent"

function makeTask(overrides: Partial<RegisteredTask> = {}): RegisteredTask {
  return { sessionID: "ses-1", parentID: "ses-parent", taskId: "t-1", category: "deep", notified: false, failed: false, ...overrides }
}

describe("TaskRegistry", () => {
  let dir: string
  let reg: TaskRegistry
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "category-router-registry-"))
    reg = new TaskRegistry(dir)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  test("#given persisted tasks #when new registry loads #then tasks survive restart", async () => {
    await reg.load()
    await reg.add(makeTask())
    const reg2 = new TaskRegistry(dir)
    await reg2.load()
    expect(reg2.get("ses-1")).toMatchObject({ sessionID: "ses-1", notified: false })
  })

  test("#given notified task #when markNotified #then persisted notified flag", async () => {
    await reg.load()
    await reg.add(makeTask())
    await reg.markNotified("ses-1", true)
    const reg2 = new TaskRegistry(dir)
    await reg2.load()
    expect(reg2.get("ses-1")).toMatchObject({ notified: true, failed: true })
  })

  test("#given un-notified completed task in registry #when reconcile #then notifies exactly once", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-done" }))
    const calls: Array<{ id: string; failed: boolean }> = []
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }] }) } }
    await reg.reconcile(fakeClient as never, async (task, failed) => { calls.push({ id: task.sessionID, failed }) })
    expect(calls).toEqual([{ id: "ses-done", failed: false }])
    expect(reg.get("ses-done")?.notified).toBe(true)
  })

  test("#given already notified task #when reconcile #then no second notify", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-done", notified: true }))
    const calls: string[] = []
    await reg.reconcile({ session: { messages: async () => ({ data: [] }) } } as never, async (t) => { calls.push(t.sessionID) })
    expect(calls).toEqual([])
  })

  test("#given task with error in child messages #when reconcile #then notifies with failed=true", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-err" }))
    const calls: Array<{ id: string; failed: boolean }> = []
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "assistant", error: { name: "ApiError" } }, parts: [] }] }) } }
    await reg.reconcile(fakeClient as never, async (task, failed) => { calls.push({ id: task.sessionID, failed }) })
    expect(calls).toEqual([{ id: "ses-err", failed: true }])
  })

  test("#given uncompleted task (only user message, no assistant reply) #when reconcile #then no false completion notify", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-interrupted" }))
    const calls: string[] = []
    // 重启被掐断：子会话只有 user prompt 消息，无 assistant 回复
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "user" }, parts: [{ type: "text", text: "the task prompt" }] }] }) } }
    await reg.reconcile(fakeClient as never, async (t) => { calls.push(t.sessionID) })
    expect(calls).toEqual([])
    expect(reg.get("ses-interrupted")?.notified).toBe(false)
  })

  test("#given notify throws (parent session deleted) #when reconcile #then other tasks still reconcile", async () => {
    await reg.load()
    await reg.add(makeTask({ sessionID: "ses-broken-parent" }))
    await reg.add(makeTask({ sessionID: "ses-good" }))
    const calls: Array<{ id: string; failed: boolean }> = []
    const fakeClient = { session: { messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] }] }) } }
    await reg.reconcile(fakeClient as never, async (task, failed) => {
      if (task.sessionID === "ses-broken-parent") throw new Error("parent session gone")
      calls.push({ id: task.sessionID, failed })
    })
    expect(calls).toEqual([{ id: "ses-good", failed: false }])
    expect(reg.get("ses-broken-parent")?.notified).toBe(false)
  })
})
```

- [ ] **Step 2: 跑 registry 测试验证失败**

Run: `cd opencode-category-router && npm test tests/registry.test.ts`
Expected: FAIL，`Cannot find module "../src/subagent"`

- [ ] **Step 3: 写失败测试（subagent 会话 + provider 聚合）**

`opencode-category-router/tests/subagent.test.ts`:
```typescript
import { describe, expect, test } from "vitest"
import { resolveAvailableModels, buildPromptBody } from "../src/subagent"

describe("resolveAvailableModels", () => {
  test("#given provider.list with connected providers #then aggregates connected models only", async () => {
    const client = {
      provider: {
        list: async () => ({
          data: {
            all: [
              { id: "openai", models: { "gpt-5.6-sol": {}, "gpt-5.4": {} } },
              { id: "anthropic", models: { "claude-sonnet-4-6": {} } },
              { id: "disconnected-provider", models: { "foo-1": {} } },
            ],
            connected: ["openai", "anthropic"],
          },
        }),
      },
    }
    const models = await resolveAvailableModels(client as never)
    expect(models).toEqual(new Set(["openai/gpt-5.6-sol", "openai/gpt-5.4", "anthropic/claude-sonnet-4-6"]))
  })

  test("#given provider.list fails #then returns empty set", async () => {
    const client = { provider: { list: async () => { throw new Error("boom") } } }
    const models = await resolveAvailableModels(client as never)
    expect(models.size).toBe(0)
  })
})

describe("buildPromptBody", () => {
  test("#given model and variant #then body carries top-level variant", () => {
    const body = buildPromptBody({ providerID: "openai", modelID: "gpt-6-astra" }, "high", {
      agent: "category-worker",
      parts: [{ type: "text", text: "hello" }],
      noReply: false,
    })
    expect(body).toMatchObject({ model: { providerID: "openai", modelID: "gpt-6-astra" }, variant: "high", agent: "category-worker", noReply: false })
  })
})
```

- [ ] **Step 4: 跑 subagent 测试验证失败**

Run: `cd opencode-category-router && npm test tests/subagent.test.ts`
Expected: FAIL，`Cannot find module "../src/subagent"`

- [ ] **Step 5: 实现 subagent.ts**

```typescript
import { join } from "node:path"
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"

export interface AvailableModelsClient {
  provider: { list(): Promise<{ data?: { all?: Array<{ id: string; models?: Record<string, unknown> }>; connected?: string[] } }> }
}

export async function resolveAvailableModels(client: AvailableModelsClient): Promise<Set<string>> {
  try {
    const res = await client.provider.list()
    const data = res.data
    const connected = new Set(data?.connected ?? [])
    const out = new Set<string>()
    for (const provider of data?.all ?? []) {
      if (!connected.has(provider.id)) continue
      for (const modelID of Object.keys(provider.models ?? {})) {
        out.add(`${provider.id}/${modelID}`)
      }
    }
    return out
  } catch {
    return new Set()
  }
}

export interface RegisteredTask {
  sessionID: string
  parentID: string
  taskId: string
  category: string
  notified: boolean
  failed: boolean
}

export interface MessagesClient {
  session: { messages(opts: { path: { id: string } }): Promise<{ data?: Array<{ info?: { role?: string; error?: unknown }; parts?: Array<{ type?: string; text?: string }> }> }> }
}

export class TaskRegistry {
  private file: string
  private tasks = new Map<string, RegisteredTask>()

  constructor(projectRoot: string) {
    this.file = join(projectRoot, ".opencode", "category-router", "tasks.json")
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, "utf8")
      const parsed = JSON.parse(raw) as RegisteredTask[]
      this.tasks = new Map(parsed.map((t) => [t.sessionID, t]))
    } catch {
      this.tasks = new Map()
    }
  }

  async add(task: RegisteredTask): Promise<void> {
    this.tasks.set(task.sessionID, task)
    await this.persist()
  }

  get(sessionID: string): RegisteredTask | undefined {
    return this.tasks.get(sessionID)
  }

  async markNotified(sessionID: string, failed: boolean): Promise<void> {
    const task = this.tasks.get(sessionID)
    if (!task) return
    task.notified = true
    task.failed = failed
    await this.persist()
  }

  /** Startup reconciliation: re-notify completed-but-unnotified tasks after restart. */
  async reconcile(client: MessagesClient, notify: (task: RegisteredTask, failed: boolean) => Promise<void>): Promise<void> {
    for (const task of [...this.tasks.values()]) {
      if (task.notified) continue
      const msgs = await client.session.messages({ path: { id: task.sessionID } }).catch(() => ({ data: [] }))
      const list = msgs?.data ?? []
      if (list.length === 0) continue
      const last = list[list.length - 1]
      // 仅当最后一条是 assistant 回复（有结果或错误）才视为"已完成"。
      // 进程重启被掐断的未完成子会话里只有 user prompt 消息（role!=="assistant"），
      // 不得补发虚假"完成"通知——对齐 spec §13"未完成任务停留 notified:false"。
      if (!last?.info || last.info.role !== "assistant") continue
      const failed = Boolean(last.info.error)
      try {
        await notify(task, failed)
        await this.markNotified(task.sessionID, failed)
      } catch {
        // 单任务通知失败（如父会话已删除）不中断对账循环；未标记条目留待下次对账（spec §9 尽力而为）
      }
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(join(this.file, ".."), { recursive: true })
      await writeFile(this.file, JSON.stringify([...this.tasks.values()], null, 2))
    } catch {
      // 尽力而为；写盘失败降级为内存态（spec §13）
    }
  }
}

export interface PromptBody {
  model: { providerID: string; modelID: string }
  agent: string
  parts: Array<{ type: "text"; text: string }>
  noReply: boolean
  variant?: string
}

/** SDK 的 SessionPromptData.body 暂缺 variant 字段（核心已支持），用显式类型携带。 */
export function buildPromptBody(
  model: { providerID: string; modelID: string },
  variant: string | undefined,
  opts: { agent: string; parts: Array<{ type: "text"; text: string }>; noReply: boolean },
): PromptBody {
  return {
    model,
    agent: opts.agent,
    parts: opts.parts,
    noReply: opts.noReply,
    ...(variant !== undefined ? { variant } : {}),
  }
}
```

- [ ] **Step 6: 跑全部 subagent/registry 测试验证通过**

Run: `cd opencode-category-router && npm test tests/registry.test.ts tests/subagent.test.ts`
Expected: PASS（registry 5 + subagent 3）

- [ ] **Step 7: 提交**

```bash
git add opencode-category-router/src/subagent.ts opencode-category-router/tests/registry.test.ts opencode-category-router/tests/subagent.test.ts
git commit -m "feat: add subagent session helpers and durable task registry"
```

---

### Task 6: agent-definition.ts + system-inject.ts

**Files:**
- Create: `opencode-category-router/src/agent-definition.ts`
- Create: `opencode-category-router/src/system-inject.ts`
- Test: `opencode-category-router/tests/agent-definition.test.ts`
- Test: `opencode-category-router/tests/system-inject.test.ts`

**Interfaces:**
- Consumes: `./categories`（`CATEGORIES`、`CATEGORY_NAMES`）
- Produces:
  - `CATEGORY_WORKER_AGENT: { name: "category-worker"; description: string; mode: "subagent"; prompt: string; tools: Record<string, boolean> }`
  - `renderCategoryTable(): string`（markdown 表格 + 使用提示）

- [ ] **Step 1: 写失败测试**

`opencode-category-router/tests/agent-definition.test.ts`:
```typescript
import { describe, expect, test } from "vitest"
import { CATEGORY_WORKER_AGENT } from "../src/agent-definition"

describe("CATEGORY_WORKER_AGENT", () => {
  test("mode is subagent and name is category-worker", () => {
    expect(CATEGORY_WORKER_AGENT.name).toBe("category-worker")
    expect(CATEGORY_WORKER_AGENT.mode).toBe("subagent")
  })
  test("core tools enabled", () => {
    for (const toolName of ["read", "grep", "glob", "edit", "bash"]) {
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
```

`opencode-category-router/tests/system-inject.test.ts`:
```typescript
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd opencode-category-router && npm test tests/agent-definition.test.ts tests/system-inject.test.ts`
Expected: FAIL，`Cannot find module "../src/agent-definition"` / `"../src/system-inject"`

- [ ] **Step 3: 实现 agent-definition.ts**

```typescript
export const CATEGORY_WORKER_AGENT = {
  name: "category-worker",
  description: "通用任务执行代理：接收编排者派发的目标任务，独立探索并完成。",
  mode: "subagent" as const,
  prompt: `你是 category-worker，一个通用任务执行代理。你被编排者以明确目标派发到独立会话中。

执行纪律：
1. 先探索理解，再动手。需要时使用 grep/glob/read 收集上下文。
2. 以目标为授权：不要等待确认，选择你认为最合理的方案并完成它。
3. 记录假设：无法验证的假设在最终回复中写明。
4. 完成即交付：最终回复包含做了什么、证据（命令/测试输出）、遗留假设。
5. 不提问：问题会中断任务。除非遇到不可绕过的阻塞（缺密钥、唯一依赖用户决策）。
6. 禁止自我派发：你不得调用 delegate_task 或任何子任务派发工具。`,
  tools: {
    read: true,
    grep: true,
    glob: true,
    edit: true,
    bash: true,
    ls: true,
    delegate_task: false,
  },
}
```

- [ ] **Step 4: 实现 system-inject.ts**

```typescript
import { CATEGORIES, CATEGORY_NAMES } from "./categories"

export function renderCategoryTable(): string {
  const rows = CATEGORY_NAMES.map((name) => {
    const cat = CATEGORIES[name]
    const variant = cat.variant ? ` (${cat.variant})` : ""
    return `| \`${name}\` | ${cat.description} | ${cat.model}${variant} |`
  }).join("\n")

  return `### 可用任务类别

| 类别 | 用途 | 默认模型 |
|---|---|---|
${rows}

委托子任务时使用 delegate_task(category=..., prompt=...) 指定工作类型，不要手动选模型。`
}
```

- [ ] **Step 5: 跑测试验证通过**

Run: `cd opencode-category-router && npm test tests/agent-definition.test.ts tests/system-inject.test.ts`
Expected: PASS（agent-definition 4 + system-inject 3）

- [ ] **Step 6: 提交**

```bash
git add opencode-category-router/src/agent-definition.ts opencode-category-router/src/system-inject.ts opencode-category-router/tests/agent-definition.test.ts opencode-category-router/tests/system-inject.test.ts
git commit -m "feat: add category-worker agent definition and category table injection"
```

---

### Task 7: plugin.ts（4 hook 组装）

**Files:**
- Create: `opencode-category-router/src/plugin.ts`
- Test: `opencode-category-router/tests/plugin.test.ts`

**Interfaces:**
- Consumes:
  - `./categories`（`CATEGORIES`、`CATEGORY_NAMES`）
  - `./resolve-model`（`resolveModelForDelegateTask`、类型）
  - `./model-utils`（`parseModelString`）
  - `./subagent`（`resolveAvailableModels`、`buildPromptBody`、`TaskRegistry`、`RegisteredTask`）
  - `./agent-definition`（`CATEGORY_WORKER_AGENT`）
  - `./system-inject`（`renderCategoryTable`）
- Produces: `CategoryRouterPlugin: Plugin`（默认导出），含 `tool.delegate_task`、`event`、`experimental.chat.system.transform`、`config`。

**模型决议的冷缓存语义（spec §5）：** `resolveModelForDelegateTask` 返回 `{skipped:true}` 时，跳过 fuzzy，直接采用 `CATEGORIES[category].model` + `.variant`。

- [ ] **Step 1: 写失败测试**

`opencode-category-router/tests/plugin.test.ts`:
```typescript
import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CATEGORY_WORKER_AGENT } from "../src/agent-definition"
import { pluginModule } from "../src/plugin"

function makeClient(overrides: Record<string, unknown> = {}) {
  const session = {
    create: async () => ({ data: { id: "ses-child" } }),
    prompt: async () => ({ data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } }),
    promptAsync: async () => ({ data: undefined }),
    messages: async () => ({ data: [{ info: {}, parts: [{ type: "text", text: "child result" }] }] }),
    delete: async () => ({}),
    ...(overrides.session ?? {}),
  }
  const provider = {
    list: async () => ({ data: { all: [{ id: "openai", models: { "gpt-6-astra": {} } }], connected: ["openai"] } }),
    ...(overrides.provider ?? {}),
  }
  return { session, provider }
}

describe("CategoryRouterPlugin", () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "category-router-plugin-")) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  const ctx = { sessionID: "ses-parent", abort: new AbortController().signal }

  test("config hook injects category-worker agent with delegate_task denied", async () => {
    const plugin = await pluginModule.server({ client: makeClient() as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const config = {} as Record<string, unknown>
    await (plugin.config as (c: Record<string, unknown>) => Promise<void>)(config)
    expect((config.agent as Record<string, unknown>)[CATEGORY_WORKER_AGENT.name]).toMatchObject({ mode: "subagent" })
  })

  test("delegate_task sync mode creates child session and prompts with resolved model + variant", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      session: {
        create: async (a: unknown) => { calls.push({ method: "create", args: a }); return { data: { id: "ses-child" } } },
        prompt: async (a: unknown) => { calls.push({ method: "prompt", args: a }); return { data: { info: { error: undefined }, parts: [{ type: "text", text: "child result" }] } } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "deep", prompt: "do x", run_in_background: false } as never, ctx as never)
    expect(String(result)).toContain("child result")
    expect(calls[0]).toMatchObject({ method: "create", args: { body: { parentID: "ses-parent" } } })
    const promptCall = calls.find((c) => c.method === "prompt")?.args as { path: { id: string }; body: Record<string, unknown> }
    expect(promptCall.path.id).toBe("ses-child")
    expect(promptCall.body).toMatchObject({ model: { providerID: "openai", modelID: "gpt-6-astra" }, variant: "high", agent: "category-worker", noReply: false })
  })

  test("delegate_task unknown category returns error listing categories", async () => {
    const plugin = await pluginModule.server({ client: makeClient() as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "nope", prompt: "x" } as never, ctx as never)
    expect(String(result)).toContain("Unknown category")
    expect(String(result)).toContain("deep")
  })

  test("delegate_task background mode returns task_id and registers task", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const client = makeClient({
      session: {
        create: async (a: unknown) => { calls.push({ method: "create", args: a }); return { data: { id: "ses-bg" } } },
        promptAsync: async (a: unknown) => { calls.push({ method: "promptAsync", args: a }); return { data: undefined } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "quick", prompt: "do y", run_in_background: true } as never, ctx as never)
    expect(String(result)).toContain("task_id")
    expect(calls.some((c) => c.method === "promptAsync")).toBe(true)
  })

  test("delegate_task cold cache falls back to category preferred model", async () => {
    const client = makeClient({ provider: { list: async () => ({ data: { all: [], connected: [] } }) } })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const toolDef = plugin.tool?.delegate_task
    const result = await toolDef!.execute({ category: "writing", prompt: "write docs" } as never, ctx as never)
    expect(String(result)).toContain("child result")
  })

  test("system.transform injects category table", async () => {
    const plugin = await pluginModule.server({ client: makeClient() as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    const output = { system: [] as string[] }
    await (plugin["experimental.chat.system.transform"] as (i: unknown, o: { system: string[] }) => Promise<void>)({}, output)
    expect(output.system.join("\n")).toContain("delegate_task")
    expect(output.system.join("\n")).toContain("deep")
  })

  test("event hook wakes parent on child session.idle with reply-required promptAsync", async () => {
    const calls: Array<unknown> = []
    const client = makeClient({
      session: {
        promptAsync: async (a: unknown) => { calls.push(a); return { data: undefined } },
      },
    })
    const plugin = await pluginModule.server({ client: client as never, directory: dir, worktree: dir, project: {} as never, experimental_workspace: {} as never, serverUrl: new URL("http://localhost"), $: {} as never })
    // register a task via background delegate first
    const toolDef = plugin.tool?.delegate_task
    await toolDef!.execute({ category: "deep", prompt: "do z", run_in_background: true } as never, ctx as never)
    // now emit idle for the child
    await (plugin.event as (i: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void>)({ event: { type: "session.idle", properties: { sessionID: "ses-child" } } })
    expect(calls.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd opencode-category-router && npm test tests/plugin.test.ts`
Expected: FAIL，`Cannot find module "../src/plugin"`

- [ ] **Step 3: 实现 plugin.ts**

```typescript
import { tool, type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { CATEGORIES, CATEGORY_NAMES } from "./categories"
import { resolveModelForDelegateTask, type DelegateModelResolutionInput } from "./resolve-model"
import { parseModelString } from "./model-utils"
import { resolveAvailableModels, buildPromptBody, TaskRegistry, type RegisteredTask, type AvailableModelsClient, type MessagesClient } from "./subagent"
import { CATEGORY_WORKER_AGENT } from "./agent-definition"
import { renderCategoryTable } from "./system-inject"

type OpenCodeClient = AvailableModelsClient & MessagesClient & {
  session: {
    create(opts: { body: { parentID?: string; title?: string } }): Promise<{ data?: { id?: string } }>
    prompt(opts: { path: { id: string }; body: Record<string, unknown> }): Promise<{ data?: { info?: { error?: unknown }; parts?: Array<{ type?: string; text?: string }> } }>
    promptAsync(opts: { path: { id: string }; body: Record<string, unknown> }): Promise<{ data?: unknown }>
    messages(opts: { path: { id: string } }): Promise<{ data?: Array<{ info?: { error?: unknown }; parts?: Array<{ type?: string; text?: string }> }> }>
    delete(opts: { path: { id: string } }): Promise<unknown>
  }
}

function extractText(parts: Array<{ type?: string; text?: string }> | undefined): string {
  return (parts ?? []).filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n").trim()
}

export const CategoryRouterPlugin: Plugin = async ({ client, directory, worktree }) => {
  const projectRoot = worktree ?? directory
  const registry = new TaskRegistry(projectRoot)
  await registry.load()

  const notifyParent = async (task: RegisteredTask, failed: boolean): Promise<void> => {
    const status = failed ? "失败" : "完成"
    const text = `[delegate_task] 后台任务 ${status} (task_id=${task.taskId}, category=${task.category})`
    await client.session.promptAsync({
      path: { id: task.parentID },
      body: { parts: [{ type: "text", text }], noReply: false },
    })
  }

  // 简化 busy 判定：MVP 统一 reply-required；父会话 busy 时 noReply:true 降级作为后续增强（spec §7.3 步骤3）
  await registry.reconcile(client as MessagesClient, notifyParent)

  return {
    tool: {
      delegate_task: tool({
        description: `按任务类别派发子任务到对应模型执行。类别可选：${CATEGORY_NAMES.join(", ")}。指定工作类型，不要手动选模型。`,
        args: {
          category: tool.schema.string().describe("任务类别（见可用类别表）"),
          prompt: tool.schema.string().describe("任务描述，以明确目标形式给出"),
          run_in_background: tool.schema.boolean().optional().describe("后台运行并立即返回 task_id（默认 false）"),
          description: tool.schema.string().optional().describe("任务展示标题"),
        },
        async execute(args, context) {
          const categoryName = args.category
          const category = CATEGORIES[categoryName]
          if (!category) {
            return `Unknown category "${categoryName}". Available: ${CATEGORY_NAMES.join(", ")}`
          }

          const availableModels = await resolveAvailableModels(client as AvailableModelsClient)

          const input: DelegateModelResolutionInput = {
            availableModels,
            categoryDefaultModel: category.model,
            fallbackChain: category.fallbackChain,
          }
          const resolution = resolveModelForDelegateTask(input, {
            connectedProviders: null,
            hasProviderModelsCache: false,
            hasConnectedProvidersCache: false,
          })

          let providerID: string
          let modelID: string
          let variant: string | undefined

          if (resolution && "skipped" in resolution) {
            // 冷缓存：跳过 fuzzy，直接采用类别首选（spec §5）
            const parsed = parseModelString(category.model)
            if (!parsed) return `Invalid preferred model for category "${categoryName}": ${category.model}`
            providerID = parsed.providerID
            modelID = parsed.modelID
            variant = category.variant ?? parsed.variant
          } else if (resolution) {
            const parsed = parseModelString(resolution.model)
            if (!parsed) return `Invalid resolved model "${resolution.model}" for category "${categoryName}"`
            providerID = parsed.providerID
            modelID = parsed.modelID
            variant = resolution.variant ?? category.variant
          } else {
            return `No model available for category "${categoryName}". Connect a provider with: ${category.model} or configure an alternative model.`
          }

          const created = await client.session.create({ body: { parentID: context.sessionID, title: args.description } })
          const sessionID = created?.data?.id
          if (!sessionID) return "Failed to create child session"

          const body = buildPromptBody(
            { providerID, modelID },
            variant,
            {
              agent: CATEGORY_WORKER_AGENT.name,
              parts: [{ type: "text", text: args.prompt }],
              noReply: false,
            },
          )

          if (args.run_in_background) {
            const taskId = sessionID
            await registry.add({ sessionID, parentID: context.sessionID, taskId, category: categoryName, notified: false, failed: false })
            await client.session.promptAsync({ path: { id: sessionID }, body })
            return `Background task started. task_id=${taskId} category=${categoryName}.`
          }

          // 父会话中断（ESC）时中止子会话，避免孤儿任务继续烧 token（spec §7.1 步骤5 / §9）
          const abortChild = (): void => {
            client.session.delete({ path: { id: sessionID } }).catch(() => {})
          }
          if (context.abort.aborted) abortChild()
          context.abort.addEventListener("abort", abortChild, { once: true })
          try {
            const resp = await client.session.prompt({ path: { id: sessionID }, body })
            if (resp?.data?.info?.error) {
              return `Task failed (${categoryName}): ${JSON.stringify(resp.data.info.error)}`
            }
            return extractText(resp?.data?.parts) || `Task completed (${categoryName}) with no text output.`
          } finally {
            context.abort.removeEventListener("abort", abortChild)
          }
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = (event as { properties?: { sessionID?: string } }).properties?.sessionID
      if (!sessionID) return
      const task = registry.get(sessionID)
      if (!task || task.notified) return
      const msgs = await (client as MessagesClient).session.messages({ path: { id: sessionID } }).catch(() => ({ data: [] }))
      const list = msgs?.data ?? []
      const last = list[list.length - 1]
      const failed = Boolean(last?.info?.error)
      await notifyParent(task, failed)
      await registry.markNotified(sessionID, failed)
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(renderCategoryTable())
    },

    config: async (config) => {
      const cfg = config as Record<string, unknown>
      const agents = (cfg.agent ?? {}) as Record<string, unknown>
      const existing = agents[CATEGORY_WORKER_AGENT.name] as { tools?: Record<string, boolean> } | undefined
      // 浅合并 + tools 深层合并：用户 JSONC 已定制的 category-worker（如放开 delegate_task）不被插件默认值踩掉（spec §7.5）
      agents[CATEGORY_WORKER_AGENT.name] = {
        ...CATEGORY_WORKER_AGENT,
        ...existing,
        tools: { ...CATEGORY_WORKER_AGENT.tools, ...(existing?.tools ?? {}) },
      }
      cfg.agent = agents
    },
  }
}

// opencode 插件加载契约：模块必须导出 { server: Plugin }（PluginModule 形状），
// 裸函数导出会导致加载器找不到 server 属性、插件不加载。
export const pluginModule: PluginModule = { server: CategoryRouterPlugin }
export default pluginModule
```

> **实现注记（供执行者）：**
> - `@opencode-ai/plugin` 的 `ToolDefinition` 要求 `args` 为 zod shape，必须用 `tool()` 工厂 + `tool.schema.*`（已在上文采用）。若本机 `@opencode-ai/plugin` 版本对 `tool.schema` 的暴露方式不同，参照 `~/.config/opencode/node_modules/@opencode-ai/plugin/dist/tool.d.ts` 适配。
> - `client.session.promptAsync` / `messages` 的调用形状若与 SDK 版本不符（扁平 `{ sessionID, ... }` vs `{ path, body }`），以本机 `@opencode-ai/sdk` 类型为准适配，并将 `OpenCodeClient` 接口同步修改。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd opencode-category-router && npm test tests/plugin.test.ts`
Expected: PASS（7 个用例）。若 `args` schema 校验失败，按实现注记改用 `tool()` 工厂。

- [ ] **Step 5: 类型检查**

Run: `cd opencode-category-router && npm run typecheck`
Expected: 无类型错误（若 SDK 类型对 `prompt`/`promptAsync` body 形状报错，用 `as never`/局部接口适配，不改业务逻辑）。

- [ ] **Step 6: 提交**

```bash
git add opencode-category-router/src/plugin.ts opencode-category-router/tests/plugin.test.ts
git commit -m "feat: assemble plugin with delegate_task tool, event wake, category injection, agent config"
```

---

### Task 8: 构建、分发与真实加载冒烟

**Files:**
- Create: `opencode-category-router/README.md`
- Modify: `opencode-category-router/package.json`（若 build 输出路径需微调）

**Interfaces:**
- Consumes: 全部 `src/*`，`src/plugin.ts` 入口
- Produces: `dist/index.js`（opencode 可直接加载的插件单文件）

- [ ] **Step 1: 构建插件**

Run: `cd opencode-category-router && npm run build`
Expected: 生成 `dist/index.js`，无报错

- [ ] **Step 2: 写 README**

`opencode-category-router/README.md`:
```markdown
# opencode-category-router

按任务类别派发不同模型的 opencode 插件。

## 安装

将 `dist/index.js` **平铺**到 opencode 插件目录（opencode 插件加载为单层 glob，`plugins/*.js`，子目录不会被扫描）：

```bash
mkdir -p ~/.config/opencode/plugins
ln -sf "$PWD/dist/index.js" ~/.config/opencode/plugins/category-router.js
```

重启 opencode 后生效。插件注入 `category-worker` 代理并注册 `delegate_task` 工具。

## 用法

编排者调用：

```
delegate_task(category="deep", prompt="...", run_in_background=true)
```

- 类别可选：visual-engineering / ultrabrain / deep / artistry / quick / unspecified-low / unspecified-high / writing
- sync（默认）：阻塞等待子会话结果。
- background：立即返回 task_id，完成后唤醒父会话。

## 配置

类别与执行代理可通过 opencode 配置覆盖（`agent` / `tool` 权限块）。
```

- [ ] **Step 3: 真实加载冒烟**

在隔离 XDG 沙箱中验证插件被 opencode 加载（不污染真实 `~/.config/opencode`）。**插件文件必须平铺在 `plugins/` 根**（单层 glob，子目录不加载）：
```bash
export XDG_CONFIG_HOME=$(mktemp -d)
export XDG_DATA_HOME=$(mktemp -d)
export XDG_STATE_HOME=$(mktemp -d)
export XDG_CACHE_HOME=$(mktemp -d)
mkdir -p "$XDG_CONFIG_HOME/opencode/plugins"
cp opencode-category-router/dist/index.js "$XDG_CONFIG_HOME/opencode/plugins/category-router.js"
opencode run --format json "list the tools you have available" 2>&1 | grep -q delegate_task && echo "PLUGIN LOADED: delegate_task present"
```
Expected: 输出 `PLUGIN LOADED: delegate_task present`（若本机无 `opencode` 可执行文件或未配置 provider，此步跳过并在证据中记录原因）。

- [ ] **Step 4: 全量测试回归**

Run: `cd opencode-category-router && npm test`
Expected: 全部 PASS（smoke 1 + model-utils 8 + resolve-model 9 + categories 6 + registry 7 + subagent 3 + agent-definition 4 + system-inject 3 + plugin 7 ≈ 48 用例）

- [ ] **Step 5: 提交**

```bash
git add opencode-category-router/README.md
git commit -m "docs: add category-router plugin README with install and usage"
```

---

## Self-Review（writing-plans 自审）

**1. Spec 覆盖核对：**
- §2 目标：`delegate_task` 工具（T7）、8 类别（T4）、7 步决议（T3）、config 注入 agent（T7）、system.transform 注入（T7）、sync/background（T5/T7）、variant 顶层传递（T5 `buildPromptBody`）— 全覆盖
- §4 依赖闭包：model-utils 拷贝（T2）、resolve-model 拷贝（T3）、categories（T4）— 全覆盖
- §5 冷缓存语义：T7 实现 `{skipped}` → 类别首选 — 覆盖
- §7.1 abort 中断：T7 execute 监听 `context.abort` → `session.delete` — 覆盖
- §7.3 注册表/对账/防重入/失败唤醒：T5 registry + T7 event — 覆盖；对账已加 assistant-role 门控（未完成任务不补发）与逐任务错误隔离
- §7.3 busy 降级：**已知取舍**（见下第 4 条）
- §7.5 worker deny delegate_task：T6 + T7 config — 覆盖；config 浅合并保留用户定制
- §10 文件结构：全部文件在 T2-T8 创建 — 覆盖
- §11 测试策略：解析逻辑（T2/T3）、hook 行为（T7）、注册表（T5）、冷缓存（T7）— 覆盖
- §12 分发：T8 平铺安装（`.opencode/plugins/category-router.js`），因 opencode 加载为单层 glob，已同步修正

**2. Placeholder 扫描：** 无 TBD/TODO/"implement later"；T7 实现注记给出的是适配指引而非占位。

**3. 类型一致性：** `resolveModelForDelegateTask(input, deps)` 签名在 T3（定义）与 T7（调用）一致；`RegisteredTask` 字段在 T5/T7 一致；`buildPromptBody` 返回含顶层 `variant`，T7 断言 `variant: "high"` 一致；`MessagesClient.info` 新增 `role` 字段在 T5（定义）与 T5 测试（fakeClient）一致。

**4. 已知取舍（记录而非隐藏）：**
- §7.3 busy 降级路径在 MVP 中统一为 reply-required，父会话 busy 时的 `noReply:true` 降级作为后续增强——**这是对 spec §7.3 步骤3 的主动取舍**，非 spec 授权砍除；已在上轮审查中显式裁决。
- 任务注册表条目只增不删（`notified:true` 永久堆积，`tasks.json` 无界增长）：MVP 接受，清理机制列为后续增强。
- 多 opencode 实例共享同一项目 `tasks.json` 存在 last-write-wins 竞态：spec §7.3 已声明项目级路径权衡，MVP 接受（单一实例是主要使用场景）。
- spec §11 要求的 `category-model-availability.test.ts` 以 T4 `categories.test.ts`（回退链/首选一致性断言）等价覆盖——**已声明的测试策略偏离**。

**5. 深度审查修复落点：** 版本号 `^0.1.0`→`^1.18.0`（npm E404，T1）、插件平铺安装（单层 glob，T8）、T4 测试5 断言改比较 modelID、reconcile 加 role 门控+错误隔离、abort 接线、测试 mkdtemp 隔离+`afterEach` 导入、config 浅合并、`description` 接入 `session.create.title`。

---

## Execution Handoff

计划已保存至 `docs/superpowers/plans/2026-09-06-category-router-plugin.md`。执行方式二选一：

**1. Subagent-Driven（推荐）** — 每任务派发独立 subagent，任务间审查，快速迭代。
**2. Inline Execution** — 当前会话内批量执行，检查点审查。