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