import { createEffect, createMemo, onCleanup, untrack, type Accessor } from "solid-js"
import { contextSummary, footerSummary, sidebarRows, type Options } from "./format.ts"
import type { SidebarStore } from "./sidebar.ts"
import type { HistoryStore } from "./store.ts"
import type { VitalsStore } from "./vitals-store.ts"

type ViewContext = {
  history: HistoryStore
  vitals: VitalsStore
  sidebar: SidebarStore
  options: Options
  cost: (sessionID: string) => number
}

export function createFooterSummary(
  context: ViewContext,
  sessionID: Accessor<string | undefined>,
  width: Accessor<number>,
): Accessor<string> {
  const session = createMemo(() => {
    const id = sessionID()
    return id ? { id, metrics: context.vitals.observe(id) } : undefined
  })
  createEffect(() => {
    const id = sessionID()
    if (id) untrack(() => context.history.ensure(id))
  })
  return createMemo(() => {
    const current = session()
    if (!current) return ""
    const metrics = current.metrics()
    if (context.sidebar.visible(current.id)) return contextSummary(metrics.context, width())
    return footerSummary(metrics, {
      width: width(),
      complete: context.history.get(current.id)?.complete === true,
      cost: context.cost(current.id),
      options: context.options,
    })
  })
}

export function createSidebarRows(context: ViewContext, sessionID: Accessor<string>) {
  const metrics = createMemo(() => context.vitals.observe(sessionID()))
  createEffect(() => {
    const id = sessionID()
    onCleanup(untrack(() => context.sidebar.mount(id)))
    untrack(() => context.history.ensure(id))
  })
  return createMemo(() => sidebarRows(metrics()(), {
    complete: context.history.get(sessionID())?.complete === true,
    cost: context.cost(sessionID()),
    options: context.options,
  }))
}
