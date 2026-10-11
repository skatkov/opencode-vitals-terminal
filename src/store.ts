import type { ReadPage } from "./history.ts"
import { readHistory } from "./history.ts"
import { mergeMessages, type MetricMessage } from "./metrics.ts"

export type HistoryState = {
  messages: MetricMessage[]
  complete: boolean
  loading: boolean
  error?: string
}

export class HistoryStore {
  private readonly states = new Map<string, HistoryState>()
  private readonly requests = new Map<string, AbortController>()
  private disposed = false
  private readonly readPage: ReadPage
  private readonly cached: (sessionID: string) => MetricMessage[]
  private readonly changed: () => void

  constructor(
    readPage: ReadPage,
    cached: (sessionID: string) => MetricMessage[],
    changed: () => void,
  ) {
    this.readPage = readPage
    this.cached = cached
    this.changed = changed
  }

  get(sessionID: string): HistoryState | undefined {
    return this.states.get(sessionID)
  }

  ensure(sessionID: string): void {
    if (!this.states.has(sessionID) && !this.disposed) void this.refresh(sessionID)
  }

  update(sessionID: string): void {
    const state = this.states.get(sessionID)
    if (!state || this.disposed) return
    state.messages = mergeMessages(state.messages, this.cached(sessionID))
    this.changed()
  }

  truncate(sessionID: string, boundary: string): void {
    const state = this.states.get(sessionID)
    if (!state) return
    state.messages = state.messages.filter((message) => message.id < boundary)
    this.changed()
    void this.refresh(sessionID)
  }

  async refresh(sessionID: string): Promise<void> {
    if (this.disposed) return
    this.requests.get(sessionID)?.abort()
    const controller = new AbortController()
    this.requests.set(sessionID, controller)
    const previous = this.states.get(sessionID)
    this.states.set(sessionID, {
      messages: mergeMessages(previous?.messages ?? [], this.cached(sessionID)),
      complete: false,
      loading: true,
    })
    this.changed()
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
      const history = await readHistory(this.readPage, sessionID, signal)
      if (controller.signal.aborted || this.disposed) return
      this.states.set(sessionID, {
        // A fresh server snapshot is authoritative after undo or reconnect.
        // Overlay current live messages, not an older historical snapshot.
        messages: mergeMessages(history, this.cached(sessionID)),
        complete: true,
        loading: false,
      })
      this.changed()
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return
      this.states.set(sessionID, {
        messages: this.states.get(sessionID)?.messages ?? [],
        complete: false,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to read session history",
      })
      this.changed()
    } finally {
      if (this.requests.get(sessionID) === controller) this.requests.delete(sessionID)
    }
  }

  reconnect(): void {
    for (const sessionID of this.states.keys()) void this.refresh(sessionID)
  }

  forget(sessionID: string): void {
    this.requests.get(sessionID)?.abort()
    this.requests.delete(sessionID)
    this.states.delete(sessionID)
    this.changed()
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
    this.states.clear()
  }
}
