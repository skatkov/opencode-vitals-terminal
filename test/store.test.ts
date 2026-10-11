import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessagesResponse } from "@opencode/client"
import { createComputed, createRoot } from "solid-js"
import { projectMessages, type MetricMessage } from "../src/metrics.ts"
import { HistoryStore } from "../src/store.ts"
import { assistant, user } from "./fixtures.ts"

test("tracked sessions stay separate and untracked background work is ignored", async () => {
  const store = new HistoryStore(async ({ sessionID }) => ({
    data: sessionID === "a" ? [user()] : [assistant()], cursor: {},
  }), () => [])
  await store.refresh("a")
  await store.refresh("b")
  store.update("untracked")
  assert.equal(store.get("a")!.messages[0].type, "user")
  assert.equal(store.get("b")!.messages[0].type, "assistant")
  assert.equal(store.get("untracked"), undefined)
  store.dispose()
})

test("live steps arriving during backfill survive its publication", async () => {
  let resolve!: (response: SessionMessagesResponse) => void
  let cached: MetricMessage[] = []
  const store = new HistoryStore(() => new Promise((done) => { resolve = done }), () => cached)
  let count = -1
  const stop = createRoot((dispose) => {
    createComputed(() => { count = store.get("a")?.messages.length ?? -1 })
    return dispose
  })
  const loading = store.refresh("a")
  cached = projectMessages([assistant()])
  store.update("a")
  assert.equal(count, 1)
  resolve({ data: [user()], cursor: {} })
  await loading
  assert.equal(store.get("a")!.complete, true)
  assert.equal(store.get("a")!.messages.length, 2)
  assert.equal(count, 2)
  store.dispose()
  assert.equal(count, -1)
  stop()
})

test("a refresh is authoritative after removed history", async () => {
  let messages = [user(), assistant()]
  const store = new HistoryStore(async () => ({ data: messages, cursor: {} }), () => [])
  await store.refresh("a")
  messages = [user()]
  await store.refresh("a")
  assert.equal(store.get("a")!.messages.length, 1)
  store.dispose()
})

test("history failures are explicit and a later refresh can recover", async () => {
  let fails = true
  const store = new HistoryStore(async () => {
    if (fails) throw new Error("offline")
    return { data: [user()], cursor: {} }
  }, () => [])
  await store.refresh("a")
  assert.equal(store.get("a")!.complete, false)
  assert.equal(store.get("a")!.loading, false)
  assert.equal(store.get("a")!.error, "offline")
  fails = false
  await store.refresh("a")
  assert.equal(store.get("a")!.complete, true)
  assert.equal(store.get("a")!.error, undefined)
  store.dispose()
})

test("disposal aborts pending reads and prevents late updates", async () => {
  let resolve!: (response: SessionMessagesResponse) => void
  let signal!: AbortSignal
  const store = new HistoryStore((_input, options) => {
    signal = options.signal
    return new Promise((done) => { resolve = done })
  }, () => [])
  const loading = store.refresh("a")
  store.dispose()
  assert.equal(signal.aborted, true)
  resolve({ data: [user()], cursor: {} })
  await loading
  assert.equal(store.get("a"), undefined)
})

test("a newer refresh wins over an older in-flight request", async () => {
  const requests: Array<(response: SessionMessagesResponse) => void> = []
  const store = new HistoryStore(() => new Promise((done) => requests.push(done)), () => [])
  const older = store.refresh("a")
  const newer = store.refresh("a")
  requests[1]({ data: [assistant()], cursor: {} })
  await newer
  requests[0]({ data: [user()], cursor: {} })
  await older
  assert.equal(store.get("a")!.messages[0].type, "assistant")
  store.dispose()
})

test("committed undo immediately removes reverted messages and reloads", async () => {
  let messages = [user(), assistant()]
  const store = new HistoryStore(async () => ({ data: messages, cursor: {} }), () => [])
  await store.refresh("a")
  messages = [user()]
  store.truncate("a", "msg_002")
  assert.equal(store.get("a")!.messages.length, 1)
  await store.refresh("a")
  assert.equal(store.get("a")!.complete, true)
  assert.equal(store.get("a")!.messages.length, 1)
  store.dispose()
})

test("forgetting a deleted session aborts its reads and drops its counts", async () => {
  let signal!: AbortSignal
  let resolve!: (response: SessionMessagesResponse) => void
  const store = new HistoryStore((_input, options) => {
    signal = options.signal
    return new Promise((done) => { resolve = done })
  }, () => [])
  const loading = store.refresh("a")
  store.forget("a")
  assert.equal(signal.aborted, true)
  assert.equal(store.get("a"), undefined)
  resolve({ data: [user()], cursor: {} })
  await loading
  assert.equal(store.get("a"), undefined)
  store.dispose()
})
