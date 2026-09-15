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
