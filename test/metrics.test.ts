import assert from "node:assert/strict"
import { test } from "node:test"
import type { SessionMessageInfo } from "@opencode/client"
import { calculateVitals, mergeMessages, projectMessages, tokenTotal } from "../src/metrics.ts"
import { assistant, usage, user } from "./fixtures.ts"

test("empty sessions have honest zeros and no context estimate", () => {
  const value = calculateVitals([])
  assert.equal(value.turns, 0)
  assert.equal(value.steps, 0)
  assert.equal(value.totalTokens, 0)
  assert.equal(value.context, undefined)
})

test("turns count user messages and steps count model calls, not tool calls", () => {
  const value = calculateVitals(projectMessages([
    user(),
    assistant("msg_002", { content: [
      { type: "tool", id: "call-a", name: "read", state: { status: "streaming", input: "" }, time: { created: 2 } },
      { type: "tool", id: "call-b", name: "grep", state: { status: "streaming", input: "" }, time: { created: 2 } },
    ] }),
    assistant("msg_003", { time: { created: 3 }, tokens: undefined }),
    user("msg_004"),
    assistant("msg_005"),
  ]))
  assert.equal(value.turns, 2)
  assert.equal(value.steps, 3)
  assert.equal(value.completedSteps, 2)
  assert.equal(value.totalTokens, tokenTotal(usage) * 2)
})

test("token totals use input, output, reasoning, and both cache buckets exactly once", () => {
  const value = calculateVitals(projectMessages([assistant(), assistant("msg_003")]))
  assert.deepEqual(value.tokens, { input: 200, output: 40, reasoning: 20, cache: { read: 100, write: 10 } })
  assert.equal(value.totalTokens, 370)
  assert.equal(value.context?.tokens, 185)
})

test("a failed call is a step; missing provider usage is not invented", () => {
  const value = calculateVitals(projectMessages([assistant("msg_001", {
    tokens: undefined,
    finish: "error",
    error: { type: "provider.error", message: "failed" },
  })]))
  assert.equal(value.steps, 1)
  assert.equal(value.totalTokens, 0)
  assert.equal(value.context, undefined)
})

test("compaction resets the context estimate but not lifetime timeline totals", () => {
  const compaction: SessionMessageInfo = {
    id: "msg_003", type: "compaction", status: "completed", reason: "auto",
    summary: "Private summary", recent: "", time: { created: 3 },
  }
  const before = calculateVitals(projectMessages([user(), assistant(), compaction]))
  assert.equal(before.steps, 1)
  assert.equal(before.totalTokens, 185)
  assert.equal(before.context, undefined)
  const after = calculateVitals(projectMessages([user(), assistant(), compaction, assistant("msg_004")]))
  assert.equal(after.totalTokens, 370)
  assert.equal(after.context?.tokens, 185)
})

test("synthetic input, idle markers, and compaction are not user turns or model steps", () => {
  const value = calculateVitals(projectMessages([
    { id: "msg_001", type: "synthetic", text: "notice", time: { created: 1 } },
    { id: "msg_002", type: "idle", outcome: "succeeded", time: { created: 2 } },
    { id: "msg_003", type: "compaction", status: "running", reason: "manual", summary: "", recent: "", time: { created: 3 } },
  ]))
  assert.equal(value.turns, 0)
  assert.equal(value.steps, 0)
})

test("context percentage follows the last assistant's model, not the newly selected model", () => {
  const value = calculateVitals(projectMessages([assistant()]), [
    { id: "other", providerID: "test", limit: { context: 100, output: 100 } },
    { id: "model", providerID: "test", limit: { context: 1000, output: 100 } },
  ])
  assert.deepEqual(value.context, { tokens: 185, percent: 19 })
})

test("unknown models keep the context count without guessing a percentage", () => {
  assert.deepEqual(calculateVitals(projectMessages([assistant()])).context, { tokens: 185, percent: undefined })
})

test("history and live messages are deduplicated by ID across reloads and repeated events", () => {
  const messages = projectMessages([user(), assistant()])
  const merged = mergeMessages(messages, messages, messages)
  assert.equal(merged.length, 2)
  assert.equal(calculateVitals(merged).totalTokens, 185)
})

test("a stale live snapshot cannot erase finalized tokens or completion", () => {
  const history = projectMessages([assistant()])
  const stale = projectMessages([assistant("msg_002", { time: { created: 2 }, tokens: undefined })])
  const value = calculateVitals(mergeMessages(history, stale))
  assert.equal(value.totalTokens, 185)
  assert.equal(value.completedSteps, 1)
})

test("new finalized usage replaces the old snapshot instead of accumulating twice", () => {
  const old = projectMessages([assistant()])
  const updated = projectMessages([assistant("msg_002", { tokens: { ...usage, output: 40 } })])
  const value = calculateVitals(mergeMessages(old, updated))
  assert.equal(value.steps, 1)
  assert.equal(value.totalTokens, 205)
})

test("staged undo excludes messages at and after the boundary, even if the boundary is not cached", () => {
  const messages = projectMessages([user(), assistant(), user("msg_004"), assistant("msg_005")])
  assert.equal(calculateVitals(messages, [], "msg_004").turns, 1)
  assert.equal(calculateVitals(messages, [], "msg_003").steps, 1)
  assert.equal(calculateVitals(messages, [], "msg_000").totalTokens, 0)
})

test("metric projections discard prompt text, response content, and tool output", () => {
  const message = assistant()
  const projected = projectMessages([user(), message])
  assert.equal(JSON.stringify(projected).includes("must not be retained"), false)
  assert.equal("content" in projected[1], false)
  assert.equal("text" in projected[0], false)
  message.tokens!.cache.read = 999
  assert.equal(projected[1].tokens!.cache.read, 50)
})

test("compaction metadata is projected only for compactions and reflects their status", () => {
  const compaction: SessionMessageInfo = {
    id: "msg_003", type: "compaction", status: "running", reason: "manual",
    summary: "", recent: "", time: { created: 3 },
  }
  const projected = projectMessages([user(), compaction])
  assert.deepEqual(projected, [
    { id: "msg_001", type: "user" },
    { id: "msg_003", type: "compaction", compactionCompleted: false },
  ])
})

test("merging unordered history and live groups sorts unique message IDs", () => {
  const messages = mergeMessages(
    projectMessages([assistant("msg_004"), user("msg_001"), assistant("msg_003")]),
    projectMessages([assistant("msg_002"), user("msg_001")]),
  )
  assert.deepEqual(messages.map((message) => message.id), ["msg_001", "msg_002", "msg_003", "msg_004"])
})

test("unfinished compaction and later user or idle messages preserve the last context usage", () => {
  const messages = projectMessages([assistant()])
  for (const message of [
    { id: "msg_003", type: "compaction", compactionCompleted: false },
    { id: "msg_003", type: "user" },
    { id: "msg_003", type: "idle" },
    { id: "msg_003", type: "user", compactionCompleted: true },
  ] as const) {
    assert.deepEqual(calculateVitals([...messages, message]).context, { tokens: 185, percent: undefined })
  }
})

test("context model lookup distinguishes providers with the same model ID", () => {
  assert.deepEqual(calculateVitals(projectMessages([assistant()]), [
    { id: "model", providerID: "other", limit: { context: 100, output: 100 } },
    { id: "model", providerID: "test", limit: { context: 1000, output: 100 } },
  ]).context, { tokens: 185, percent: 19 })
})

test("zero and negative usage never produce a context estimate", () => {
  for (const input of [0, -1]) {
    const messages = projectMessages([assistant("msg_002", {
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })])
    assert.equal(calculateVitals(messages).context, undefined)
  }
})
