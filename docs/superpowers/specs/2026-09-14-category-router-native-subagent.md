# 类别路由插件改造：类别 subagent + 原生 task 设计文档

**日期：** 2026-09-14
**状态：** 已实现并通过运行时验证（V0 原生派发 / system.transform 注入 / V2 递归闸门已验证；V1 待配置 variant 后验证），见 §10 验证状态
**目标位置：** AICodeDevKit / opencode-category-router
**前置文档：** `docs/superpowers/specs/2026-09-06-category-router-plugin.md`

## 1. 背景与动机

现插件（`2026-09-06-category-router-plugin`）自研了 `delegate_task(category=..., prompt=...)` 工具，内部用 `client.session.create({ parentID })` + `body.agent = "category-worker"` 跑子会话。

问题：**子会话在 TUI 里点不进去。**

排查本机 opencode 1.18.30 二进制后确认根因：

- 终端 TUI 的"子代理卡片"是**按工具名硬编码分发**的：`Is.render(tool) ?? 通用渲染`，其中 `task` 名字映射到专用卡片组件；该组件读取 `part.state.metadata.sessionId` 找子会话，`onClick` 执行 `navigate({type:"session",sessionID})`。**只有 `tool === "task"` 走这条分支**，通用工具渲染不读 `metadata.sessionId`。Web/桌面 UI 同理（`Is.register({name:"task",...})`）。
- 内置 `task` 工具的 `execute` 在创建子会话后调用 `ctx.metadata({ title, metadata: { parentSessionId, sessionId, model, background? } })`，这就是卡片能定位子会话的契约。

因此，"像原生子代理一样点击进入"只有两条路：① 劫持 `task` 名字（插件工具与内置同名时插件优先），或 ② **不覆盖任何工具，改用原生 `task` 本身**。

**劫持 `task` 的代价过高**：内置 `task` 还依赖插件拿不到的内部服务——`ctx.extra.promptOps`、background job manager、`task_id` 续跑、权限 `ask({permission:"task"})`、`subagent_depth` 深度限制。劫持即重实现，且必然丢失这些行为。

**本设计采用方案 ②：注册"每类别一个 subagent"，让编排者直接调用原生 `task`。** 原生卡片、点击进入、background、权限、深度限制、模型/variant 全部白拿，零重实现（其中 `variant` 生效性与 `subagent_depth` 默认值两项待验证，见 §10 V1/V2）。

## 2. 目标与非目标

### 目标
- `config` hook 为每个类别注入一个同名的 `mode: "subagent"` agent，字段映射：`description` / `model` / `variant` / 共享执行 `prompt` / tools 白名单。
- `experimental.chat.system.transform` 注入类别表，改为教编排者使用 **原生** `task(subagent_type="<类别>", prompt=..., description=...)`。
- 子会话由此获得与原生子代理一致的 TUI 行为：可点击/可键位进入、会话树挂载、background（需 experimental 开关）、权限、深度限制（默认值见 §10 V2）。
- 删除自研派发层：`delegate_task` 工具、`TaskRegistry`、`subagent.ts`、`event` 唤醒 hook、自研 sync/background。

### 非目标（明确不做）
- **不覆盖内置 `task` 工具**（放弃方案 C：重实现原生 Task，且会丢续跑/权限/深度/`promptOps`）。
- 不做回退链 / `fuzzyMatchModel` / 冷缓存决议——沿用当前实现的"每类别单一 `model`"，可用性交由 opencode 运行时处理。
- 不做自研 background / 任务注册表 / 启动对账（原 spec §7.3 整套废弃，能力缺口见 §10）。
- 不新增 TUI 插件（无插槽可渲染工具卡片；见 §1 证据）。
- 不改动 `opencode.jsonc` 的 `options.categories` 配置格式（`{ 类别名: { description, model, variant? } }` 保持不变）。

> **对前置 spec 的推翻**：原 spec §2 曾把"config hook 注入每类别一个 agent"列为非目标，理由是"opencode 单个 agent 的 `model` 是单值，无法表达回退链"。当前实现（`src/category-config.ts`）本来就已是单模型、无回退链，故该顾虑不再成立。原 spec 的 `delegate_task` / 任务注册表设计随之作废。

## 3. 架构概览

```
opencode 插件（单模块导出 Plugin 函数，返回 Hooks）
│
├── config hook                             → 每类别注入一个同名 subagent
└── experimental.chat.system.transform hook → 注入类别表 + 教用原生 task
```

子会话创建/运行/唤醒/后台/权限全部由 opencode 原生 `task` 工具负责，插件不介入。插件从"派发器"退化为"类别 → agent 定义 + 类别表提示"的**声明式配置源**。

## 4. 类别 → agent 映射

对 `loadCategoryConfig(options)` 得到的每个类别 `{ description, model, variant? }`：

| agent 字段 | 取值 | 说明 |
|---|---|---|
| agent 名（key） | 类别名，如 `deep`、`quick` | 直接暴露为 `task` 的 `subagent_type`；须满足 §4.4 命名约束 |
| `mode` | `"subagent"` | 不可作为主 agent（不可被 Tab 切换选中） |
| `description` | 类别 `description` | 原生 `task` 卡片的 agent 展示名 |
| `model` | `parseCategoryModel(...)` 的 `provider/model` | 必须含 provider 前缀 |
| `variant` | `parseCategoryModel(def).variant`（即 `def.variant`，或 `model` 内嵌的 `provider/model:variant`） | 由 opencode 应用到该 agent 的每次请求；**传播机制见 §10「待验证假设 V1」** |
| `prompt` | 共享执行 prompt 常量 | **必须改写**，见 §4.3 |
| `tools` | 默认集：`read/grep/glob/edit/bash/ls = true`、`task = false` | 见 §4.2 |

### 4.1 用户覆盖与合并语义

与现实现一致，`config` hook 合并插件默认与用户 JSONC 中的同名 agent，但**修正语义为真正"用户优先"**：

- 用户提供的字段逐一覆盖插件默认值。
- `tools`：用户未提供 `tools` 时使用默认集；用户提供 `tools` 时，**用户提供的键值优先，且不为其未列出的工具补插件默认**（避免旧实现 `plugin.ts` 的 `{...default.tools, ...existing.tools}` 并集语义踩用户）。**唯一例外是递归闸门 `task`**：除非用户在同名 agent 显式写了 `task` 键，否则始终补 `task:false`——这是安全不变量（见 §4.2），不属静默踩踏。
- 类别 agent 与内置（`general`/`explore`）及用户 agent 共享命名空间。默认类别名与内置无冲突；同名时按上述"用户优先"处理。

### 4.2 递归闸门

- **主闸门（可验证）**：类别 agent 的 `tools.task = false`，禁止其派生下级子代理。该值由 §4.1 的合并规则**保证**：无论用户是否提供 `tools`、是否漏写 `task`，只要未显式写 `task:true`，结果集都含 `task:false`——因此"用户提供部分 `tools` 而漏写 `task`"不会静默打开闸门。
- **纵深防御（待验证）**：原生 `subagent_depth`（默认值见 §10「待验证假设 V2」）为第二道闸门。
- **唯一显式放开路径**：用户在同名 agent 显式写 `tools: { task: true }` 时，闸门改由 `subagent_depth` 单独兜底——该路径的可靠性依赖 V2 验证结果。

### 4.3 共享 prompt 改写（必须）

现 `src/agent-definition.ts` 的 prompt 存在两处必须改写的残留：

- 身份句"你是 category-worker"——每个类别 agent 名字已不再是 `category-worker`，改为通用自称（如"你是类别 `<类别名>` 的工作代理"）。
- "禁止自我派发：你不得调用 `delegate_task` 或任何子任务派发工具"——`delegate_task` 已删除，改为"你不应再派生下级子代理；不要调用 `task`"（与 §4.2 的 `task:false` 一致）。

### 4.4 类别名约束

- 合法名须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（opencode agent 名安全字符集）；不满足者**跳过该类别** + `console.warn`。
- 渲染类别表时对 `description` 做 markdown 转义（`|` → `\|`、换行 → 空格），避免污染表格。

## 5. Hook 详细设计

### 5.1 `config` — 类别 agent 注入

```
categories = loadCategoryConfig(options)        // 见 §5.3 语义
for (name, def) of categories:
    if !isValidAgentName(name): warn(...); continue
    parsed = parseCategoryModel(def)
    if !parsed: warn(`[category-router] 类别 "${name}" 的 model 非法（需 provider/model），已跳过`); continue
    agents[name] = mergeUserOverride(defaultAgent(name, def, parsed), userAgents[name])
```

- **单个类别非法只跳过该类别**（其余照常注入），不整体回落。
- `config` hook 不抛异常；注入失败降级为跳过该类别。
- 维护 `injected: Set<string>`（成功注入的类别名），供 §5.2 渲染类别表——被跳过的类别不进入表。

### 5.2 `experimental.chat.system.transform` — 类别表注入

渲染 markdown 表格（同现格式：`| 类别 | 用途 | 默认模型 |`），**数据源为 §5.1 成功注入的类别集**（被跳过的类别不出现，避免表格通告一个必然报 `Unknown agent type` 的 `subagent_type`）。尾注从 `delegate_task(...)` 改为**面向编排者**的措辞：

`（编排者）委托子任务时使用 task(subagent_type="<类别名>", prompt=..., description=...)，指定工作类型，不要手动选模型；子代理自身不应再派发下级子任务。`

- **统一注入、不区分主/子会话**（现行为，保持不变）。对类别 subagent 注入时，"请用 task"与子代理的 `task:false` 不构成冲突——尾注已明确区分"编排者"与"子代理自身"，子代理读到的是"不应再派发"，与 `task:false` 一致。
- **保留该表的理由**：原生 `task` 描述会列出各 agent 及其 `description`，但**不含"类别 → 默认模型"映射**；本表的关键增量正是这列模型信息，供编排者按成本/能力选类别。两处重复的只是 agent 名与 `description`（原生自动生成），模型列不重复——故保留。
- **零类别边界**：若成功注入的类别集为空（如显式 `{}`），不注入表格与尾注（避免空表 + 指示调用不存在的 `subagent_type`）。

### 5.3 配置加载语义（修正，消除与实现矛盾）

`category-config.ts` 需按下列语义调整（当前 `sanitizeConfig` 为全表回落，与本节冲突）：

| 输入 | 语义 |
|---|---|
| `options.categories` 缺失 | 回落内置默认模板（`default-categories.json`） |
| `options.categories` 非对象 / 是数组（整体类型非法） | 回落内置默认模板 + `console.warn` |
| `options.categories === {}`（显式空表） | **视为显式禁用全部类别**：不注入任何 agent、不回落默认 + `console.warn` |
| 单条 shape 非法（缺 `model`、`model` 非字符串、空名、`__proto__`） | **仅跳过该条** + `console.warn`，其余照常注入（需把 `sanitizeConfig` 由"整表 `undefined`"改为逐条判定） |
| 表合法但某条 `model` 无 provider 前缀 / 名字非法 | **仅跳过该条** + `console.warn`，其余照常注入 |

- `parseCategoryModel` 仍负责把 `provider/model[:variant]` 拆成 `{ model, variant }`。

## 6. 数据流

1. opencode 启动加载插件 → `config` hook 注入类别 agents。
2. 主会话 system prompt 获得类别表。
3. 编排者调用原生 `task(subagent_type="deep", description="...", prompt="...")`。
4. opencode 原生 `task`：按 `subagent_type` 查表拿到该 agent 的 `model`/`variant` → 建子会话（`parentID`）→ `ctx.metadata({ metadata: { sessionId, parentSessionId, model } })` → 跑子会话。
5. TUI 渲染为**原生子代理卡片**；点击或 `session_child_first`（默认 `<leader>+↓`）进入子会话查看详情。
6. 后台：`task(..., background=true)`（参数名见下），由原生 job manager 处理并在完成/失败时唤醒父会话——**依赖 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`**。

> **`background` 参数名**：目标是**原生 opencode** `task`，其 schema 用 `background`（二进制已核实）。本仓库另一套 oh-my-opencode harness 暴露的 `task` 用 `run_in_background`，两者不是同一实现；文档/README 注明差异，本设计以原生 opencode 为准。

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| `options.categories` 缺失 / 非对象或数组（整体类型非法） | 回落内置默认模板 + `console.warn` |
| `options.categories` 显式空表 `{}` | 不注入任何类别 + `console.warn`（视为禁用） |
| 单条 shape 非法（缺 `model`、类型错、空名、`__proto__`） | 仅跳过该条 + `console.warn`，其余照常 |
| 某类别 `model` 无 provider 前缀 / 名字非法 | 跳过该类别 agent 注入 + `console.warn`，其余照常 |
| 类别名与用户 agent 同名 | 用户字段覆盖；用户 `tools` 提供的键优先，且仍强制 `task:false`（除非用户显式 `task:true`） |
| 编排者传入未注册的 `subagent_type` | 原生 `task` 报 `Unknown agent type`（插件不处理） |
| 子会话失败/中断 | 原生 `task` 负责（error/cancel 语义、`abort` 中止） |
| 后台子会话完成 | 原生 job manager 唤醒父会话（需 experimental 开关） |

## 8. 文件结构（改造后）

```
opencode-category-router/
├── src/
│   ├── plugin.ts            # 入口：config + system.transform 两个 hook
│   ├── category-config.ts   # 配置加载/逐条校验/parseCategoryModel（按 §5.3 调整语义）
│   ├── model-utils.ts       # parseModelString（保留）
│   ├── agent-definition.ts  # 共享 prompt 常量（按 §4.3 改写）+ buildCategoryAgent(name, def, parsed)
│   ├── system-inject.ts     # 类别表渲染（尾注改 §5.2 措辞）
│   └── default-categories.json  # 内置默认模板（不变）
└── tests/
    ├── category-config.test.ts  # 保留，新增 §5.3 语义用例（空表/逐条跳过）
    ├── model-utils.test.ts      # 保留
    ├── agent-definition.test.ts # 重写：映射、tools 白名单、prompt 无 delegate_task/category-worker 残留
    ├── system-inject.test.ts    # 重写：断言含 task(subagent_type=...) 且不含 delegate_task
    ├── plugin.test.ts           # 重写：config 注入 + 用户覆盖合并（含 tools 整体采用）+ 非法类别跳过 + system.transform
    └── smoke.test.ts            # 保留
```

**删除**：`src/subagent.ts`、`tests/registry.test.ts`、`tests/subagent.test.ts`。
**同步更新**：`src/system-inject.ts` 尾注、`src/agent-definition.ts` prompt（§4.3）、`README.md`——用法章节改为原生 `task(subagent_type=...)`，移除 `delegate_task` / `run_in_background` / `task_id` 描述，标注后台需 experimental 开关，并增述 `categories:{}` 的语义反转（现在 `README.md:24` 只写"缺失或非法→回落默认"，需补"显式空表→禁用全部、不回落"）。
**磁盘残留**：旧 `TaskRegistry` 落盘 `<project>/.opencode/category-router/tasks.json` 在删除注册表后无消费者；本设计**不读取、不清理**，README 加一句"可手动删除该遗留文件"。

## 9. 测试策略

- **agent 映射**：`buildCategoryAgent` 对给定类别产出 `{ mode:"subagent", description, model, variant, prompt, tools }`；`task:false`；缺 `variant` 时不写该字段；prompt 中不含 `delegate_task` / `category-worker`。
- **config 注入**：`config` hook 后 `config.agent` 含全部类别名且 `model`/`variant`/`mode` 正确；用户同名定义字段优先；用户提供部分 `tools` 时保留用户键且仍强制含 `task:false`（除非用户显式 `task:true`）。
- **配置语义（§5.3）**：显式空表 → 不注入；单条 shape/前缀非法 → 仅跳过该条，其余注入；非法类别名 → 跳过；被跳过类别不出现在 §5.2 表格。
- **system.transform**：注入文本包含 `task(subagent_type=`、类别名与 `description`，且不含 `delegate_task`；零类别时不注入表格与尾注。
- **不再测试**：`delegate_task`、任务注册表、session.create/prompt 参数、event 唤醒（相关代码已删）。
- 测试用 vitest（现工具链），不依赖真实模型/provider。

## 10. 风险、待验证假设与能力缺口

### 验证状态（2026-09-15 运行时回填）

- **V2（递归闸门）— 已验证成立**：重启加载新构建后派发 `task(subagent_type="quick", ...)`，被派发子代理的工具列表中**不含 `task`**，即 `tools.task=false` 生效，子代理无法派生下级子代理。主闸门独立成立；原生 `subagent_depth` 默认值虽未直接测量，已不影响结论。
- **V0（原生卡片/派发）— 已验证**：类别子代理经**原生 `task`** 成功创建（子代理 system prompt 自报 `你是类别 "quick" 的工作代理`），`dist` 产物含 `task(subagent_type=` 且 0 处 `delegate_task`/`category-worker`；子会话即原生 task 子会话，TUI 卡片/点击由原生机制提供（§1 证据）。
- **system.transform 注入 — 已验证**：新文案 `（编排者）委托子任务时使用 task(subagent_type="<类别名>", ...)` 已出现在新创建子代理的 system prompt 中。
- **V1（`variant` 传播）— 仍待验证**：当前 `opencode.jsonc` 的 8 个类别**均未配置 `variant`**，该路径未被触发。
  - 验证：给任一类别加 `"variant": "high"`，重启后 `task(subagent_type=...)` 派发，检查子会话实际请求的 variant。
  - 背景：core schema 存在 agent `variant`（二进制偏移约 104310769，`"applies only when using the agent's configured model"`），但安装的 `@opencode-ai/sdk@^1.18.0` 的 `AgentConfig` **未收编**该字段（类型需断言），且原生 `task` 在 agent 有 `model` 时传 `variant: undefined`。
  - 降级：若不生效，则每类别的 variant 不可控 → 记录为已知限制，或改用 `provider/model:variant` 形式（若 core 支持并被 `parseCategoryModel` 保留）。

### 已知能力缺口（相对旧插件，明确声明）

- **启动对账丢失**：旧插件在进程重启后补发 `notified:false` 的后台任务通知（原 spec §7.3、§13 L209）；原生 `task` **无等价物**，故删除后该能力消失，重启后中断的后台任务不会补唤醒。
- **父会话 busy 降级丢失**：旧插件的 reply-required 在父会话 busy 时降级为 `noReply:true` 的 admit-only 注入；原生 `task` 的唤醒由 job manager 负责，**不受插件控制，此降级能力丢失**。
- **后台唤醒依赖实验开关**：`background=true` 需 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`；关闭时原生 `task` 直接报错。

### 其他风险与取舍

- **破坏性接口变更**：`delegate_task(category=...)` → `task(subagent_type=...)`。已有依赖旧工具的 prompt/Rules 需同步更新；本设计一并改 `system-inject`、`agent-definition` prompt 与 README。
- **命名空间共享**：类别名即 agent 名，可能与用户/内置 agent 冲突；默认名已避开内置，冲突时用户定义优先（§4.1）。
- **`tools` 字段 deprecated**：opencode 已建议迁移到 `permission`；本期沿用 `tools`（现实现亦如此），后续跟进。
- **回退链缺失**：类别只有单 `model`，不可用时由 opencode 运行时处理，不做 fuzzy/回退（与当前实现一致，非本次引入）。

## 11. 证据（本机 opencode 1.18.30）

- TUI 工具渲染按名分发、`task` 专用卡片读 `part.state.metadata.sessionId` 并 `navigate`：二进制偏移约 1066xxxxx、106630537。
- Web UI 工具渲染注册表 `Is = { register, render }`，`Is.register({name:"task",...})` 读 `metadata.sessionId`：偏移约 149570821、149579605。
- 内置 `task` 工具 execute 设置 `metadata = { parentSessionId, sessionId, model, ...(background?{background:true}:{}) }`，并依赖 `ctx.extra.promptOps`、`subagent_depth`、权限 `ask`、`task_id`、background job manager；schema 中后台参数名为 `background`：偏移约 96845500–96849982。
- agent 配置 schema 含 `variant`（"applies only when using the agent's configured model"）：偏移约 104310769。
- opencode 插件文档：插件工具与内置同名时插件优先（本条仅用于说明"劫持"可行，本设计不采用）。
