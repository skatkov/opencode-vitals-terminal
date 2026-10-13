import assert from "node:assert/strict"
import { test } from "node:test"
import { mergeMessages, projectMessages } from "../src/metrics.ts"
import { projectToolCalls } from "../src/tool-calls.ts"
import { assistant, tool } from "./fixtures.ts"

test("projection normalizes duplicate calls with the latest name before any merge or aggregation", () => {
  assert.deepEqual(projectToolCalls([
    tool("same-id", "old-name"),
    tool("same-id", "read"),
    tool("pending", "shell", { state: { status: "streaming", input: "private" } }),
  ]), { '["same-id",null]': "read" })
})

test("tuple identities distinguish arbitrary outer IDs from nested calls", () => {
  const names = projectToolCalls([
    tool("call-a", "execute", { state: { status: "running", input: {}, metadata: { toolCalls: [{ tool: "rubydex.codebase_stats" }] } } }),
    tool("call-a:0", "read"),
    tool('["call-a",0]', "grep"),
    tool("__proto__", "shell"),
  ])
  assert.equal(Object.keys(names).length, 5)
  assert.deepEqual(Object.values(names), ["execute", "rubydex.codebase_stats", "read", "grep", "shell"])
})

test("message unions preserve old calls, overwrite matching names, and do not mutate projections", () => {
  const history = projectMessages([assistant("msg_002", { content: [tool("call-a", "old-name"), tool("call-b", "grep")] })])
  const live = projectMessages([assistant("msg_002", { content: [tool("call-a", "read"), tool("call-c", "shell")] })])
  const before = structuredClone([history, live])
  const merged = mergeMessages(history, live)
  assert.deepEqual(Object.values(merged[0].tools!), ["read", "grep", "shell"])
  assert.deepEqual([history, live], before)
  assert.notStrictEqual(merged[0].tools, history[0].tools)
  assert.notStrictEqual(merged[0].tools, live[0].tools)
})
