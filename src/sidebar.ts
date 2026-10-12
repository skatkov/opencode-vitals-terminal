import { createMutable } from "solid-js/store"

/** Track mounted sidebar contributions rather than guessing from terminal width. */
export class SidebarStore {
  private readonly mounted = createMutable<Record<string, number | undefined>>(Object.create(null))

  visible(sessionID: string): boolean {
    return (this.mounted[sessionID] ?? 0) > 0
  }

  mount(sessionID: string): () => void {
    this.mounted[sessionID] = (this.mounted[sessionID] ?? 0) + 1
    let active = true
    return () => {
      if (!active) return
      active = false
      const count = this.mounted[sessionID] ?? 0
      if (count <= 1) delete this.mounted[sessionID]
      else this.mounted[sessionID] = count - 1
    }
  }
}
