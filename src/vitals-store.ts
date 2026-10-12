import { createMemo, createRoot, onCleanup, type Accessor } from "solid-js"
import type { Vitals } from "./metrics.ts"

type Observation = { metrics: Accessor<Vitals>; consumers: number; dispose: () => void }

/** Share accounting between views without retaining projections for unmounted sessions. */
export class VitalsStore {
  private readonly observations = new Map<string, Observation>()
  private readonly read: (sessionID: string) => Vitals

  constructor(read: (sessionID: string) => Vitals) {
    this.read = read
  }

  /** Call from a Solid owner; its cleanup releases this view's observation. */
  observe(sessionID: string): Accessor<Vitals> {
    let observation = this.observations.get(sessionID)
    if (!observation) {
      // A shared memo must outlive whichever view happens to observe it first.
      observation = createRoot((dispose) => ({
        metrics: createMemo(() => this.read(sessionID)),
        consumers: 0,
        dispose,
      }))
      this.observations.set(sessionID, observation)
    }
    const current = observation
    current.consumers++
    onCleanup(() => {
      if (--current.consumers === 0) {
        this.observations.delete(sessionID)
        current.dispose()
      }
    })
    return current.metrics
  }

  dispose(): void {
    for (const observation of this.observations.values()) observation.dispose()
    this.observations.clear()
  }
}
