import assert from "node:assert/strict"
import { test } from "node:test"
import { toolBreakdown } from "../src/tool-breakdown.ts"

test("empty and ungrouped breakdowns keep exact names and sort by frequency then name", () => {
  assert.deepEqual(toolBreakdown([]), [])
  assert.deepEqual(toolBreakdown([
    { name: "zebra", calls: 1 },
    { name: "shell", calls: 2 },
    { name: "alpha", calls: 1 },
  ]), [
    { label: "  shell", calls: 2 },
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
    { name: "posh.posh_search", calls: 1 },
    { name: "posh.posh_docsets", calls: 3 },
  ]
  const before = structuredClone(tools)
  assert.deepEqual(toolBreakdown(tools), [
    { label: "  execute", calls: 4 },
    { label: "  posh (subtotal)", calls: 4 },
    { label: "    posh_docsets", calls: 3 },
    { label: "    posh_search", calls: 1 },
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

test("namespace grouping uses only the first dot and preserves the remaining child name", () => {
  assert.deepEqual(toolBreakdown([
    { name: "mcp.server.search", calls: 2 },
    { name: "mcp.other.search", calls: 1 },
    { name: "mcp.server.read", calls: 2 },
  ]), [
    { label: "  mcp (subtotal)", calls: 5 },
    { label: "    server.read", calls: 2 },
    { label: "    server.search", calls: 2 },
    { label: "    other.search", calls: 1 },
  ])
})

test("empty namespace or child names remain ungrouped", () => {
  assert.deepEqual(toolBreakdown([
    { name: ".search", calls: 2 },
    { name: "posh.", calls: 1 },
  ]), [
    { label: "  .search", calls: 2 },
    { label: "  posh.", calls: 1 },
  ])
})

test("namespace keys are case-sensitive and safe for arbitrary recorded names", () => {
  assert.deepEqual(toolBreakdown([
    { name: "posh.search", calls: 3 },
    { name: "Posh.search", calls: 2 },
    { name: "__proto__.search", calls: 1 },
  ]), [
    { label: "  posh (subtotal)", calls: 3 },
    { label: "    search", calls: 3 },
    { label: "  Posh (subtotal)", calls: 2 },
    { label: "    search", calls: 2 },
    { label: "  __proto__ (subtotal)", calls: 1 },
    { label: "    search", calls: 1 },
  ])
})
