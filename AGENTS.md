# AGENTS.md

## 这是什么

OpenCode 配置工具集（agents / commands / skills 的 Markdown 集合），**不是应用代码**。根目录没有 `package.json`、构建、测试或 lint 配置——不要去找，也不要凭空生成。

## 语言约定

**全程中文**：文档、命令、Skill、commit message、与用户交互都用中文。唯一的英文例外是目录名、文件名、代码标识符和 external skill 的原文。

## 目录结构与职责

| 路径 | 内容 | 约定 |
|------|------|------|
| `agents/*.md` | 子代理定义（`design-critic`、`plan-reviewer`） | YAML frontmatter 含 `mode: subagent` / `model` / `temperature`；正文用中文 |
| `commands/*.md` | 斜杠命令 | frontmatter 只有 `description`；正文以 `# 指令` 开头 |
| `skills/<name>/SKILL.md` | 技能 | frontmatter 含 `name` / `description`；附属文件（prompt、脚本、模板）与 SKILL.md 同目录 |
| `docs/superpowers/specs/YYYY-MM-DD-{slug}.md` | 设计文档（Spec） | 由 `before-dev` 产出 |
| `docs/superpowers/plans/YYYY-MM-DD-{slug}.md` | 实施计划（Plan） | 由 `dev-plan` 产出 |
| `.worktrees/` | Git worktree | 已被 `.gitignore` 忽略，不要提交 |

## 核心工作流

产物链路（每个命令在 `commands/` 下有对应文件）：

```
before-dev → Spec(specs/) → /plan-review → dev-plan → Plan(plans/) → /esdp → /review-changes → /changes-submit
```

- `/plan-review` 按路径路由 Agent：`specs/` → `design-critic`（架构质询）；`plans/` → `plan-reviewer`（可执行性审查）。加 `quick` 只验证上轮修复，加 `deep` 双 Agent。
- `/esdp` 用 `subagent-driven-development` skill 执行 Plan；trivial 任务自己改，不派子代理。
- 这两个审查 Agent **只读不写**，输出中文问题清单；命令负责根据问题清单修复。
- 命令/技能里出现的 `task`、`lsp_diagnostics`、`codegraph_explore`、`session_read`、`background_output` 是 oh-my-opencode 系 harness 工具，普通 opencode 未必存在，按实际可用性降级。

## 陷阱

- **`*:Zone.Identifier` 文件是 Windows ADS 元数据**，由 `.gitignore` 规则 `*:Zone.Identifier` 忽略。绝大多数未跟踪，**不要读取、编辑或提交**。注意 `skills/grill-me/agents/openai.yaml:Zone.Identifier` 和 `skills/handoff/agents/openai.yaml:Zone.Identifier` 历史遗留已被跟踪，别误改。
- **`*.bak`（`opencode.jsonc.bak`、`oh-my-opencode.jsonc.bak`）是参考配置备份**，被 `.gitignore` 忽略且未跟踪。需要看 MCP/agent 配置样例时读它们，但不要当成生效配置，也不要提交。
- 仓库无 `README`；新读者靠本文件和 `commands/` 自解释。

## 进行中的工作：opencode-category-router 插件

- 实际代码在 **worktree** `.worktrees/feat-category-router-plugin`（分支 `feat/category-router-plugin`），主工作区没有 `opencode-category-router/` 目录。
- Spec/Plan：`docs/superpowers/specs/2026-09-06-category-router-plugin.md`、`docs/superpowers/plans/2026-09-06-category-router-plugin.md`。
- 该插件约束（实现前先读 Plan 的 Global Constraints）：**Node 工具链**（npm + vitest + esbuild），`src/` 禁用 Bun API 只用 `node:*`；测试用 vitest；从 omO 拷贝的纯函数源码**逐字保留原注释**。

## 提交

- Commit message 用中文，无固定前缀强制。
- 除非用户明确要求，不要主动 commit / push。
