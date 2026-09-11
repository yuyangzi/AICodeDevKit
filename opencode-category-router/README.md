# opencode-category-router

按任务类别派发不同模型的 opencode 插件。类别与模型全部来自 JSON 配置，插件源码不含任何模型数据。

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
- `categories` 为 `{ 类别名: { description, model, variant? } }`；`model` 必须是 `provider/model` 形式，`variant` 可选（也可写成 `provider/model:variant`）。
- **未提供 `categories` 或格式非法时**，插件回落到内置默认模板（8 个类别，见 `src/default-categories.json`）。opencode 不会把默认值写回 `opencode.jsonc`。
- 若只想要默认类别，也可把 `dist/index.js` 平铺/软链到 `~/.config/opencode/plugins/`，但该方式无法传入 options，只能用默认模板。

重启 opencode 后生效。插件注入 `category-worker` 代理并注册 `delegate_task` 工具。

## 用法

编排者调用：

```
delegate_task(category="deep", prompt="...", run_in_background=true)
```

- `sync`（默认，`run_in_background=false`）：阻塞等待子会话结果。
- `background`（`run_in_background=true`）：立即返回 task_id，完成后唤醒父会话。
- 类别不存在或 `model` 非法时返回错误并列出可用类别；不做可用性探测与回退。
