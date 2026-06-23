---
description: 子代理驱动实施计划文档
---

# 指令

使用 `subagent-driven-development` skill 执行指定的 Plan 文档。全程使用中文思考和交流。

## 预检（执行前必须完成）

1. **Plan 文件存在**：检查用户提供的 plan 路径是否可读
2. **基线测试通过**：运行 `pytest tests/ -x --tb=short` 确认基线是绿色的（允许已知的预有失败，但不能有新增失败）
3. **工作区隔离**：使用 `using-git-worktrees` skill 创建/确认独立 worktree，包含 `.venv` 和 `node_modules`
4. **前端环境**（如 Plan 涉及前端）：确认 `.venv/bin/activate && cd frontend && npm test` 基线通过

## 任务分配策略

**不要对每个 Task 都派发子代理。先根据复杂度分类：**

| 复杂度 | 判断标准 | 执行方式 |
|--------|---------|---------|
| **Trivial** | 单文件 ≤ 10 行改动，无新概念 | **自己执行**（不派发子代理）。直接编辑 → 验证 → 提交 |
| **Medium** | 2-3 文件，有逻辑变更 | 派发子代理，`category="unspecified-high"` |
| **Complex** | 新建文件、架构级改动 | 派发子代理，`category="deep"` |

**关键规则**：
- Trivial task **绝不派发子代理**。子代理的开销（加载上下文 + 定位代码 + 理解意图）远超 3 行改动的价值。
- 自己执行完 trivial task 后，立即调 `/review-changes` 自查。

## 执行流程

```
预检通过 → 读取 Plan → 创建 Todo 列表 → 第一波并行派发
                                            ↓
                              等待所有子代理完成
                                            ↓
                              逐任务审查子代理输出（/review-changes 风格自查）
                                            ↓
                              ✅ 通过 → 下一波并行派发
                              ❌ 失败 → session_id 重试，仍失败则自己修复
```

## 子代理失败恢复

| 失败类型 | 处理 |
|---------|------|
| Agent 执行出错（非代码问题） | `session_id` 重试 1 次 |
| 代码逻辑错误（测试不过） | 自己检查原因。如果是 trivial 级改动 → 自己修复；如果复杂 → session_id 传错误信息让 Agent 修正 |
| 超时 | 降级为自己执行 |
| 重复失败（2 次） | **放弃子代理，自己完成该 Task** |

## 审查门

每个 Task 完成后（无论子代理还是自己执行），必须：
1. `lsp_diagnostics` 对变更文件 → 必须是 0 errors
2. 运行该 Task 的验证命令（Plan 中定义）→ 必须通过
3. 如果 Plan 中定义了 commit 消息 → 立即 commit

## 完成

全部 Task 完成后：
1. 全量测试：`pytest tests/` + `cd frontend && npm test`
2. `npm run build`（前端项目）
3. 报告执行统计（N 个 commit、M 个文件改动、测试结果）
4. 提示用户下一步：部署验证 或 `/changes-submit` 提交到远程