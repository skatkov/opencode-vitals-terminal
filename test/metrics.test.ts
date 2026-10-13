import assert from "node:assert/strict"
import { test } from "node:test"
import type { JsonValue, SessionMessageInfo } from "@opencode/client"
import { calculateVitals, mergeMessages, projectMessages, tokenTotal } from "../src/metrics.ts"
import { assistant, tool, usage, user } from "./fixtures.ts"

test("empty sessions have honest zeros and no context estimate", () => {
  const value = calculateVitals([])
  assert.equal(value.turns, 0)
  assert.equal(value.steps, 0)
  assert.equal(value.toolCalls, 0)
  assert.deepEqual(value.tools, [])
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
  const call = tool("call-a", "read", {
    state: {
      status: "completed", input: { path: "Private path that must not be retained" },
      content: [{ type: "text", text: "Tool output that must not be retained" }],
      metadata: { private: "Metadata that must not be retained" },
    },
  })
  const message = assistant("msg_002", { content: [...assistant().content, call] })
  const projected = projectMessages([user(), message])
  assert.equal(JSON.stringify(projected).includes("must not be retained"), false)
  assert.equal("content" in projected[1], false)
  assert.equal("text" in projected[0], false)
  assert.deepEqual(Object.values(projected[1].tools!), ["read"])
  call.name = "changed"
  assert.deepEqual(Object.values(projected[1].tools!), ["read"])
  message.tokens!.cache.read = 999
  assert.equal(projected[1].tokens!.cache.read, 50)
})

test("tools count running, completed, failed, and provider-executed calls but not streamed inputs", () => {
  const value = calculateVitals(projectMessages([assistant("msg_002", {
    tokens: undefined,
    time: { created: 2 },
    content: [
      tool("call-a", "read"),
      tool("call-b", "read", { state: { status: "completed", input: {}, content: [{ type: "text", text: "private" }] } }),
      tool("call-c", "grep", { state: { status: "error", input: {}, error: { type: "tool.execution", message: "failed" } } }),
      tool("call-d", "websearch", { executed: true }),
      tool("call-e", "shell", { state: { status: "streaming", input: "partial" } }),
      { type: "reasoning", text: "private", time: { created: 2 } },
      { type: "text", text: "private" },
    ],
  })]))
  assert.equal(value.steps, 1)
  assert.equal(value.completedSteps, 0)
  assert.equal(value.totalTokens, 0)
  assert.equal(value.toolCalls, 4)
  assert.deepEqual(value.tools, [
    { name: "read", calls: 2 },
    { name: "grep", calls: 1 },
    { name: "websearch", calls: 1 },
  ])
})

test("tool breakdown sorts by frequency then name and preserves exact MCP names", () => {
  const value = calculateVitals(projectMessages([assistant("msg_002", { content: [
    tool("call-a", "zebra"),
    tool("call-b", "mcp.server.search"),
    tool("call-c", "mcp.server.search"),
    tool("call-d", "mcp.server.search"),
    tool("call-e", "__proto__"),
    tool("call-f", "zebra"),
    tool("call-g", "alpha"),
  ] })]))
  assert.equal(value.toolCalls, 7)
  assert.deepEqual(value.tools, [
    { name: "mcp.server.search", calls: 3 },
    { name: "zebra", calls: 2 },
    { name: "__proto__", calls: 1 },
    { name: "alpha", calls: 1 },
  ])
})

test("Code Mode metadata exposes running, completed, and failed nested calls without retaining inputs or outputs", () => {
  const calls: Record<string, JsonValue>[] = [
    { tool: "rubydex.get_declaration", status: "running", input: { name: "PrivateClass" } },
    { tool: "rubydex.get_declaration", status: "completed", input: { name: "OtherPrivateClass" }, output: "private result" },
    { tool: "posh.posh_search", status: "error", input: { query: "private query" } },
  ]
  const projected = projectMessages([assistant("msg_002", { content: [tool("call-a", "execute", {
    state: { status: "running", input: { code: "Private code" }, metadata: { toolCalls: calls } },
  })] })])
  assert.deepEqual(Object.values(projected[0].tools!), [
    "execute", "rubydex.get_declaration", "rubydex.get_declaration", "posh.posh_search",
  ])
  const value = calculateVitals(projected)
  assert.equal(value.toolCalls, 4)
  assert.deepEqual(value.tools, [
    { name: "rubydex.get_declaration", calls: 2 },
    { name: "execute", calls: 1 },
    { name: "posh.posh_search", calls: 1 },
  ])
  const serialized = JSON.stringify(projected[0].tools)
  assert.doesNotMatch(serialized, /Private|private|input|output|metadata|status/)
  calls[0].tool = "changed"
  assert.deepEqual(Object.values(projected[0].tools!), [
    "execute", "rubydex.get_declaration", "rubydex.get_declaration", "posh.posh_search",
  ])
})

test("missing or malformed Code Mode traces never invent nested calls", () => {
  for (const toolCalls of [null, false, 42, "rubydex.get_declaration", {}] as JsonValue[]) {
    const value = calculateVitals(projectMessages([assistant("msg_002", { content: [tool("call-a", "execute", {
      state: { status: "running", input: {}, metadata: { toolCalls } },
    })] })]))
    assert.deepEqual(value.tools, [{ name: "execute", calls: 1 }])
  }
  const value = calculateVitals(projectMessages([assistant("msg_002", { content: [
    tool("call-a", "execute"),
    tool("call-b", "execute", { state: { status: "completed", input: {}, content: [{ type: "text", text: "done" }] } }),
    tool("call-c", "execute", { state: { status: "running", input: {}, metadata: { toolCalls: [] } } }),
  ] })]))
  assert.equal(value.toolCalls, 3)
  assert.deepEqual(value.tools, [{ name: "execute", calls: 3 }])
})

test("malformed nested records are skipped without changing valid calls' trace indexes", () => {
  const calls: JsonValue[] = [null, false, 1, "not a record", [], {}, { tool: null }, { tool: 42 }, { tool: "" },
    { tool: "rubydex.codebase_stats", status: "completed" }]
  const projected = projectMessages([assistant("msg_002", { content: [tool("call-a", "execute", {
    state: { status: "running", input: {}, metadata: { toolCalls: calls } },
  })] })])
  assert.deepEqual(projected[0].tools, {
    '["call-a",null]': "execute",
    '["call-a",9]': "rubydex.codebase_stats",
  })
  assert.equal(calculateVitals(projected).toolCalls, 2)
})

test("other tools' metadata is not interpreted as a Code Mode trace", () => {
  const value = calculateVitals(projectMessages([assistant("msg_002", { content: [tool("call-a", "read", {
    state: { status: "running", input: {}, metadata: { toolCalls: [{ tool: "not-an-invocation" }] } },
  })] })]))
  assert.deepEqual(value.tools, [{ name: "read", calls: 1 }])
})

test("nested calls deduplicate across growing, finalized, repeated, and stale traces", () => {
  const snapshot = (calls: JsonValue[]) => projectMessages([assistant("msg_002", { content: [tool("call-a", "execute", {
    state: { status: "running", input: {}, metadata: { toolCalls: calls } },
  })] })])
  const first = snapshot([{ tool: "rubydex.codebase_stats", status: "running" }])
  const live = snapshot([
    { tool: "rubydex.codebase_stats", status: "completed" },
    { tool: "rubydex.codebase_stats", status: "running" },
  ])
  const merged = mergeMessages(first, live, live, first)
  assert.equal(Object.keys(merged[0].tools!).length, 3)
  const value = calculateVitals(merged)
  assert.equal(value.toolCalls, 3)
  assert.deepEqual(value.tools, [{ name: "rubydex.codebase_stats", calls: 2 }, { name: "execute", calls: 1 }])
  assert.equal(calculateVitals(merged, [], "msg_002").toolCalls, 0)
})

test("nested trace indexes cannot collide with top-level tool IDs", () => {
  const messages = projectMessages([assistant("msg_002", { content: [
    tool("call-a", "execute", { state: { status: "running", input: {}, metadata: { toolCalls: [{ tool: "rubydex.codebase_stats" }] } } }),
    tool("call-a:0", "read"),
  ] })])
  for (const projected of [messages, mergeMessages(messages, messages)]) {
    const value = calculateVitals(projected)
    assert.equal(value.toolCalls, 3)
    assert.deepEqual(value.tools, [{ name: "execute", calls: 1 }, { name: "read", calls: 1 }, { name: "rubydex.codebase_stats", calls: 1 }])
  }
})

test("tool IDs deduplicate within a step, not across separate model steps", () => {
  const value = calculateVitals(projectMessages([
    assistant("msg_002", { content: [tool("same-id", "read"), tool("same-id", "read")] }),
    assistant("msg_003", { content: [tool("same-id", "read")] }),
  ]))
  assert.equal(value.toolCalls, 2)
  assert.deepEqual(value.tools, [{ name: "read", calls: 2 }])
})

test("overlapping history and live tool snapshots count each call once", () => {
  const history = projectMessages([assistant("msg_002", { content: [tool("call-a", "read")] })])
  const live = projectMessages([assistant("msg_002", { content: [tool("call-a", "read"), tool("call-b", "grep")] })])
  const merged = mergeMessages(history, live, live)
  assert.deepEqual(Object.values(merged[0].tools!), ["read", "grep"])
  assert.equal(calculateVitals(merged).toolCalls, 2)
})

test("stale and streaming snapshots cannot erase previously called tools", () => {
  const history = projectMessages([assistant("msg_002", { content: [tool("call-a", "read")] })])
  for (const stale of [
    projectMessages([assistant("msg_002", { content: [] })]),
    projectMessages([assistant("msg_002", { content: [tool("call-a", "read", { state: { status: "streaming", input: "partial" } })] })]),
    [{ id: "msg_002", type: "assistant" } as const],
  ]) {
    const value = calculateVitals(mergeMessages(history, stale))
    assert.equal(value.toolCalls, 1)
    assert.deepEqual(value.tools, [{ name: "read", calls: 1 }])
  }
})

test("a called tool replaces its old name for the same ID rather than creating another call", () => {
  const value = calculateVitals(mergeMessages(
    projectMessages([assistant("msg_002", { content: [tool("call-a", "old-name")] })]),
    projectMessages([assistant("msg_002", { content: [tool("call-a", "read")] })]),
  ))
  assert.equal(value.toolCalls, 1)
  assert.deepEqual(value.tools, [{ name: "read", calls: 1 }])
})

test("undo excludes reverted tools and compaction preserves earlier tool counts", () => {
  const messages = projectMessages([
    assistant("msg_002", { content: [tool("call-a", "read")] }),
    { id: "msg_003", type: "compaction", status: "completed", reason: "auto", summary: "", recent: "", time: { created: 3 } },
    user("msg_004"),
    assistant("msg_005", { content: [tool("call-b", "grep")] }),
  ])
  assert.equal(calculateVitals(messages).toolCalls, 2)
  assert.deepEqual(calculateVitals(messages, [], "msg_004").tools, [{ name: "read", calls: 1 }])
  assert.equal(calculateVitals(messages, [], "msg_002").toolCalls, 0)
})

test("non-assistant messages cannot contribute tools", () => {
  const value = calculateVitals([{ id: "msg_001", type: "user", tools: { call: "read" } }])
  assert.equal(value.toolCalls, 0)
  assert.deepEqual(value.tools, [])
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
