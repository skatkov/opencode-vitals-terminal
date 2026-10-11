import type { MessageListInput, SessionMessagesResponse } from "@opencode/client"
import { mergeMessages, projectMessages, type MetricMessage } from "./metrics.ts"

export type ReadPage = (
  input: MessageListInput,
  options: { signal: AbortSignal },
) => Promise<SessionMessagesResponse>

/** The TUI caches only recent messages. Page through history for honest totals. */
export async function readHistory(
  readPage: ReadPage,
  sessionID: string,
  signal: AbortSignal,
): Promise<MetricMessage[]> {
  const messages: MetricMessage[][] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    signal.throwIfAborted()
    const page = await readPage({ sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) }, { signal })
    signal.throwIfAborted()
    messages.push(projectMessages(page.data))
    cursor = page.cursor.next ?? undefined
    if (cursor && cursors.has(cursor)) throw new Error("OpenCode returned a repeated history cursor")
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return mergeMessages(...messages)
}
