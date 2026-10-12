import assert from "node:assert/strict"
import { test } from "node:test"
import { compactNumber, contextSummary, footerSummary, formatCost, sidebarRows } from "../src/format.ts"
import { sampleVitals } from "./fixtures.ts"

test("recorded cost uses USD formatting, including zero", () => {
  assert.equal(formatCost(0), "$0.00")
  assert.equal(formatCost(0.42), "$0.42")
  assert.equal(formatCost(1_234.56), "$1,234.56")
})

test("compact numbers use stable, readable suffixes and handle unit boundaries", () => {
  assert.equal(compactNumber(0), "0")
  assert.equal(compactNumber(12_400), "12.4K")
  assert.equal(compactNumber(999_999), "1M")
  assert.equal(compactNumber(1_500_000_000), "1.5B")
})

test("footer shows turns, steps, and current context without cumulative tokens or cost", () => {
  const vitals = sampleVitals()
  vitals.totalTokens = 549_700
  vitals.context = { tokens: 38_700, percent: 10 }
  const text = footerSummary(vitals, { width: 160, complete: true })
  assert.equal(text, "1 turn · 1 step · 38.7K (10%)")
})

test("narrow footers abbreviate while retaining turns, steps, and context", () => {
  for (const width of [16, 28, 32, 44, 60]) {
    const text = footerSummary(sampleVitals(), { width, complete: true })
    assert.ok(text.length <= width, `${text} exceeds ${width}`)
    assert.match(text, /1t|1 turn/)
    assert.match(text, /1s|1 step/)
    assert.match(text, /185/)
    assert.doesNotMatch(text, /total|\$/)
    assert.doesNotMatch(text, /ctx/)
  }
})

test("partial history marks footer counters without marking current context as partial", () => {
  const text = footerSummary(sampleVitals(), { width: 160, complete: false })
  assert.equal(text, "~1 turn · ~1 step · 185")
})

test("missing context usage retains an unlabeled placeholder", () => {
  const vitals = sampleVitals()
  vitals.context = undefined
  const text = footerSummary(vitals, { width: 160, complete: true })
  assert.equal(text, "1 turn · 1 step · –")
})

test("footer output does not change as cumulative token totals grow", () => {
  const vitals = sampleVitals()
  for (const totalTokens of [0, 549_700, 1_500_000_000]) {
    vitals.totalTokens = totalTokens
    assert.equal(footerSummary(vitals, { width: 160, complete: true }), "1 turn · 1 step · 185")
    assert.equal(footerSummary(vitals, { width: 16, complete: true }), "1t · 1s · 185")
  }
})

test("context summary shows model usage without session counts, totals, or cost", () => {
  const vitals = sampleVitals()
  vitals.totalTokens = 549_700
  vitals.context = { tokens: 38_700, percent: 10 }
  const text = contextSummary(vitals.context, 160)
  assert.equal(text, "38.7K (10%)")
})

test("footer retains a known zero-percent context estimate", () => {
  const vitals = { ...sampleVitals(), context: { tokens: 185, percent: 0 } }
  assert.equal(footerSummary(vitals, {
    width: 160, complete: true,
  }), "1 turn · 1 step · 185 (0%)")
})

test("context summary shows a placeholder when model usage is unavailable", () => {
  const vitals = sampleVitals()
  vitals.context = undefined
  assert.equal(contextSummary(vitals.context, 160), "–")
})

test("context-only footer drops its percentage when available width is limited", () => {
  const vitals = sampleVitals()
  vitals.context = { tokens: 38_700, percent: 10 }
  assert.equal(contextSummary(vitals.context, 5), "38.7K")
})

test("context-only footer keeps a known zero-percent estimate", () => {
  const vitals = sampleVitals()
  vitals.context = { tokens: 185, percent: 0 }
  assert.equal(contextSummary(vitals.context, 160), "185 (0%)")
})

test("sidebar shows exact session counts, token usage, context percentage, and cost", () => {
  const vitals = sampleVitals()
  vitals.turns = 1_234
  vitals.steps = 5_678
  vitals.totalTokens = 549_700
  vitals.context = { tokens: 38_700, percent: 10 }
  assert.deepEqual(sidebarRows(vitals, { complete: true, cost: 0.42 }), [
    { label: "Turns", value: "1,234" },
    { label: "Steps", value: "5,678" },
    { label: "Total tokens", value: "549,700" },
    { label: "Context", value: "38,700 (10%)" },
    { label: "Cost", value: "$0.42" },
  ])
})

test("sidebar marks partial counters without marking current context as partial", () => {
  assert.deepEqual(sidebarRows(sampleVitals(), { complete: false, cost: 0 }), [
    { label: "Turns", value: "~1" },
    { label: "Steps", value: "~1" },
    { label: "Total tokens", value: "~185" },
    { label: "Context", value: "185" },
    { label: "Cost", value: "$0.00" },
  ])
})

test("sidebar retains a placeholder before any context usage is available", () => {
  const vitals = sampleVitals()
  vitals.context = undefined
  assert.deepEqual(sidebarRows(vitals, { complete: true, cost: 0 }).slice(-2), [
    { label: "Context", value: "–" },
    { label: "Cost", value: "$0.00" },
  ])
})

test("sidebar always includes total tokens, context, and zero recorded cost", () => {
  assert.deepEqual(sidebarRows(sampleVitals(), {
    complete: true, cost: 0,
  }), [
    { label: "Turns", value: "1" },
    { label: "Steps", value: "1" },
    { label: "Total tokens", value: "185" },
    { label: "Context", value: "185" },
    { label: "Cost", value: "$0.00" },
  ])
})

test("sidebar preserves a known zero-percent context estimate", () => {
  const vitals = sampleVitals()
  vitals.context = { tokens: 185, percent: 0 }
  assert.deepEqual(sidebarRows(vitals, { complete: true, cost: 0 }).at(-2), {
    label: "Context", value: "185 (0%)",
  })
})

test("context summaries retain the percentage at the exact width boundary", () => {
  const context = { tokens: 38_700, percent: 10 }
  const summary = "38.7K (10%)"
  assert.equal(contextSummary(context, summary.length), summary)
  assert.equal(contextSummary(context, summary.length - 1), "38.7K")
})

test("each footer layout preserves counts and context at its exact width boundary", () => {
  const vitals = { ...sampleVitals(), turns: 2, steps: 3, context: { tokens: 55, percent: 10 } }
  const layouts = [
    "2 turns · 3 steps · 55 (10%)",
    "2t · 3s · 55 (10%)",
    "2t · 3s · 55",
    "2t 3s 55",
  ]
  for (const [index, text] of layouts.entries()) {
    assert.equal(footerSummary(vitals, {
      width: text.length, complete: true,
    }), text)
    assert.equal(footerSummary(vitals, {
      width: text.length - 1, complete: true,
    }), layouts[index + 1] ?? layouts.at(-1))
  }
})

test("partial compact footers mark counters but not context", () => {
  const vitals = { ...sampleVitals(), context: { tokens: 55, percent: 10 } }
  const text = "~1t ~1s 55"
  assert.equal(footerSummary(vitals, { width: text.length, complete: false }), text)
})

test("the smallest footer retains counts and context even when it cannot fit", () => {
  const vitals = { ...sampleVitals(), context: { tokens: 55, percent: 10 } }
  for (const width of [0, 1, 4, 5]) {
    assert.equal(footerSummary(vitals, {
      width, complete: true,
    }), "1t 1s 55")
  }
})
