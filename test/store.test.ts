import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessagesResponse } from "@opencode/client"
import { createComputed, createRoot } from "solid-js"
import { unwrap } from "solid-js/store"
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

test("footer and sidebar consumers share a single history read, including after remount", async () => {
  let reads = 0
  const store = new HistoryStore(async () => {
    reads++
    return { data: [user()], cursor: {} }
  }, () => [])
  store.ensure("a")
  store.ensure("a")
  assert.equal(reads, 1)
  await new Promise((done) => setImmediate(done))
  assert.equal(store.get("a")!.complete, true)
  store.ensure("a")
  assert.equal(reads, 1)
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
  assert.equal(store.get("a")!.loading, false)
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

test("undo filters the current snapshot immediately while its replacement is still pending", async () => {
  let resolve!: (response: SessionMessagesResponse) => void
  let cached = projectMessages([user(), assistant(), user("msg_003")])
  const store = new HistoryStore(() => new Promise((done) => { resolve = done }), () => cached)
  const initial = store.refresh("a")
  resolve({ data: [user(), assistant(), user("msg_003")], cursor: {} })
  await initial
  cached = []
  store.truncate("a", "msg_002")
  assert.deepEqual(store.get("a")!.messages.map((message) => message.id), ["msg_001"])
  assert.equal(store.get("a")!.complete, false)
  resolve({ data: [user()], cursor: {} })
  await new Promise((done) => setImmediate(done))
  store.dispose()
})

test("undo on an untracked session is a no-op", () => {
  let reads = 0
  const store = new HistoryStore(async () => {
    reads++
    return { data: [], cursor: {} }
  }, () => [])
  store.truncate("untracked", "msg_002")
  assert.equal(reads, 0)
  assert.equal(store.get("untracked"), undefined)
  store.dispose()
})

test("refresh exposes loading state and preserves cached messages across non-Error failures", async () => {
  let reject!: (error: unknown) => void
  const cached = projectMessages([assistant()])
  const store = new HistoryStore(() => new Promise((_resolve, fail) => { reject = fail }), () => cached)
  const loading = store.refresh("a")
  assert.deepEqual(unwrap(store.get("a")), { messages: cached, complete: false, loading: true })
  reject("offline")
  await loading
  assert.deepEqual(unwrap(store.get("a")), {
    messages: cached, complete: false, loading: false, error: "Unable to read session history",
  })
  store.dispose()
})

test("a disposed history store cannot start any new reads", async () => {
  let reads = 0
  const store = new HistoryStore(async () => {
    reads++
    return { data: [], cursor: {} }
  }, () => [])
  store.dispose()
  store.ensure("a")
  await store.refresh("b")
  assert.equal(reads, 0)
  assert.equal(store.get("a"), undefined)
  assert.equal(store.get("b"), undefined)
})

test("reconnect refreshes every tracked session without restoring deleted sessions", async () => {
  const reads: string[] = []
  let data = [user()]
  const store = new HistoryStore(async ({ sessionID }) => {
    reads.push(sessionID)
    return { data, cursor: {} }
  }, () => [])
  await store.refresh("a")
  await store.refresh("b")
  await store.refresh("deleted")
  store.forget("deleted")
  data = [assistant()]
  store.reconnect()
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(reads, ["a", "b", "deleted", "a", "b"])
  assert.equal(store.get("a")!.messages[0].type, "assistant")
  assert.equal(store.get("b")!.messages[0].type, "assistant")
  assert.equal(store.get("deleted"), undefined)
  store.dispose()
})

test("completed and failed requests release their controllers without later aborting them", async () => {
  const signals: AbortSignal[] = []
  const store = new HistoryStore(async ({ sessionID }, options) => {
    signals.push(options.signal)
    if (sessionID === "failed") throw new Error("offline")
    return { data: [], cursor: {} }
  }, () => [])
  await store.refresh("completed")
  await store.refresh("failed")
  store.forget("completed")
  store.dispose()
  assert.deepEqual(signals.map((signal) => signal.aborted), [false, false])
  assert.equal(store["requests"].size, 0)
})

test("an older request finishing cannot release a newer pending controller", async () => {
  const requests: Array<{ resolve: (response: SessionMessagesResponse) => void; signal: AbortSignal }> = []
  const store = new HistoryStore((_input, options) => new Promise((resolve) => {
    requests.push({ resolve, signal: options.signal })
  }), () => [])
  const older = store.refresh("a")
  const newer = store.refresh("a")
  requests[0].resolve({ data: [], cursor: {} })
  await older
  store.forget("a")
  assert.equal(requests[1].signal.aborted, true)
  assert.equal(store["requests"].size, 0)
  requests[1].resolve({ data: [], cursor: {} })
  await newer
  store.dispose()
})

test("disposal releases controllers even when their requests have not settled", async () => {
  let resolve!: (response: SessionMessagesResponse) => void
  const store = new HistoryStore(() => new Promise((done) => { resolve = done }), () => [])
  const loading = store.refresh("a")
  store.dispose()
  assert.equal(store["requests"].size, 0)
  resolve({ data: [], cursor: {} })
  await loading
})

test("forgetting a session between history completion and publication cannot resurrect it", async () => {
  const store = new HistoryStore(async () => {
    // The first microtask precedes readHistory's continuation; the second follows
    // its last abort check but precedes refresh's publication continuation.
    queueMicrotask(() => queueMicrotask(() => store.forget("a")))
    return { data: [user()], cursor: {} }
  }, () => [])
  await store.refresh("a")
  assert.equal(store.get("a"), undefined)
  store.dispose()
})
