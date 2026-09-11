import type { CategoryConfig } from "./category-config"

export function renderCategoryTable(categories: CategoryConfig): string {
  const rows = Object.keys(categories)
    .sort()
    .map((name) => {
      const cat = categories[name]
      const variant = cat.variant ? ` (${cat.variant})` : ""
      return `| \`${name}\` | ${cat.description} | ${cat.model}${variant} |`
    })
    .join("\n")

  return `### 可用任务类别

| 类别 | 用途 | 默认模型 |
|---|---|---|
${rows}

委托子任务时使用 delegate_task(category=..., prompt=...) 指定工作类型，不要手动选模型。`
}
