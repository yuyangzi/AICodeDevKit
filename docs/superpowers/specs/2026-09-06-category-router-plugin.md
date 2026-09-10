# 类别路由插件（category-router-plugin）设计文档

**日期：** 2026-09-06
**状态：** 深度审查修复完成（§12 分发路径平铺），待复审
**目标位置：** AICodeDevKit 仓库

## 1. 背景与动机

oh-my-openagent（omO）实现了"按任务类别派发不同模型"的能力：Sisyphus（主编排代理）派发子任务时只指定**类别（category）**，由解析引擎把类别映射到具体的 `provider/model`，再交给通用执行代理以独立子会话运行。这套机制的核心价值是：

1. **多档回退链**：每个类别有 `{providers[], model, variant}` 序列，首选不可用时逐级回退到其它 provider 的等价模型。
2. **可用性感知**：基于 opencode 实际可用的模型列表做 fuzzy 匹配，冷缓存时不猜模型。
3. **编排者无感**：主代理只描述"这是什么类型的工作"，模型选择完全自动化。

但该功能深埋在 omO 的 45 包 monorepo 中，与 BackgroundManager、sisyphus-junior 动态 prompt、model-capabilities 等强耦合。本设计将其**抽离精简为一个独立的 opencode 插件**，保留核心价值（类别表 + 7 步决议 + fuzzy 匹配 + 回退链），砍掉 omO 专属深度调优。

## 2. 目标与非目标

### 目标
- 注册一个自定义 `delegate_task` 工具：`delegate_task(category=..., prompt=...)` 创建指定模型的独立子会话。
  - 工具名刻意避开 opencode 内置的 `task` 工具（TaskTool，subagent 派发），避免注册同名工具产生覆盖/共存不确定性。
- 8 个内置类别 + 完整回退链（移植自 omO `CATEGORY_MODEL_REQUIREMENTS`）。
- 7 步模型决议（移植自 omO `delegate-core` 的 `resolveModelForDelegateTask`）。
- 通过 `config` hook 注入插件自带的"通用执行代理"定义。
- 通过 `experimental.chat.system.transform` 把类别表注入主会话 system prompt，教编排者用类别而非模型。
- 支持 sync（阻塞等待结果）与 background（立即返回 task_id，完成后唤醒父会话）两种模式。
- variant（max/high/...）通过 `promptAsync` body 顶层 `variant` 字段直接传递（opencode prompt input 原生支持）。

### 非目标（明确不做）
- 不做 `model-capabilities` 能力启发式与 variant 兼容性 clamp（variant 直接透传给 opencode）。
- 不做 sisyphus-junior 动态 prompt 分档（统一用一份精简通用执行 prompt）。
- 不做 unstable-agent 跟踪、runtime-fallback、并发限流、session 恢复等 omO 深度增强。
- 不做团队模式 / goal / hashline 等其它 omO 功能。
- **不采用"零自研执行层"替代方案**（config hook 注入每类别一个 agent + `tool.execute.before` 改写内置 `task`）：opencode 单个 agent 的 `model` 是单值，无法表达回退链与 fuzzy 匹配，会丢失本插件核心价值；且拦截改写内置工具侵入性强。

## 3. 架构概览

```
opencode 插件（单模块导出 Plugin 函数，返回 Hooks）
│
├── tool hook          → 注册 delegate_task 工具（派发入口）
├── event hook         → 监听子会话 session.idle，后台任务完成唤醒父会话
├── experimental.chat.system.transform hook → 注入类别表
└── config hook        → 注入通用执行代理定义（category-worker）
```

核心解析逻辑全部为**纯函数**（无 harness 依赖），从 omO 直接拷贝源码，保留版权头。**无 `chat.params` hook**——子会话的 variant 直接随 `promptAsync` body 顶层 `variant` 字段传递，插件不维护任何按 session 的 variant 状态。

## 4. 依赖闭包（从 omO 复用，全部纯函数）

| 来源文件 | 内容 | 行数 | 依赖 |
|---|---|---|---|
| `delegate-core/src/model-selection.ts` | `resolveModelForDelegateTask` 7 步决议 | 279 | 下 4 项 |
| `model-core/src/model-availability.ts` | `fuzzyMatchModel` / `isModelAvailable` | 66 | 无 |
| `model-core/src/model-string-parser.ts` | `parseModelString` / `parseVariantFromModelID` | 65 | reasoning-level |
| `model-core/src/reasoning-level.ts` | `splitReasoningSuffix` / 级别常量 | 52 | 无 |
| `model-core/src/model-normalization.ts` | `normalizeModel` / `normalizeModelID` | 8 | 无 |
| `model-core/src/provider-model-id-transform.ts` | `transformModelForProvider` | 74 | 无 |
| `model-core/src/category-model-requirements.ts` | `CATEGORY_MODEL_REQUIREMENTS` 回退链 | 142 | 无 |

合计约 **686 行纯逻辑**。不依赖 `model-capabilities`（已确认 `fuzzyMatchModel`、`parseModelString` 均不触碰该模块）。

## 5. 模型决议优先级（7 步）

`resolveModelForDelegateTask` 依次裁决：

1. 用户模型覆盖（`userModel`）；首选不可达时提升用户 `fallback_models` 中首个可达项。
2. 冷缓存：`provider.list()` 不可用/返回空时，`resolveModelForDelegateTask` 收到空 `availableModels` 与 `connectedProviders=null` → 返回 `{skipped: true}`。**插件语义**：跳过 fuzzy 匹配，直接采用类别首选模型（或用户显式配置）下发，由 opencode 运行时决定模型是否可用；不报错、不猜测其它 provider。与 omO 的"回退显式配置继续执行"语义一致，只是显式配置的优先级更高。
3. 类别默认模型：对 `availableModels` 做 `fuzzyMatchModel`（`-high` 模型只精确匹配其基座，不做模糊降级）。
4. 用户 `fallback_models` 数组。
5. 硬编码 `fallbackChain`：逐档逐 provider 精确→模糊匹配，含跨 provider 兜底与 `transformModelForProvider` 整形。
6. 系统默认模型。
7. `undefined`（决议失败，由调用方报错，列出可用类别并提示连接 provider）。

## 6. 类别表（内置 8 类）

移植自 `CATEGORY_MODEL_REQUIREMENTS` + omO 类别首选配置：

| 类别 | 首选 | 回退链要点 |
|---|---|---|
| `visual-engineering` | anthropic/claude-fable-5-1 (max) | → claude-opus-5 (max) → kimi-k3 (max) |
| `ultrabrain` | openai/gpt-6-astra (max) | → gpt-5.6-sol (max)，跨 openai/copilot/opencode |
| `deep` | openai/gpt-6-astra (high) | → gpt-5.6-sol (medium) |
| `artistry` | anthropic/claude-fable-5-1 (max) | → kimi-k3 (max) → claude-opus-5 (xhigh) |
| `quick` | kimi-for-coding-highspeed | → gpt-5.6-luna-fast → deepseek-v4-flash → claude-haiku-4-5 等 8 档 |
| `unspecified-low` | xai/grok-4.6 (xhigh) | → gpt-5.6-terra → claude-sonnet-5 → qwen3.8-max → deepseek-v4-pro |
| `unspecified-high` | openai/gpt-6-astra (high) | → claude-opus-5 (xhigh) → glm-5.3 → kimi-k3 |
| `writing` | anthropic/claude-fable-5-1 (medium) | → kimi-k3 (max) |

类别表以 `Record<categoryName, { model, variant, fallbackChain, description }>` 形式内嵌于插件源码。

## 7. Hook 详细设计

### 7.1 `tool` — delegate_task 工具

**args schema：**
- `category: string`（必填，类别名）
- `prompt: string`（必填，任务描述）
- `run_in_background?: boolean`（默认 `false`）
- `description?: string`（TUI 展示标题）

**execute 流程：**
1. `client.provider.list()` 获取可用模型集（遍历各 provider 的 `models`，聚合为 `provider/model` 的 `Set<string>`；`connected` 列表用于过滤未连接 provider）。
2. 调用 `resolveModelForDelegateTask`（用户类别覆盖 + 内置类别 + 7 步决议）。
3. `client.session.create({ body: { parentID: 当前 sessionID } })` 创建子会话。
4. 决议结果直接组装进 prompt body，**不记录任何按 session 的内存 map**：
   - sync 模式：`client.session.prompt({ path: { id }, body: { model: {providerID, modelID}, variant, agent: "category-worker", system, tools, parts, noReply: false } })`，`await` 其响应体（`{info: AssistantMessage, parts}` 即完成信号），返回子会话最终文本。
   - background 模式：`client.session.promptAsync({ path: { id }, body: { model, variant, agent, system, tools, parts, noReply: false } })`，HTTP 立即返回（响应为 `204 NoContent`，无响应体）；**task_id 由插件自生成**（可用子会话 sessionID 或 UUID），返回给编排者；assistant 循环在后台运行（`noReply: false` 是关键——`noReply: true` 会让核心添加消息后直接返回、不启动 loop），完成回调由 event hook 负责。
5. **错误与中断处理**：
   - sync：以 `await` 响应体中的 `info.error`（`AssistantMessage.error` 字段）为主信号，`session.error` 事件为兜底——双通道避免双报/漏报；响应 `ToolContext.abort`（父会话 ESC 时中止子会话，避免孤儿任务继续烧 token）。
   - background：`promptAsync` 抛错时返回失败状态，不阻塞编排者。

### 7.2 variant 传递（无独立 hook）

- variant（`off/minimal/low/medium/high/xhigh/max`）作为 `promptAsync` body 的**顶层 `variant` 字段**直接传递——opencode prompt input schema 原生支持 `variant: optional(String)`（已由二进制确认），omO 生产代码 `manager.ts` 亦在 `promptAsync` body 直接传 `variant`。
- **不维护 `Map<sessionID, variant>`、不注册 `chat.params` hook**。这避免了"插件重启后 variant 状态丢失"和"chat.params 时序依赖"两个问题。
- 注：本机 SDK 生成类型 `SessionPromptData.body` 暂缺 `variant` 字段（SDK 落后于核心），实现时用类型断言或 pin SDK 版本。

### 7.3 `event` — 后台任务完成唤醒

- 监听 `session.idle`。
- 若 idle 会话是插件创建的 background 子会话（在**磁盘持久化的任务注册表**中，见下）：
  1. 读取子会话最新消息，检查是否携带失败（`AssistantMessage.error`）。
  2. 以 `client.session.promptAsync({ body: { parts, noReply: false } })` 注入父会话——**reply-required**（省略 `noReply` 或 `noReply: false`），父会话 assistant loop 被触发、编排者被唤醒。失败子会话同样唤醒，通知内容携带失败信息与 task_id。
  3. 降级路径：若父会话正处于 busy 或用户消息刚到达（可通过 event hook 自身维护的父会话忙状态判断），改用 `noReply: true` 仅注入提示消息，由用户当前 turn 消费——对齐 omO `parent-wake-flush-runner` 的 admit-only 语义。
- 防重入：同一子会话只唤醒一次（注册表记录 `notified: true`）。
- **持久化与对账**：任务注册表（`sessionID → { parentID, task_id, category, notified, failed }`）写入**项目级**路径（插件配置目录下、以当前工作目录区分，如 `<project>/.opencode/category-router/tasks.json`），避免多 opencode 实例共享全局文件互相覆盖。插件启动时执行**对账**：扫描注册表中 `notified: false` 的条目 → 查子会话最新消息 → 若子会话已完成（有结果/失败）则补发唤醒并标记；确保重启后未发出的通知仍能送达。写盘为尽力而为，写失败降级为内存态（记录已知限制）。

### 7.4 `experimental.chat.system.transform` — 类别表注入

- **统一注入，不区分主会话与子会话**：该 hook 的 input 只有 `{sessionID?, model}`，无法识别 sync 子会话（插件不为 sync 子会话维护任何状态；event hook 维护的父会话忙状态仅用于唤醒降级判定，见 §7.3 步骤3，与本节识别无关）。`category-worker` 已默认 deny `delegate_task`，对 worker 注入类别表仅占用少量 context、无递归风险，故接受重复注入。
- 渲染为 markdown 表格：`| 类别 | 用途 | 默认模型 |`，追加提示：`delegate 子任务时使用 delegate_task(category=..., prompt=...) 指定工作类型，不要手动选模型。`

### 7.5 `config` — 通用执行代理注入

- 注入名为 `category-worker` 的 agent 定义（模仿 omO `sisyphus-junior` 的定位）：
  - `mode: "subagent"`，简洁通用执行 prompt，tools 白名单（read/grep/glob/edit/bash 等核心集），**默认 deny `delegate_task`**——执行代理不得自我派发，避免绕过核心 TaskTool 的深度计数导致无界递归；用户可在 JSONC 中显式放开。
  - 与类别表一起供用户通过 JSONC 覆盖。
- 注入的 agent 名在 delegate_task 工具中作为子会话 `agent` 使用。

## 8. 数据流

**sync 模式（`run_in_background=false`，默认）：**
1. 编排者调用 `delegate_task(category="deep", prompt="...")`。
2. 插件 `client.provider.list()` 获取可用模型集。
3. `resolveModelForDelegateTask` 决议出 `{providerID, modelID, variant}`。
4. `client.session.create({ body: { parentID } })` 创建子会话。
5. `client.session.prompt({ path: { id }, body: { model, variant, agent: "category-worker", system, noReply: false, parts } })`。
6. `await` prompt 响应体（`{info: AssistantMessage, parts}` 即完成信号），返回子会话最终文本给编排者。
7. 若子会话触发 `session.error`（模型调用失败）→ 报错回传；若 `ToolContext.abort` 触发 → 中止子会话。

**background 模式（`run_in_background=true`）：**
1-4 同 sync。
5. `client.session.promptAsync({ path: { id }, body: { ..., noReply: false, variant } })`，HTTP 立即返回（204），task_id 由插件自生成并返回，任务注册表落盘（项目级路径）。
6. `event` hook 收到该子会话 `session.idle` 后，检查失败状态，以 reply-required（`noReply: false`）注入父会话，附 task_id 与类别（失败时附失败信息），注册表标记已唤醒。
7. 插件重启时对账注册表：补发 `notified: false` 且已完成条目的唤醒通知。

**variant 流转：** 决议出的 variant 直接作为 prompt/promptAsync body 的顶层 `variant` 字段下发，opencode 核心读取并应用到该子会话的每次请求。插件全程无按 session 的 variant 状态。

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| 类别不存在 | 工具报错，列出可用类别 |
| 回退链全部不可用 | 报错：连接对应 provider 或改类别配置 |
| 冷缓存（provider.list 空/失败） | 跳过 fuzzy 匹配，直接采用类别首选模型（或用户显式配置）下发，不报错 |
| 子会话创建/prompt 失败 | sync 报错回传；background 记录失败并标记任务 |
| 子会话执行失败（info.error） | sync 报错回传；background **带失败通知唤醒**父会话（附失败信息与 task_id，对齐 omO `notifyParentSession` 语义） |
| 父会话中断（ToolContext.abort） | sync 中止子会话，避免孤儿任务 |
| 插件重启丢任务注册表 | 项目级 JSON 持久化 + 启动对账补发；写盘失败降级内存态（已通知任务重启后不再唤醒，记入已知限制） |

## 10. 文件结构

```
AICodeDevKit/
└── opencode-category-router/
    ├── src/
    │   ├── plugin.ts            # 入口：4 个 hook 组装（tool/event/system.transform/config）
    │   ├── resolve-model.ts     # 移植 delegate-core model-selection（含 7 步决议）
    │   ├── model-utils.ts       # 移植 fuzzyMatch / parseModelString / reasoning / normalize / transform
    │   ├── categories.ts        # 8 类别表 + 回退链 + 描述
    │   ├── subagent.ts          # session.create/prompt(Async) 封装 + 任务注册表持久化
    │   ├── agent-definition.ts  # category-worker 代理定义
    │   └── system-inject.ts     # 类别表渲染
    └── tests/
        ├── resolve-model.test.ts    # 移植 omO model-selection.test.ts
        ├── categories.test.ts       # 回退链与首选一致性
        ├── subagent.test.ts         # mock client 断言 create/prompt 参数（model/variant/agent/noReply）
        └── registry.test.ts         # 任务注册表持久化与防重入
```

## 11. 测试策略

- **解析逻辑**：移植 omO `delegate-core/model-selection.test.ts` + `category-model-availability.test.ts`（覆盖 7 步决议与回退链）。
- **hook 行为**：mock client 测 `delegate_task` 工具（断言 session.create/prompt(Async) 的参数：model、variant 顶层字段、agent、noReply）。
- **任务注册表**：测持久化（重启后仍可唤醒）、防重入（同一子会话只唤醒一次）、启动对账补发（`notified:false` 且已完成条目被补发）、失败唤醒（error 子会话带失败信息通知父会话）。
- **冷缓存**：测 provider.list 空时回落类别首选模型、不报错。
- **不测真实模型调用**，对 provider 无依赖。测试用 bun:test。

## 12. 分发方式

- **本地开发**：`dist/index.js` **平铺**到 `.opencode/plugins/category-router.js`（opencode 插件加载为单层 glob `plugins/*.js`，子目录不会被扫描）直接加载（或软链）。
- **npm 发布（后续）**：`opencode.json` 的 `plugin` 数组一行引入。
- 本期先落地本地插件形态，npm 发布作为可选后续项。

## 13. 风险与取舍

- **variant 不做 clamp**：极端配置下 variant 与模型不兼容时依赖 opencode 自身处理（可接受，换来体积大幅精简）。
- **任务注册表持久化尽力而为**：项目级路径 + 启动对账补发；写盘失败降级内存态，重启后未通知的 background 任务不再唤醒父会话（不阻塞主流程）。**对账边界**：对账仅补发"已完成"条目；若 opencode 进程整体重启，未完成的子会话 loop 已终止，其注册表条目将永久停留 `notified:false` 且无事件可触发唤醒——记入已知限制（可后续通过任务清理机制回收）。
- **父会话忙时唤醒降级**：reply-required 唤醒在父会话 busy 时降级为 `noReply: true` 提示注入，由用户当前 turn 消费（对齐 omO admit-only 语义）。
- **回退链数据随模型演进过期**：类别表为静态数据，模型换代需手动更新（与 omO 共享数据源，未来可考虑脚本同步）。
- **单会话内换模型不可行**：opencode `chat.params` 无法改 model，故本插件只支持"子会话指定模型"，不支持主会话中途换模型——这是产品边界，不是缺陷。
- **SDK 类型滞后**：`SessionPromptData.body` 暂缺 `variant` 字段（核心已支持），实现用类型断言或 pin SDK 版本。
- **provider.list 依赖**：决议依赖 `client.provider.list()` 的结果质量；provider 列表聚合失败时走冷缓存回落路径（类别首选模型），功能不中断。