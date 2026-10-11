import assert from "node:assert/strict"
import { test } from "node:test"
import { compactNumber, footerSummary, parseOptions } from "../src/format.ts"
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
