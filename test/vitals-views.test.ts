import assert from "node:assert/strict"
import { test } from "node:test"
import { createRoot, createSignal } from "solid-js"
import { SidebarStore } from "../src/sidebar.ts"
import { HistoryStore } from "../src/store.ts"
import { VitalsStore } from "../src/vitals-store.ts"
import { createFooterSummary, createSidebarRows } from "../src/vitals-views.ts"
import { sampleVitals } from "./fixtures.ts"

function views() {
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
    context: { history, vitals, sidebar, cost },
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
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.equal(footer.summary(), "38.7K (10%)")
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "1" })
  setWidth(5)
  assert.equal(footer.summary(), "38.7K")
  fixture.setCost(2.5)
  assert.deepEqual(sidebar.rows().find((row) => row.label === "Cost"), { label: "Cost", value: "$2.50" })
  const history = fixture.context.history.get("a")
  assert.ok(history)
  history.complete = false
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "~1" })
  setWidth(160)
  sidebar.dispose()
  assert.equal(footer.summary(), "~1 turn · ~1 step · 38.7K (10%)")
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

test("cumulative tokens and zero recorded cost stay in the sidebar, never the footer", async () => {
  const fixture = views()
  fixture.setCost(0)
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary(fixture.context, () => "a", () => 160),
    dispose,
  }))
  await new Promise((done) => setImmediate(done))
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.equal(footer.summary(), "38.7K (10%)")
  assert.deepEqual(sidebar.rows().map((row) => row.label), ["Turns", "Steps", "Total tokens", "Context", "Cost", "Tool calls"])
  assert.deepEqual(sidebar.rows()[2], { label: "Total tokens", value: "549,700" })
  assert.deepEqual(sidebar.rows().find((row) => row.label === "Cost"), { label: "Cost", value: "$0.00" })
  fixture.setCost(2.5)
  assert.deepEqual(sidebar.rows().find((row) => row.label === "Cost"), { label: "Cost", value: "$2.50" })
  assert.equal(footer.summary(), "38.7K (10%)")
  sidebar.dispose()
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  assert.equal(fixture.calculations.get("a"), 1)
  footer.dispose()
  fixture.dispose()
})

test("tool usage updates live only in the sidebar, including partial history and remounts", async () => {
  const fixture = views()
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary(fixture.context, () => "a", () => 160),
    dispose,
  }))
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.deepEqual(sidebar.rows().at(-1), { label: "Tool calls", value: "~0" })
  fixture.setSource({ ...fixture.source(), toolCalls: 3, tools: [{ name: "read", calls: 2 }, { name: "grep", calls: 1 }] })
  assert.deepEqual(sidebar.rows().slice(5), [
    { label: "Tool calls", value: "~3" },
    { label: "  read", value: "~2" },
    { label: "  grep", value: "~1" },
  ])
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sidebar.rows().slice(5), [
    { label: "Tool calls", value: "3" },
    { label: "  read", value: "2" },
    { label: "  grep", value: "1" },
  ])
  assert.equal(footer.summary(), "38.7K (10%)")
  sidebar.dispose()
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  fixture.setSource({ ...fixture.source(), toolCalls: 4, tools: [{ name: "read", calls: 3 }, { name: "grep", calls: 1 }] })
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  const remounted = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.deepEqual(remounted.rows().slice(5), [
    { label: "Tool calls", value: "4" },
    { label: "  read", value: "3" },
    { label: "  grep", value: "1" },
  ])
  assert.equal(fixture.reads(), 1)
  assert.equal(fixture.calculations.get("a"), 3)
  remounted.dispose()
  footer.dispose()
  fixture.dispose()
})

test("namespace sidebar subtotals and children follow live counts and disappear when calls are removed", async () => {
  const fixture = views()
  fixture.setSource({
    ...fixture.source(),
    toolCalls: 15,
    tools: [
      { name: "rubydex.get_declaration", calls: 4 },
      { name: "rubydex.get_descendants", calls: 3 },
      { name: "posh.posh_search", calls: 5 },
      { name: "posh.posh_docsets", calls: 1 },
      { name: "execute", calls: 2 },
    ],
  })
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, () => "a"),
    dispose,
  }))
  assert.deepEqual(sidebar.rows().slice(5), [
    { label: "Tool calls", value: "~15" },
    { label: "  rubydex (subtotal)", value: "~7" },
    { label: "    get_declaration", value: "~4" },
    { label: "    get_descendants", value: "~3" },
    { label: "  posh (subtotal)", value: "~6" },
    { label: "    posh_search", value: "~5" },
    { label: "    posh_docsets", value: "~1" },
    { label: "  execute", value: "~2" },
  ])
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sidebar.rows().slice(5), [
    { label: "Tool calls", value: "15" },
    { label: "  rubydex (subtotal)", value: "7" },
    { label: "    get_declaration", value: "4" },
    { label: "    get_descendants", value: "3" },
    { label: "  posh (subtotal)", value: "6" },
    { label: "    posh_search", value: "5" },
    { label: "    posh_docsets", value: "1" },
    { label: "  execute", value: "2" },
  ])
  fixture.setSource({
    ...fixture.source(),
    toolCalls: 4,
    tools: [{ name: "execute", calls: 2 }, { name: "posh.posh_search", calls: 2 }],
  })
  assert.deepEqual(sidebar.rows().slice(5), [
    { label: "Tool calls", value: "4" },
    { label: "  execute", value: "2" },
    { label: "  posh (subtotal)", value: "2" },
    { label: "    posh_search", value: "2" },
  ])
  fixture.setSource({ ...fixture.source(), toolCalls: 2, tools: [{ name: "execute", calls: 2 }] })
  assert.deepEqual(sidebar.rows().slice(5), [
    { label: "Tool calls", value: "2" },
    { label: "  execute", value: "2" },
  ])
  sidebar.dispose()
  fixture.dispose()
})

test("a footer on its own never reads recorded cost", async () => {
  const fixture = views()
  const footer = createRoot((dispose) => ({
    summary: createFooterSummary({
      ...fixture.context,
      cost: () => { throw new Error("Footer must not read session cost") },
    }, () => "a", () => 160),
    dispose,
  }))
  await new Promise((done) => setImmediate(done))
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  fixture.setCost(2.5)
  assert.equal(footer.summary(), "1 turn · 1 step · 38.7K (10%)")
  footer.dispose()
  fixture.dispose()
})

test("a sidebar on its own starts history loading and shares it across reactive session changes", async () => {
  const fixture = views()
  const [sessionID, setSessionID] = createSignal("a")
  const sidebar = createRoot((dispose) => ({
    rows: createSidebarRows(fixture.context, sessionID),
    dispose,
  }))
  assert.equal(fixture.reads(), 1)
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "~1" })
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "1" })
  setSessionID("b")
  assert.equal(fixture.reads(), 2)
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sidebar.rows()[0], { label: "Turns", value: "1" })
  sidebar.dispose()
  fixture.dispose()
})
