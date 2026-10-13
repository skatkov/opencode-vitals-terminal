import type { Data } from "@opencode/plugin/tui/context"
import type { HistoryStore } from "./store.ts"

const updates = [
  "session.inbox.delivered",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.compaction.ended",
] as const

/** Observe the host cache after its event handlers have applied the snapshot. */
export function subscribeHistoryEvents(data: Pick<Data, "on">, history: HistoryStore): () => void {
  const subscriptions = [
    data.on("server.connected", () => history.reconnect()),
    data.on("session.deleted", (event) => history.forget(event.data.sessionID)),
    data.on("session.revert.committed", (event) => queueMicrotask(() => history.truncate(event.data.sessionID, event.data.to))),
    ...updates.map((type) => data.on(type, (event) =>
      queueMicrotask(() => history.update(event.data.sessionID)))),
  ]
  return () => {
    for (const stop of subscriptions) stop()
  }
}
