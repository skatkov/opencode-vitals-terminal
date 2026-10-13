import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import type { JsonValue, OpenCodeEvent, SessionMessageInfo, SessionToolProgress } from "@opencode/client"
import type { Data } from "@opencode/plugin/tui/context"
import { createRoot } from "solid-js"
import { subscribeHistoryEvents } from "../src/history-events.ts"
import { calculateVitals, mergeMessages, projectMessages } from "../src/metrics.ts"
import { SidebarStore } from "../src/sidebar.ts"
import { HistoryStore } from "../src/store.ts"
import { VitalsStore } from "../src/vitals-store.ts"
import { createSidebarRows } from "../src/vitals-views.ts"
import { assistant, tool } from "./fixtures.ts"

function events() {
  const emitter = new EventEmitter()
  const on: Data["on"] = (type, handler) => {
    emitter.on(type, handler)
    return () => { emitter.off(type, handler) }
  }
  return { data: { on }, emit: (event: OpenCodeEvent) => { emitter.emit(event.type, event) } }
}

const flushEvents = () => new Promise<void>((done) => queueMicrotask(done))

test("tool events read the updated cache and drive sidebar counts through production accounting", async (t) => {
  const bus = events()
  // Intentionally non-reactive: counts must change through the event bridge,
  // not because the fixture directly publishes a Vitals value or a signal.
  let cached: SessionMessageInfo[] = []
  const history = new HistoryStore(async () => ({ data: [], cursor: {} }), () => projectMessages(cached))
  const vitals = new VitalsStore((sessionID) => calculateVitals(
    mergeMessages(history.get(sessionID)?.messages ?? [], projectMessages(cached)),
  ))
  await history.refresh("a")
  const stopEvents = subscribeHistoryEvents(bus.data, history)
  const view = createRoot((dispose) => ({
    rows: createSidebarRows({ history, vitals, sidebar: new SidebarStore(), cost: () => 0 }, () => "a"),
    dispose,
  }))
  t.after(() => { stopEvents(); view.dispose(); history.dispose(); vitals.dispose() })
  assert.deepEqual(view.rows().slice(5), [{ label: "Tool calls", value: "0" }])

  bus.emit({
    id: "event-called", created: 1, type: "session.tool.called",
    durable: { aggregateID: "a", seq: 1, version: 1 },
    data: { sessionID: "a", assistantMessageID: "msg_002", id: "call-a", input: { code: "private code" }, executed: false },
  })
  // The host cache can update after our subscription's synchronous callback.
  cached = [assistant("msg_002", { content: [tool("call-a", "execute")] })]
  assert.deepEqual(view.rows().slice(5), [{ label: "Tool calls", value: "0" }])
  await flushEvents()
  assert.deepEqual(view.rows().slice(5), [
    { label: "Tool calls", value: "1" },
    { label: "  execute", value: "1" },
  ])

  const calls: JsonValue[] = [{ tool: "rubydex.codebase_stats", status: "running", input: { private: "input" } }]
  const progress: SessionToolProgress = {
    id: "event-progress", created: 2, type: "session.tool.progress",
    data: { sessionID: "a", assistantMessageID: "msg_002", id: "call-a", metadata: { toolCalls: calls } },
  }
  cached = [assistant("msg_002", { content: [tool("call-a", "execute", {
    state: { status: "running", input: {}, metadata: progress.data.metadata },
  })] })]
  bus.emit(progress)
  bus.emit(progress)
  await flushEvents()
  assert.deepEqual(view.rows().slice(5), [
    { label: "Tool calls", value: "2" },
    { label: "  execute", value: "1" },
    { label: "  rubydex (subtotal)", value: "1" },
    { label: "    codebase_stats", value: "1" },
  ])

  const completedCalls: JsonValue[] = [
    { tool: "rubydex.codebase_stats", status: "completed", output: "private output" },
    { tool: "rubydex.codebase_stats", status: "error", input: "private input" },
    { tool: "posh.posh_search", status: "completed", output: "private output" },
  ]
  cached = [assistant("msg_002", { content: [tool("call-a", "execute", {
    state: { status: "completed", input: {}, content: [{ type: "text", text: "private result" }], metadata: { toolCalls: completedCalls } },
  })] })]
  bus.emit({
    id: "event-success", created: 3, type: "session.tool.success",
    durable: { aggregateID: "a", seq: 2, version: 2 },
    data: {
      sessionID: "a", assistantMessageID: "msg_002", id: "call-a", executed: false,
      content: [{ type: "text", text: "private result" }], metadata: { toolCalls: completedCalls },
    },
  })
  await flushEvents()
  assert.deepEqual(view.rows().slice(5), [
    { label: "Tool calls", value: "4" },
    { label: "  rubydex (subtotal)", value: "2" },
    { label: "    codebase_stats", value: "2" },
    { label: "  execute", value: "1" },
    { label: "  posh (subtotal)", value: "1" },
    { label: "    posh_search", value: "1" },
  ])

  cached = [assistant("msg_003", { content: [tool("call-b", "grep", {
    state: { status: "error", input: {}, error: { type: "tool.execution", message: "private failure" } },
  })] })]
  bus.emit({
    id: "event-failed", created: 4, type: "session.tool.failed",
    durable: { aggregateID: "a", seq: 3, version: 2 },
    data: {
      sessionID: "a", assistantMessageID: "msg_003", id: "call-b", executed: false,
      error: { type: "tool.execution", message: "private failure" },
    },
  })
  await flushEvents()
  assert.deepEqual(view.rows().slice(5), [
    { label: "Tool calls", value: "5" },
    { label: "  rubydex (subtotal)", value: "2" },
    { label: "    codebase_stats", value: "2" },
    { label: "  execute", value: "1" },
    { label: "  grep", value: "1" },
    { label: "  posh (subtotal)", value: "1" },
    { label: "    posh_search", value: "1" },
  ])
  assert.doesNotMatch(JSON.stringify(history.get("a")!.messages.map((message) => message.tools)), /private|input|output|metadata|status/)

  // A stale progress snapshot and recent-cache eviction cannot erase calls.
  cached = [assistant("msg_002", { content: [tool("call-a", "execute", {
    state: { status: "running", input: {}, metadata: progress.data.metadata },
  })] })]
  bus.emit(progress)
  await flushEvents()
  assert.equal(view.rows()[5].value, "5")
  cached = []
  bus.emit(progress)
  await flushEvents()
  assert.equal(view.rows()[5].value, "5")
  stopEvents()
  cached = [assistant("msg_004", { content: [tool("call-c", "shell")] })]
  bus.emit(progress)
  await flushEvents()
  assert.equal(view.rows()[5].value, "5")
})

test("undo, reconnect, deletion, and cleanup use the same production subscriptions", async (t) => {
  const bus = events()
  let data: SessionMessageInfo[] = [
    assistant("msg_002", { content: [tool("call-a", "read")] }),
    assistant("msg_003", { content: [tool("call-b", "grep")] }),
  ]
  const history = new HistoryStore(async () => ({ data, cursor: {} }), () => [])
  await history.refresh("a")
  const stopEvents = subscribeHistoryEvents(bus.data, history)
  t.after(() => { stopEvents(); history.dispose() })
  data = data.slice(0, 1)
  bus.emit({
    id: "event-undo", created: 1, type: "session.revert.committed",
    durable: { aggregateID: "a", seq: 1, version: 1 },
    data: { sessionID: "a", to: "msg_003" },
  })
  await new Promise((done) => setImmediate(done))
  assert.equal(calculateVitals(history.get("a")!.messages).toolCalls, 1)
  assert.equal(history.get("a")!.complete, true)

  data = []
  bus.emit({ id: "event-connected", type: "server.connected", data: {} })
  await new Promise((done) => setImmediate(done))
  assert.equal(calculateVitals(history.get("a")!.messages).toolCalls, 0)

  bus.emit({
    id: "event-deleted", created: 2, type: "session.deleted",
    durable: { aggregateID: "a", seq: 2, version: 2 }, data: { sessionID: "a" },
  })
  assert.equal(history.get("a"), undefined)
  stopEvents()
  bus.emit({ id: "event-connected-again", type: "server.connected", data: {} })
  await flushEvents()
  assert.equal(history.get("a"), undefined)
})
