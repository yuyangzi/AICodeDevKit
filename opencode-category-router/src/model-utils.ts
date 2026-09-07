export function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	return trimmed || undefined
}

export function normalizeModelID(modelID: string): string {
	return modelID.replace(/\.(\d+)/g, "-$1")
}

export const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]
export const REASONING_AUTO = "auto" as const

const REASONING_LEVEL_SET = new Set<string>(REASONING_LEVELS)
const REASONING_LEVEL_OR_AUTO_SET = new Set<string>([...REASONING_LEVELS, REASONING_AUTO])

export function isReasoningLevel(value: string): value is ReasoningLevel {
  return REASONING_LEVEL_SET.has(value)
}

export function isReasoningLevelOrAuto(value: string): value is ReasoningLevel | typeof REASONING_AUTO {
  return REASONING_LEVEL_OR_AUTO_SET.has(value)
}

export function normalizeReasoning(input: string): { level?: ReasoningLevel | typeof REASONING_AUTO; passthrough?: string } {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return {}
  if (normalized === "none") return { level: "off" }
  if (normalized === REASONING_AUTO) return { level: REASONING_AUTO }
  if (isReasoningLevel(normalized)) return { level: normalized }
  return { passthrough: normalized }
}

export function clampReasoningLevel(value: string, allowed: readonly string[]): ReasoningLevel | undefined {
  const ladder: readonly string[] = REASONING_LEVELS
  const requestedIndex = ladder.indexOf(value)
  if (requestedIndex === -1) return undefined
  for (let index = requestedIndex; index >= 0; index -= 1) {
    const candidate = REASONING_LEVELS[index]
    if (candidate !== undefined && allowed.includes(candidate)) return candidate
  }
  return undefined
}

export function splitReasoningSuffix(
  model: string,
  options?: { readonly allowMaxSuffix?: boolean },
): { base: string; level?: string } {
  if (typeof model !== "string") return { base: "" }
  const trimmed = model.trim()
  if (!trimmed) return { base: "" }
  const separatorIndex = trimmed.lastIndexOf(":")
  if (separatorIndex === -1) return { base: trimmed }
  const base = trimmed.slice(0, separatorIndex).trim()
  const token = trimmed.slice(separatorIndex + 1).trim().toLowerCase()
  if (!base || !isReasoningLevelOrAuto(token)) return { base: trimmed }
  // ":max" doubles as a real model-id ending, so bare ids keep it attached unless the
  // caller knows the string is provider-prefixed (pi's allowMaxSuffix gating).
  if (token === "max" && !(options?.allowMaxSuffix ?? base.includes("/"))) return { base: trimmed }
  return { base, level: token }
}

export function parseVariantFromModelID(
  rawModelID: string,
  options?: { readonly allowMaxSuffix?: boolean },
): { modelID: string; variant?: string } {
  if (typeof rawModelID !== "string") {
    return { modelID: "" }
  }
  const trimmedModelID = rawModelID.trim()
  if (!trimmedModelID) {
    return { modelID: "" }
  }

  const parenthesizedVariant = trimmedModelID.match(/^(.*)\(([^()]+)\)\s*$/)
  if (parenthesizedVariant) {
    const modelID = parenthesizedVariant[1]?.trim() ?? ""
    const variant = parenthesizedVariant[2]?.trim()
    return variant ? { modelID, variant } : { modelID }
  }

  const suffixedModel = splitReasoningSuffix(trimmedModelID, options)
  if (suffixedModel.level) {
    return { modelID: suffixedModel.base, variant: suffixedModel.level }
  }

  const spaceVariant = trimmedModelID.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i)
  if (spaceVariant) {
    const modelID = spaceVariant[1]?.trim() ?? ""
    const variant = spaceVariant[2]?.trim().toLowerCase()
    if (variant) {
      return { modelID, variant }
    }
  }

  return { modelID: trimmedModelID }
}

export function parseModelString(
  model: string,
): { providerID: string; modelID: string; variant?: string } | undefined {
  if (typeof model !== "string") return undefined
  const trimmedModel = model.trim()
  if (!trimmedModel) return undefined

  const separatorIndex = trimmedModel.indexOf("/")
  if (separatorIndex === -1) {
    return undefined
  }

  const providerID = trimmedModel.slice(0, separatorIndex).trim()
  const rawModelID = trimmedModel.slice(separatorIndex + 1).trim()
  if (!providerID || !rawModelID) {
    return undefined
  }

  const parsedModel = parseVariantFromModelID(rawModelID, { allowMaxSuffix: true })
  if (!parsedModel.modelID) {
    return undefined
  }

  return parsedModel.variant
    ? { providerID, modelID: parsedModel.modelID, variant: parsedModel.variant }
    : { providerID, modelID: parsedModel.modelID }
}

function normalizeModelName(name: string): string {
	return name
		.toLowerCase()
		.replace(/claude-(opus|sonnet|haiku)-(\d+)[.-](\d+)/g, "claude-$1-$2.$3")
		.replace(/kimi-k2[.-](\d+)/g, "kimi-k2.$1")
		.replace(/\b(glm|gpt)-(\d+)[.-](\d+)/g, "$1-$2.$3")
}

export function fuzzyMatchModel(
	target: string,
	available: Set<string>,
	providers?: string[],
): string | null {
	if (available.size === 0) {
		return null
	}

	const targetNormalized = normalizeModelName(target)

	let candidates = Array.from(available)
	if (providers && providers.length > 0) {
		const providerSet = new Set(providers)
		candidates = candidates.filter((model) => {
			const [provider] = model.split("/")
			return providerSet.has(provider)
		})
	}

	if (candidates.length === 0) {
		return null
	}

	const matches = candidates.filter((model) =>
		normalizeModelName(model).includes(targetNormalized),
	)

	if (matches.length === 0) {
		return null
	}

	const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized)
	if (exactMatch) {
		return exactMatch
	}

	const exactModelIdMatches = matches.filter((model) => {
		const modelId = model.split("/").slice(1).join("/")
		return normalizeModelName(modelId) === targetNormalized
	})
	if (exactModelIdMatches.length > 0) {
		return exactModelIdMatches.reduce((shortest, current) =>
			current.length < shortest.length ? current : shortest,
		)
	}

	return matches.reduce((shortest, current) =>
		current.length < shortest.length ? current : shortest,
	)
}

export function isModelAvailable(
	targetModel: string,
	availableModels: Set<string>,
): boolean {
	return fuzzyMatchModel(targetModel, availableModels) !== null
}

function inferSubProvider(model: string): string | undefined {
	if (model.startsWith("claude-")) return "anthropic"
	if (model.startsWith("gpt-")) return "openai"
	if (model.startsWith("gemini-")) return "google"
	if (model.startsWith("grok-")) return "xai"
	if (model.startsWith("minimax-")) return "minimax"
	if (model.startsWith("kimi-")) return "moonshotai"
	if (model.startsWith("k3")) return "moonshotai"
	if (model.startsWith("glm-")) return "zai"
	return undefined
}

const CLAUDE_VERSION_DOT = /claude-(\w+)-(\d+)-(\d+)/g
const GEMINI_31_PRO_PREVIEW = /gemini-3\.1-pro(?!-)/g
const GEMINI_3_FLASH_PREVIEW = /(?<!antigravity-)gemini-3-flash(?!-)/g

function claudeVersionDot(model: string): string {
	return model.replace(CLAUDE_VERSION_DOT, "claude-$1-$2.$3")
}

function applyGatewayTransforms(model: string): string {
	return claudeVersionDot(model).replace(
		GEMINI_31_PRO_PREVIEW,
		"gemini-3.1-pro-preview",
	)
}

function transformModelForProviderUsingAnthropicBehavior(
	provider: string,
	model: string,
): string {
	if (provider === "vercel") {
		const slashIndex = model.indexOf("/")
		if (slashIndex !== -1) {
			const subProvider = model.substring(0, slashIndex)
			const subModel = model.substring(slashIndex + 1)
			return `${subProvider}/${applyGatewayTransforms(subModel)}`
		}
		const subProvider = inferSubProvider(model)
		if (subProvider) {
			return `${subProvider}/${applyGatewayTransforms(model)}`
		}
		return model
	}
	if (provider === "github-copilot") {
		return claudeVersionDot(model)
			.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
			.replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
	}
	if (provider === "google") {
		return model
			.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
			.replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
	}
	if (provider === "anthropic") {
		return model
	}
	if (provider === "kimi-coding" || provider === "kimi-for-coding") {
		if (model === "kimi-k3") return "k3"
		if (model === "kimi-k3-256k") return "k3-256k"
	}
	return model
}

export function transformModelForProvider(provider: string, model: string): string {
	return transformModelForProviderUsingAnthropicBehavior(provider, model)
}

export function transformModelForProviderDisplay(
	provider: string,
	model: string,
): string {
	return transformModelForProviderUsingAnthropicBehavior(provider, model)
}
