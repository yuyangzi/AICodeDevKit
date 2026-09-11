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

// 防止用户配置里的 "__proto__" 键落到普通对象的原型上（类别名会被静默丢弃）。
const FORBIDDEN_CATEGORY_KEYS = new Set(["__proto__"])

function isCategoryDef(value: unknown): value is CategoryDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const def = value as Record<string, unknown>
  if (typeof def.model !== "string" || def.model.trim().length === 0) return false
  if (typeof def.description !== "string") return false
  if (def.variant !== undefined && typeof def.variant !== "string") return false
  return true
}

/** Validate an arbitrary object as a CategoryConfig. Returns undefined when any entry is malformed. */
export function sanitizeConfig(input: unknown): CategoryConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const out: CategoryConfig = {}
  for (const [name, def] of entries) {
    if (!name.trim() || FORBIDDEN_CATEGORY_KEYS.has(name) || !isCategoryDef(def)) return undefined
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

/** Read `options.categories`; fall back to the bundled template when absent or malformed. */
export function loadCategoryConfig(options: unknown): CategoryConfig {
  const raw = (options as { categories?: unknown } | undefined)?.categories
  if (raw !== undefined) {
    const sanitized = sanitizeConfig(raw)
    if (sanitized) return sanitized
    console.warn(
      "[category-router] 提供的 categories 配置非法（需为 { 类别名: { description, model, variant? } }），已改用内置默认模板。",
    )
  }
  return cloneConfig(DEFAULT_CATEGORIES)
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
