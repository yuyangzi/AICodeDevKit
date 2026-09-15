import defaultCategories from "./default-categories.json"
import { parseModelString } from "./model-utils"

export interface CategoryDef {
  description: string
  model: string
  variant?: string
}

export type CategoryConfig = Record<string, CategoryDef>

export interface ParsedCategoryModel {
  providerID: string
  modelID: string
  variant?: string
}

// 防止用户配置里的 "__proto__" 键落到普通对象的原型上。
const FORBIDDEN_CATEGORY_KEYS = new Set(["__proto__"])

// 类别名即 agent 名，须落在 opencode agent 名的安全字符集内。
export const CATEGORY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isValidCategoryName(name: string): boolean {
  return name.trim().length > 0 && !FORBIDDEN_CATEGORY_KEYS.has(name) && CATEGORY_NAME_RE.test(name)
}

function isCategoryDef(value: unknown): value is CategoryDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const def = value as Record<string, unknown>
  if (typeof def.description !== "string") return false
  if (typeof def.model !== "string" || def.model.trim().length === 0) return false
  if (def.variant !== undefined && typeof def.variant !== "string") return false
  return true
}

/**
 * 逐条校验：非对象/数组 → undefined；否则只保留合法条目，非法条目 warn 后跳过。
 * 注意：不校验 provider 前缀（那是 parseCategoryModel 的职责）。
 */
export function sanitizeConfig(input: unknown): CategoryConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const out: CategoryConfig = {}
  for (const [name, def] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidCategoryName(name)) {
      console.warn(`[category-router] 忽略非法类别名 "${name}"（需匹配 ${CATEGORY_NAME_RE} 且非 __proto__）`)
      continue
    }
    if (!isCategoryDef(def)) {
      console.warn(`[category-router] 忽略格式非法的类别 "${name}"（需 { description, model, variant? }）`)
      continue
    }
    out[name] = {
      description: def.description,
      model: def.model,
      ...(def.variant !== undefined ? { variant: def.variant } : {}),
    }
  }
  return out
}

function cloneConfig(config: CategoryConfig): CategoryConfig {
  return Object.fromEntries(Object.entries(config).map(([name, def]) => [name, { ...def }]))
}

/** Bundled fallback template, used when the plugin receives no valid `categories` option. */
export const DEFAULT_CATEGORIES: CategoryConfig = sanitizeConfig(defaultCategories) ?? {}

/**
 * 语义（spec §5.3）：
 * - 缺失 categories → 内置默认模板（不 warn）
 * - 非对象/数组 → 内置默认模板 + warn
 * - 显式 {} 或全部条目非法 → 返回 {}（禁用全部）+ warn
 * - 部分条目非法 → 仅跳过该条，其余生效
 */
export function loadCategoryConfig(options: unknown): CategoryConfig {
  const raw = (options as { categories?: unknown } | undefined)?.categories
  if (raw === undefined) return cloneConfig(DEFAULT_CATEGORIES)

  const sanitized = sanitizeConfig(raw)
  if (sanitized === undefined) {
    console.warn("[category-router] categories 配置类型非法（需为对象），已改用内置默认模板。")
    return cloneConfig(DEFAULT_CATEGORIES)
  }
  if (Object.keys(sanitized).length === 0) {
    console.warn("[category-router] categories 为空或全部条目非法，视为禁用全部类别。")
    return {}
  }
  return sanitized
}

/** Split a configured `provider/model[:variant]` string into prompt body parts. */
export function parseCategoryModel(category: CategoryDef): ParsedCategoryModel | undefined {
  const parsed = parseModelString(category.model)
  if (!parsed) return undefined
  const variant = category.variant ?? parsed.variant
  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    ...(variant !== undefined ? { variant } : {}),
  }
}
