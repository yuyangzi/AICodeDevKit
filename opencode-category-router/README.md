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
