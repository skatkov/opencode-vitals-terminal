import assert from "node:assert/strict"
import { test } from "node:test"
import { createMemo, createRoot, createSignal } from "solid-js"
import { footerSummary, parseOptions, sidebarRows } from "../src/format.ts"
import { VitalsStore } from "../src/vitals-store.ts"
import { sampleVitals } from "./fixtures.ts"

function observe(store: VitalsStore, sessionID: string) {
  return createRoot((dispose) => ({ metrics: store.observe(sessionID), dispose }))
}

test("footer, sidebar, and dialog share one projection per session update", () => {
  const [source, setSource] = createSignal(sampleVitals())
  let reads = 0
  const store = new VitalsStore(() => { reads++; return source() })
  const footer = observe(store, "a")
  const sidebar = observe(store, "a")
  const dialog = observe(store, "a")
  assert.equal(reads, 1)
  assert.strictEqual(footer.metrics(), sidebar.metrics())
  assert.strictEqual(footer.metrics(), dialog.metrics())
  setSource({ ...source(), steps: 2 })
  assert.equal(reads, 2)
  assert.equal(footer.metrics().steps, 2)
  assert.strictEqual(footer.metrics(), sidebar.metrics())
  assert.strictEqual(footer.metrics(), dialog.metrics())
  footer.dispose()
  sidebar.dispose()
  dialog.dispose()
  store.dispose()
})

test("layout, cost, and completeness updates only reformat the shared metrics", () => {
  let reads = 0
  const store = new VitalsStore(() => { reads++; return sampleVitals() })
  const [width, setWidth] = createSignal(160)
  const [cost, setCost] = createSignal(0)
  const [complete, setComplete] = createSignal(true)
  const options = parseOptions({})
  const view = createRoot((dispose) => {
    const metrics = store.observe("a")
    return {
      summary: createMemo(() => footerSummary(metrics(), { width: width(), cost: cost(), complete: complete(), options })),
      rows: createMemo(() => sidebarRows(metrics(), { cost: cost(), complete: complete(), options })),
      dispose,
    }
  })
  assert.equal(reads, 1)
  setWidth(16)
  assert.equal(view.summary(), "1t 1s 185 total")
  setWidth(160)
  setCost(2.5)
  assert.match(view.summary(), /\$2\.50$/)
  assert.deepEqual(view.rows().at(-1), { label: "Cost", value: "$2.50" })
  setComplete(false)
  assert.match(view.summary(), /^~1 turn/)
  assert.deepEqual(view.rows()[0], { label: "Turns", value: "~1" })
  assert.equal(reads, 1)
  view.dispose()
  store.dispose()
})

test("the first observer can unmount without disposing the other views' projection", () => {
  const [source, setSource] = createSignal(sampleVitals())
  let reads = 0
  const store = new VitalsStore(() => { reads++; return source() })
  const first = observe(store, "a")
  const second = observe(store, "a")
  first.dispose()
  setSource({ ...source(), steps: 2 })
  assert.equal(reads, 2)
  assert.equal(second.metrics().steps, 2)
  second.dispose()
  setSource({ ...source(), steps: 3 })
  assert.equal(reads, 2)
  const remounted = observe(store, "a")
  assert.equal(reads, 3)
  assert.equal(remounted.metrics().steps, 3)
  remounted.dispose()
  store.dispose()
})

test("reactive session changes release the previous session's projection", () => {
  const [sessionID, setSessionID] = createSignal("a")
  const [a, setA] = createSignal(sampleVitals())
  const [b, setB] = createSignal({ ...sampleVitals(), steps: 2 })
  const reads = { a: 0, b: 0 }
  const store = new VitalsStore((id) => {
    if (id === "a") { reads.a++; return a() }
    reads.b++
    return b()
  })
  const view = createRoot((dispose) => ({
    metrics: createMemo(() => store.observe(sessionID())),
    dispose,
  }))
  assert.equal(view.metrics()().steps, 1)
  setSessionID("b")
  assert.equal(view.metrics()().steps, 2)
  setA({ ...a(), steps: 3 })
  assert.deepEqual(reads, { a: 1, b: 1 })
  setB({ ...b(), steps: 4 })
  assert.equal(view.metrics()().steps, 4)
  assert.deepEqual(reads, { a: 1, b: 2 })
  view.dispose()
  store.dispose()
})

test("plugin disposal releases projections even while a view remains mounted", () => {
  const [source, setSource] = createSignal(sampleVitals())
  let reads = 0
  const store = new VitalsStore(() => { reads++; return source() })
  const view = observe(store, "a")
  store.dispose()
  setSource({ ...source(), steps: 2 })
  assert.equal(reads, 1)
  view.dispose()
})
