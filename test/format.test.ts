import assert from "node:assert/strict"
import { test } from "node:test"
import { compactNumber, footerSummary, parseOptions, sidebarRows } from "../src/format.ts"
import { sampleVitals } from "./fixtures.ts"

test("default options show both total tokens and existing context usage", () => {
  assert.deepEqual(parseOptions({}), { tokens: "both", cost: true })
  assert.deepEqual(parseOptions({ tokens: "invalid", cost: false }), { tokens: "both", cost: false })
})

test("compact numbers use stable, readable suffixes and handle unit boundaries", () => {
  assert.equal(compactNumber(0), "0")
  assert.equal(compactNumber(12_400), "12.4K")
  assert.equal(compactNumber(999_999), "1M")
  assert.equal(compactNumber(1_500_000_000), "1.5B")
})

test("full footer labels cumulative usage as total and preserves context, cost, and percentage", () => {
  const vitals = sampleVitals()
  vitals.totalTokens = 549_700
  vitals.context = { tokens: 38_700, percent: 10 }
  const text = footerSummary(vitals, { width: 160, complete: true, cost: 0.42, options: parseOptions({}) })
  assert.equal(text, "1 turn · 1 step · 549.7K total · 38.7K (10%) · $0.42")
})

test("narrow footers abbreviate instead of hiding turns, steps, and tokens", () => {
  for (const width of [16, 28, 32, 44, 60]) {
    const text = footerSummary(sampleVitals(), { width, complete: true, cost: 1.23, options: parseOptions({}) })
    assert.ok(text.length <= width, `${text} exceeds ${width}`)
    assert.match(text, /1t|1 turn/)
    assert.match(text, /1s|1 step/)
    assert.match(text, /185 total/)
    assert.doesNotMatch(text, /ctx/)
  }
})

test("partial history is marked, never represented as a complete total", () => {
  const text = footerSummary(sampleVitals(), { width: 160, complete: false, cost: 0, options: parseOptions({}) })
  assert.equal(text, "~1 turn · ~1 step · ~185 total · 185")
})

test("missing context usage retains an unlabeled placeholder", () => {
  const vitals = sampleVitals()
  vitals.context = undefined
  const text = footerSummary(vitals, { width: 160, complete: true, cost: 0, options: parseOptions({}) })
  assert.equal(text, "1 turn · 1 step · 185 total · –")
})

test("context-only mode retains the old token semantics", () => {
  const text = footerSummary(sampleVitals(), { width: 160, complete: true, cost: 0, options: parseOptions({ tokens: "context" }) })
  assert.equal(text, "1 turn · 1 step · 185 tokens")
})

test("context-only mode keeps its token label in the smallest layout", () => {
  const text = footerSummary(sampleVitals(), { width: 14, complete: true, cost: 0, options: parseOptions({ tokens: "context" }) })
  assert.equal(text, "1t 1s 185 tok")
})

test("total-only mode omits the context field and cost can be disabled", () => {
  const text = footerSummary(sampleVitals(), { width: 160, complete: true, cost: 2.5, options: parseOptions({ tokens: "total", cost: false }) })
  assert.equal(text, "1 turn · 1 step · 185 total")
})

test("sidebar shows exact session counts, token usage, context percentage, and cost", () => {
  const vitals = sampleVitals()
  vitals.turns = 1_234
  vitals.steps = 5_678
  vitals.totalTokens = 549_700
  vitals.context = { tokens: 38_700, percent: 10 }
  assert.deepEqual(sidebarRows(vitals, { complete: true, cost: 0.42, options: parseOptions({}) }), [
    { label: "Turns", value: "1,234" },
    { label: "Steps", value: "5,678" },
    { label: "Total tokens", value: "549,700" },
    { label: "Context", value: "38,700 (10%)" },
    { label: "Cost", value: "$0.42" },
  ])
})

test("sidebar marks partial counters without marking current context as partial", () => {
  assert.deepEqual(sidebarRows(sampleVitals(), { complete: false, cost: 0, options: parseOptions({}) }), [
    { label: "Turns", value: "~1" },
    { label: "Steps", value: "~1" },
    { label: "Total tokens", value: "~185" },
    { label: "Context", value: "185" },
  ])
})

test("sidebar retains a placeholder before any context usage is available", () => {
  const vitals = sampleVitals()
  vitals.context = undefined
  assert.deepEqual(sidebarRows(vitals, { complete: true, cost: 0, options: parseOptions({}) }).at(-1), {
    label: "Context", value: "–",
  })
})

test("sidebar context-only mode omits cumulative tokens and respects the cost option", () => {
  assert.deepEqual(sidebarRows(sampleVitals(), {
    complete: true, cost: 2.5, options: parseOptions({ tokens: "context", cost: false }),
  }), [
    { label: "Turns", value: "1" },
    { label: "Steps", value: "1" },
    { label: "Context", value: "185" },
  ])
})

test("sidebar total-only mode omits context and keeps enabled cost", () => {
  assert.deepEqual(sidebarRows(sampleVitals(), {
    complete: true, cost: 2.5, options: parseOptions({ tokens: "total" }),
  }), [
    { label: "Turns", value: "1" },
    { label: "Steps", value: "1" },
    { label: "Total tokens", value: "185" },
    { label: "Cost", value: "$2.50" },
  ])
})

test("sidebar preserves a known zero-percent context estimate", () => {
  const vitals = sampleVitals()
  vitals.context = { tokens: 185, percent: 0 }
  assert.deepEqual(sidebarRows(vitals, { complete: true, cost: 0, options: parseOptions({}) }).at(-1), {
    label: "Context", value: "185 (0%)",
  })
})
