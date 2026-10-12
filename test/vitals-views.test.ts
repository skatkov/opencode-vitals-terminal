import assert from "node:assert/strict"
import { test } from "node:test"
import { createRoot, createSignal } from "solid-js"
import { parseOptions, type Options } from "../src/format.ts"
import { SidebarStore } from "../src/sidebar.ts"
import { HistoryStore } from "../src/store.ts"
import { VitalsStore } from "../src/vitals-store.ts"
import { createFooterSummary, createSidebarRows } from "../src/vitals-views.ts"
import { sampleVitals } from "./fixtures.ts"

function views(options: Options = parseOptions({})) {
  const [source, setSource] = createSignal({
    ...sampleVitals(), totalTokens: 549_700, context: { tokens: 38_700, percent: 10 },
  })
  const [cost, setCost] = createSignal(0.42)
  const calculations = new Map<string, number>()
  let reads = 0
  const history = new HistoryStore(async () => {
    reads++
    return { data: [], cursor: {} }
  }, () => [])
  const vitals = new VitalsStore((sessionID) => {
    calculations.set(sessionID, (calculations.get(sessionID) ?? 0) + 1)
    return source()
  })
  const sidebar = new SidebarStore()
  return {
    context: { history, vitals, sidebar, options, cost },
    calculations,
    reads: () => reads,
    setSource,
    source,
    setCost,
    dispose: () => { history.dispose(); vitals.dispose() },
  }
}

test("production sidebar effects switch the footer on mount, cleanup, and remount without recounting", async () => {
  const fixture = views()
  const [width, setWidth] = createSignal(160)
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary(fixture.context, () => "a", width),
    dispose,
  }))
  await new Promise((done) => setImmediate(done))
  assert.equal(footer.summary(), "1 turn · 1 step · 549.7K total · 38.7K (10%) · $0.42")
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.equal(footer.summary(), "38.7K (10%)")
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "1" })
  setWidth(5)
  assert.equal(footer.summary(), "38.7K")
  fixture.setCost(2.5)
  assert.deepEqual(sidebar.rows().at(-1), { label: "Cost", value: "$2.50" })
  const history = fixture.context.history.get("a")
  assert.ok(history)
  history.complete = false
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "~1" })
  setWidth(160)
  sidebar.dispose()
  assert.equal(footer.summary(), "~1 turn · ~1 step · ~549.7K total · 38.7K (10%) · $2.50")
  const remounted = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.equal(footer.summary(), "38.7K (10%)")
  assert.equal(fixture.reads(), 1)
  assert.equal(fixture.calculations.get("a"), 1)
  fixture.setSource({ ...fixture.source(), steps: 2 })
  assert.deepEqual(remounted.rows()[1], { label: "Steps", value: "~2" })
  assert.equal(fixture.calculations.get("a"), 2)
  remounted.dispose()
  footer.dispose()
  fixture.dispose()
})

test("production view bindings follow session changes and release inactive accounting", async () => {
  const fixture = views()
  const [sessionID, setSessionID] = createSignal("a")
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary(fixture.context, sessionID, () => 160),
    dispose,
  }))
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, sessionID),
    dispose,
  }))
  await new Promise((done) => setImmediate(done))
  setSessionID("b")
  assert.equal(fixture.context.sidebar.visible("a"), false)
  assert.equal(fixture.context.sidebar.visible("b"), true)
  await new Promise((done) => setImmediate(done))
  assert.equal(fixture.reads(), 2)
  assert.equal(footer.summary(), "38.7K (10%)")
  fixture.setSource({ ...fixture.source(), steps: 2 })
  assert.equal(fixture.calculations.get("a"), 1)
  assert.equal(fixture.calculations.get("b"), 2)
  assert.deepEqual(sidebar.rows()[1], { label: "Steps", value: "2" })
  footer.dispose()
  fixture.setSource({ ...fixture.source(), steps: 3 })
  assert.equal(fixture.calculations.get("b"), 3)
  assert.deepEqual(sidebar.rows()[1], { label: "Steps", value: "3" })
  sidebar.dispose()
  assert.equal(fixture.context.sidebar.visible("b"), false)
  fixture.setSource({ ...fixture.source(), steps: 4 })
  assert.equal(fixture.calculations.get("b"), 3)
  fixture.dispose()
})

test("a footer without a session neither reads history nor observes accounting", async () => {
  const fixture = views()
  const [sessionID, setSessionID] = createSignal<string>()
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary(fixture.context, sessionID, () => 160),
    dispose,
  }))
  assert.equal(footer.summary(), "")
  assert.equal(fixture.reads(), 0)
  assert.equal(fixture.calculations.size, 0)
  setSessionID("a")
  await new Promise((done) => setImmediate(done))
  assert.equal(fixture.reads(), 1)
  assert.equal(fixture.calculations.get("a"), 1)
  setSessionID(undefined)
  assert.equal(footer.summary(), "")
  fixture.setSource({ ...fixture.source(), steps: 2 })
  assert.equal(fixture.calculations.get("a"), 1)
  footer.dispose()
  fixture.dispose()
})

test("sidebar visibility selects context formatting even when vitals options hide context and cost", async () => {
  const fixture = views(parseOptions({ tokens: "total", cost: false }))
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary(fixture.context, () => "a", () => 160),
    dispose,
  }))
  await new Promise((done) => setImmediate(done))
  assert.equal(footer.summary(), "1 turn · 1 step · 549.7K total")
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.equal(footer.summary(), "38.7K (10%)")
  assert.deepEqual(sidebar.rows().map((row) => row.label), ["Turns", "Steps", "Total tokens"])
  sidebar.dispose()
  assert.equal(footer.summary(), "1 turn · 1 step · 549.7K total")
  assert.equal(fixture.calculations.get("a"), 1)
  footer.dispose()
  fixture.dispose()
})
