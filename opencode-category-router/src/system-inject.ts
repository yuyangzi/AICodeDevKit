import type { CategoryConfig } from "./category-config"

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

export function renderCategoryTable(categories: CategoryConfig): string {
  const names = Object.keys(categories).sort()
  if (names.length === 0) return ""

  const rows = names
    .map((name) => {
      const cat = categories[name]
      const variant = cat.variant ? ` (${cat.variant})` : ""
      return `| \`${name}\` | ${escapeCell(cat.description)} | ${cat.model}${variant} |`
    })
    .join("\n")

  return `### 可用任务类别

| 类别 | 用途 | 默认模型 |
|---|---|---|
${rows}

（编排者）委托子任务时使用 task(subagent_type="<类别名>", prompt=..., description=...)，指定工作类型，不要手动选模型；子代理自身不应再派发下级子任务。`
}
