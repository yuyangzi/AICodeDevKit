import type { DelegateFallbackEntry } from "./resolve-model"

export interface CategoryDef {
  model: string
  variant?: string
  description: string
  fallbackChain: DelegateFallbackEntry[]
}

export const CATEGORIES: Record<string, CategoryDef> = {
  "visual-engineering": {
    model: "anthropic/claude-fable-5-1",
    variant: "max",
    description: "Visual design, UI/UX, frontend, styling, animation, and design systems",
    fallbackChain: [
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
    ],
  },
  ultrabrain: {
    model: "openai/gpt-6-astra",
    variant: "max",
    description: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
    fallbackChain: [
      { providers: ["openai", "openai-codex"], model: "gpt-6-astra", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "openai-codex"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "max" },
    ],
  },
  deep: {
    model: "openai/gpt-6-astra",
    variant: "high",
    description: "Deep autonomous problem-solving for complex research. ONE goal + ONE deliverable per call.",
    fallbackChain: [
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "high" },
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-sol", variant: "medium" },
    ],
  },
  artistry: {
    model: "anthropic/claude-fable-5-1",
    variant: "max",
    description: "Complex problem-solving with unconventional, creative approaches",
    fallbackChain: [
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "xhigh" },
    ],
  },
  quick: {
    model: "kimi-for-coding/kimi-for-coding-highspeed",
    description: "Trivial tasks - single file changes, typo fixes, simple modifications",
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed" },
      { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "off" },
      { providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"], model: "qwen3.6-flash", variant: "low" },
      { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      { providers: ["anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-4-5", variant: "off" },
    ],
  },
  "unspecified-low": {
    model: "xai/grok-4.6",
    variant: "xhigh",
    description: "Tasks that don't fit other categories, low effort required",
    fallbackChain: [
      { providers: ["xai", "github-copilot", "opencode"], model: "grok-4.6", variant: "xhigh" },
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-terra", variant: "high" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-sonnet-5", variant: "low" },
      { providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"], model: "qwen3.8-max-preview", variant: "max" },
      { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" },
    ],
  },
  "unspecified-high": {
    model: "openai/gpt-6-astra",
    variant: "high",
    description: "Tasks that don't fit other categories, high effort required",
    fallbackChain: [
      { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "high" },
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "xhigh" },
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
    ],
  },
  writing: {
    model: "anthropic/claude-fable-5-1",
    variant: "medium",
    description: "Documentation, prose, and writing tasks",
    fallbackChain: [
      { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "medium" },
      { providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"], model: "kimi-k3", variant: "max" },
    ],
  },
}

export const CATEGORY_NAMES: string[] = Object.keys(CATEGORIES).sort()