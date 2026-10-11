import assert from "node:assert/strict"
import { test } from "node:test"
import { readHistory } from "../src/history.ts"
import { assistant, user } from "./fixtures.ts"

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
