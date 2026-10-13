import assert from "node:assert/strict"
import { test } from "node:test"
import { readHistory } from "../src/history.ts"
import { calculateVitals } from "../src/metrics.ts"
import { assistant, tool, user } from "./fixtures.ts"

test("history follows every page and uses order only on the first request", async () => {
  const inputs: unknown[] = []
  const controller = new AbortController()
  const messages = await readHistory(async (input, options) => {
    inputs.push(input)
    assert.equal(options.signal, controller.signal)
    return input.cursor
      ? { data: [assistant()], cursor: {} }
      : { data: [user()], cursor: { next: "next-page" } }
  }, "session-1", controller.signal)
  assert.deepEqual(inputs, [
    { sessionID: "session-1", limit: 200, order: "asc" },
    { sessionID: "session-1", limit: 200, cursor: "next-page" },
  ])
  assert.deepEqual(messages.map((message) => message.id), ["msg_001", "msg_002"])
})

test("tool totals span all history pages without duplicating overlapping calls", async () => {
  const first = assistant("msg_002", { content: [tool("call-a", "read")] })
  const second = assistant("msg_003", { content: [tool("call-b", "grep"), tool("call-c", "read")] })
  const messages = await readHistory(async (input) => input.cursor
    ? { data: [first, second], cursor: {} }
    : { data: [first], cursor: { next: "page-2" } }, "a", new AbortController().signal)
  const metrics = calculateVitals(messages)
  assert.equal(metrics.toolCalls, 3)
  assert.deepEqual(metrics.tools, [{ name: "read", calls: 2 }, { name: "grep", calls: 1 }])
})

test("overlapping pages do not inflate counts", async () => {
  const messages = await readHistory(async (input) => ({
    data: [assistant()], cursor: input.cursor ? {} : { next: "page-2" },
  }), "session-1", new AbortController().signal)
  assert.equal(messages.length, 1)
})

test("a repeated cursor stops rather than looping forever", async () => {
  await assert.rejects(readHistory(async () => ({ data: [], cursor: { next: "same" } }),
    "session-1", new AbortController().signal), /repeated history cursor/)
})

test("cancelled reads never start another request", async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(readHistory(async () => {
    calls++
    controller.abort()
    return { data: [], cursor: { next: "page-2" } }
  }, "session-1", controller.signal), { name: "AbortError" })
  assert.equal(calls, 1)
})

test("an already cancelled history read does not contact the server", async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(readHistory(async () => {
    calls++
    return { data: [], cursor: {} }
  }, "session-1", controller.signal), { name: "AbortError" })
  assert.equal(calls, 0)
})

test("cancellation while reading the last page rejects instead of publishing its messages", async () => {
  const controller = new AbortController()
  await assert.rejects(readHistory(async () => {
    controller.abort()
    return { data: [user()], cursor: {} }
  }, "session-1", controller.signal), { name: "AbortError" })
})
