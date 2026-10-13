import type { Vitals } from "./metrics.ts"
import { toolBreakdown } from "./tool-breakdown.ts"

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatCost(cost: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cost)
}

export function sidebarRows(
  vitals: Vitals,
  input: { complete: boolean; cost: number },
): { label: string; value: string }[] {
  const prefix = input.complete ? "" : "~"
  const number = (value: number) => value.toLocaleString("en-US")
  const context = vitals.context ? number(vitals.context.tokens) : "–"
  const percent = vitals.context?.percent === undefined ? "" : ` (${vitals.context.percent}%)`
  return [
    { label: "Turns", value: `${prefix}${number(vitals.turns)}` },
    { label: "Steps", value: `${prefix}${number(vitals.steps)}` },
    { label: "Total tokens", value: `${prefix}${number(vitals.totalTokens)}` },
    { label: "Context", value: `${context}${percent}` },
    { label: "Cost", value: formatCost(input.cost) },
    { label: "Tool calls", value: `${prefix}${number(vitals.toolCalls)}` },
    ...toolBreakdown(vitals.tools).map((tool) => ({ label: tool.label, value: `${prefix}${number(tool.calls)}` })),
  ]
}

export function contextSummary(context: Vitals["context"], width: number): string {
  const tokens = context ? compactNumber(context.tokens) : "–"
  const percent = context?.percent === undefined ? "" : ` (${context.percent}%)`
  const summary = `${tokens}${percent}`
  return summary.length <= width ? summary : tokens
}

export function footerSummary(
  vitals: Vitals,
  input: { width: number; complete: boolean },
): string {
  const prefix = input.complete ? "" : "~"
  const turns = compactNumber(vitals.turns)
  const steps = compactNumber(vitals.steps)
  const context = vitals.context ? compactNumber(vitals.context.tokens) : "–"
  const percent = vitals.context?.percent === undefined ? "" : ` (${vitals.context.percent}%)`
  const candidates = [
    `${prefix}${turns} ${vitals.turns === 1 ? "turn" : "turns"} · ${prefix}${steps} ${vitals.steps === 1 ? "step" : "steps"} · ${context}${percent}`,
    `${prefix}${turns}t · ${prefix}${steps}s · ${context}${percent}`,
    `${prefix}${turns}t · ${prefix}${steps}s · ${context}`,
    `${prefix}${turns}t ${prefix}${steps}s ${context}`,
  ]
  return candidates.find((text) => text.length <= input.width) ?? candidates.at(-1)!
}
