import assert from "node:assert/strict"
import { test } from "node:test"
import { toolBreakdown } from "../src/tool-breakdown.ts"

test("empty and ungrouped breakdowns keep exact names and sort by frequency then name", () => {
  assert.deepEqual(toolBreakdown([]), [])
  assert.deepEqual(toolBreakdown([
    { name: "zebra", calls: 1 },
    { name: "mcp.server.search", calls: 2 },
    { name: "alpha", calls: 1 },
  ]), [
    { label: "  mcp.server.search", calls: 2 },
    { label: "  alpha", calls: 1 },
    { label: "  zebra", calls: 1 },
  ])
})

test("subtotal and child ordering do not depend on accounting's input order", () => {
  const tools = [
    { name: "rubydex.zebra", calls: 1 },
    { name: "shell", calls: 4 },
    { name: "rubydex.alpha", calls: 1 },
    { name: "execute", calls: 4 },
    { name: "rubydex.read", calls: 2 },
  ]
  const before = structuredClone(tools)
  assert.deepEqual(toolBreakdown(tools), [
    { label: "  execute", calls: 4 },
    { label: "  rubydex (subtotal)", calls: 4 },
    { label: "    read", calls: 2 },
    { label: "    alpha", calls: 1 },
    { label: "    zebra", calls: 1 },
    { label: "  shell", calls: 4 },
  ])
  assert.deepEqual(tools, before)
})

test("a synthetic subtotal is distinct from an actual tool named rubydex", () => {
  assert.deepEqual(toolBreakdown([
    { name: "rubydex", calls: 2 },
    { name: "rubydex.get_declaration", calls: 1 },
  ]), [
    { label: "  rubydex", calls: 2 },
    { label: "  rubydex (subtotal)", calls: 1 },
    { label: "    get_declaration", calls: 1 },
  ])
})
