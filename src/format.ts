import type { Vitals } from "./metrics.ts"

export type TokenDisplay = "both" | "context" | "total"
export type Options = { tokens: TokenDisplay; cost: boolean }

export function parseOptions(options: Readonly<Record<string, unknown>>): Options {
  return {
    tokens: options.tokens === "context" || options.tokens === "total" ? options.tokens : "both",
    cost: options.cost !== false,
  }
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatCost(cost: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cost)
}

export function sidebarRows(
  vitals: Vitals,
  input: { complete: boolean; cost: number; options: Options },
): { label: string; value: string }[] {
  const prefix = input.complete ? "" : "~"
  const number = (value: number) => value.toLocaleString("en-US")
  const rows = [
    { label: "Turns", value: `${prefix}${number(vitals.turns)}` },
    { label: "Steps", value: `${prefix}${number(vitals.steps)}` },
  ]
  if (input.options.tokens !== "context") {
    rows.push({ label: "Total tokens", value: `${prefix}${number(vitals.totalTokens)}` })
  }
  if (input.options.tokens !== "total") {
    const context = vitals.context ? number(vitals.context.tokens) : "–"
    const percent = vitals.context?.percent === undefined ? "" : ` (${vitals.context.percent}%)`
    rows.push({ label: "Context", value: `${context}${percent}` })
  }
  if (input.options.cost && input.cost > 0) rows.push({ label: "Cost", value: formatCost(input.cost) })
  return rows
}

export function footerSummary(
  vitals: Vitals,
  input: { width: number; complete: boolean; cost: number; options: Options },
): string {
  const prefix = input.complete ? "" : "~"
  const turns = compactNumber(vitals.turns)
  const steps = compactNumber(vitals.steps)
  const total = `${prefix}${compactNumber(vitals.totalTokens)}`
  const context = vitals.context ? compactNumber(vitals.context.tokens) : "–"
  const percent = vitals.context?.percent === undefined ? "" : ` (${vitals.context.percent}%)`
  const cost = input.options.cost && input.cost > 0 ? formatCost(input.cost) : undefined
  const tokenParts = (percentage: boolean) => {
    const parts: string[] = []
    if (input.options.tokens !== "context") parts.push(`${total} total`)
    if (input.options.tokens !== "total") parts.push(`${context}${input.options.tokens === "context" ? " tokens" : ""}${percentage ? percent : ""}`)
    return parts
  }
  const candidates = [
    [`${prefix}${turns} ${vitals.turns === 1 ? "turn" : "turns"}`, `${prefix}${steps} ${vitals.steps === 1 ? "step" : "steps"}`, ...tokenParts(true), cost].filter(Boolean).join(" · "),
    [`${prefix}${turns}t`, `${prefix}${steps}s`, ...tokenParts(true), cost].filter(Boolean).join(" · "),
    [`${prefix}${turns}t`, `${prefix}${steps}s`, ...tokenParts(false)].join(" · "),
    [`${prefix}${turns}t`, `${prefix}${steps}s`, ...tokenParts(false)].join(" "),
    `${prefix}${turns}t ${prefix}${steps}s ${input.options.tokens === "context" ? context : total} ${input.options.tokens === "context" ? "tok" : "total"}`,
  ]
  return candidates.find((text) => text.length <= input.width) ?? candidates.at(-1)!
}
