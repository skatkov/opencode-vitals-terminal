import assert from "node:assert/strict"
import { test } from "node:test"
import { createComputed, createRoot, createSignal, onCleanup, untrack } from "solid-js"
import { SidebarStore } from "../src/sidebar.ts"

test("sidebar mount and cleanup reactively switch footer visibility", () => {
  const sidebar = new SidebarStore()
  let visible = false
  const stop = createRoot((dispose) => {
    createComputed(() => { visible = sidebar.visible("a") })
    return dispose
  })
  assert.equal(visible, false)
  const unmount = sidebar.mount("a")
  assert.equal(visible, true)
  unmount()
  assert.equal(visible, false)
  const remount = sidebar.mount("a")
  assert.equal(visible, true)
  remount()
  assert.equal(visible, false)
  stop()
})

test("sidebar visibility is scoped to the session whose contribution is mounted", () => {
  const sidebar = new SidebarStore()
  const unmount = sidebar.mount("a")
  assert.equal(sidebar.visible("a"), true)
  assert.equal(sidebar.visible("b"), false)
  unmount()
  assert.equal(sidebar.visible("a"), false)
})

test("overlapping mounts do not hide another sidebar contribution", () => {
  const sidebar = new SidebarStore()
  const first = sidebar.mount("a")
  const second = sidebar.mount("a")
  first()
  assert.equal(sidebar.visible("a"), true)
  second()
  assert.equal(sidebar.visible("a"), false)
})

test("a reused sidebar follows reactive session changes and disposes cleanly", () => {
  const sidebar = new SidebarStore()
  const [sessionID, setSessionID] = createSignal("a")
  const stop = createRoot((dispose) => {
    createComputed(() => {
      const id = sessionID()
      onCleanup(untrack(() => sidebar.mount(id)))
    })
    return dispose
  })
  assert.equal(sidebar.visible("a"), true)
  setSessionID("b")
  assert.equal(sidebar.visible("a"), false)
  assert.equal(sidebar.visible("b"), true)
  stop()
  assert.equal(sidebar.visible("b"), false)
})

test("the final unmount releases the session key rather than retaining a zero count", () => {
  const sidebar = new SidebarStore()
  const first = sidebar.mount("a")
  const second = sidebar.mount("a")
  first()
  assert.deepEqual(Object.keys(sidebar["mounted"]), ["a"])
  second()
  // Resource retention is not observable through visible(), which treats zero as hidden.
  assert.deepEqual(Object.keys(sidebar["mounted"]), [])
})
