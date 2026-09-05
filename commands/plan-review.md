---
description: 审查设计或实施文档
---

# 指令

启动并行审查Agent，对指定文档进行严格评审。全程使用中文思考和交流。

## 第一步：确定审查深度和文档类型

根据用户参数判断文档类型和深度：

| 信号 | 文档类型 | 审查深度 | Agent 配置 |
|------|---------|---------|-----------|
| 无特殊标记，路径含 `specs/` | **设计文档** | **标准** | `design-critic`（单 Agent，架构质询） |
| 无特殊标记，路径含 `plans/` | **实施计划** | **标准** | `plan-reviewer`（单 Agent，可执行性审查） |
| `quick` / `fast` | 按文档类型路由 | **快速抽查** | 同标准 Agent（spec→design-critic, plan→plan-reviewer），prompt 附加 "quick review: 仅验证上轮修复是否落地" |
| `deep` / `full` | 任意 | **深度审查** | `design-critic` + `plan-reviewer` 双 Agent，必要时追加 Oracle |

**示例**：
- `docs/superpowers/specs/xxx.md` → 设计文档，标准审查（design-critic）
- `docs/superpowers/plans/xxx.md` → 实施计划，标准审查（plan-reviewer）
- `docs/superpowers/plans/xxx.md quick` → 快速抽查（plan-reviewer，仅验证修复）
- `docs/superpowers/specs/xxx.md quick` → 快速抽查（design-critic，仅验证修复）
- `docs/superpowers/specs/xxx.md deep` → 深度审查（双 Agent）

## 第二步：根据文档类型启动审查 Agent

### 设计文档（specs/）

```python
task(subagent_type="design-critic", run_in_background=true, load_skills=[], description="design-critic review [doc]", prompt="审查文档: {filepath}")
```

### 实施计划（plans/）

```python
task(subagent_type="plan-reviewer", run_in_background=true, load_skills=[], description="plan-reviewer review [doc]", prompt="审查文档: {filepath}")
```

### 快速抽查（quick/fast）

使用与标准审查相同的 Agent，但 prompt 末尾附加 `\n\n**快速模式**: 仅验证上轮修复是否已落地。跳过全量检查，直接检查上轮指出的问题是否已修复。` 以触发渐进式审查深度。

```python
task(subagent_type="design-critic", run_in_background=true, load_skills=[], description="design-critic quick review [doc]", prompt="审查文档: {filepath}\n\n**快速模式**: 仅验证上轮修复是否已落地。跳过全量检查，直接检查上轮指出的问题是否已修复。")
```

### 深度审查（deep/full）

```python
task(subagent_type="design-critic", run_in_background=true, load_skills=[], description="design-critic review [doc]", prompt="审查文档: {filepath}")
task(subagent_type="plan-reviewer", run_in_background=true, load_skills=[], description="plan-reviewer review [doc]", prompt="审查文档: {filepath}")
```

等待 Agent 完成后收集结果。

### 任务 ID 失效兜底（必备）

如果后台 Agent 任务 ID 失效（超时、跨会话、会话重启），**不要手动 cancel + 重派**。改用兜底逻辑：

```python
# 1. 尝试从失效的 task_id 读取（可能已失败）
try:
    result = await background_output(task_id=task_id, block=False)
except Exception:
    result = None

# 2. 兜底：用 session_read 读取该 agent 会话的完整消息
if result is None:
    # 通过 session 工具读取 agent 的实际输出
    session = await session_read(session_id=agent_session_id)
    result = session
```

规则：task_id 失效时，用 `session_read` 读取 agent 会话内容作为兜底结果，绝不重复派发同一审查。

## 第三步：合成审查报告（结构化）

将 Agent 发现合并为统一报告，**必须**按以下格式呈现：

```
## 审查报告：[文档名]

### 🔴 阻断性问题（必须修复才能继续）
| # | 问题 | 来源 | 位置 |
|---|------|------|------|
| 1 | ... | design-critic/plan-reviewer | ... |

### 🟠 高优先级（执行中必遇）
| # | 问题 | 来源 |
|---|------|------|
| ... | ... | ... |

### 🟡 建议优化（不阻塞）
| # | 建议 | 来源 |
|---|------|------|
| ... | ... | ... |

### ✅ 确认正确
- 项1
- 项2

### 四维度评估（仅 Plan 审查时）
| 维度 | design-critic | plan-reviewer |
|------|---------------|---------------|
| ① 清晰度 | ✅/❌ | ✅/❌ |
| ② 可验证性 | ✅/❌ | ✅/❌ |
| ③ 完整性 | ✅/❌ | ✅/❌ |
| ④ 技术准确性 | ✅/❌ | ✅/❌ |
```

**关键规则**：
- 每个问题必须标注严重度（🔴🟠🟡）和来源（design-critic/plan-reviewer/共识）
- 共识项（多个 Agent 都发现）精炼为一条，标注"共识"
- 四维度评估仅对 Plan 文档输出

## 第四步：根据审查结果行动

| 审查结果 | 行动 |
|---------|------|
| 🔴 阻断问题 ≤ 2 个 | **自动修复**文档中的问题（不需要用户确认），修复后提示用户可进行下一轮审查 |
| 🔴 阻断问题 ≥ 3 个 | 呈现报告，**询问用户**："要我直接修复这些阻断问题吗？" |
| 仅有 🟡 建议 | 呈现报告 + "无阻断问题，可直接进入执行阶段。需要我修复建议项吗？" |
| 全部通过 | 呈现报告 + "审查通过 ✅。文档就绪，可以开始实施。" |

**重要**：不要等用户说"更新计划"再动手。≤2 个阻断问题直接修。≥3 个才询问。

## 审查判定标准

**design-critic 关注**：
- 架构矛盾：消费方缺失、存储目的不明
- 序列化/边界问题：datetime、null、并发
- 连锁影响：blast radius、API 暴露
- AI-slop：scope 膨胀、过早抽象、过度校验

**plan-reviewer 关注**：
- 引用有效性：文件存在、行号正确
- 可执行性：每个 task 有起点
- QA 场景完整性：工具 + 步骤 + 断言
- 阻断器：内部矛盾、不可能要求