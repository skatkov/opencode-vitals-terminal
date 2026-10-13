import type { SessionMessageAssistant } from "@opencode/client"

/** Unique call identities within one assistant message, retaining only tool names. */
export type ToolCalls = Readonly<Record<string, string>>

function callIdentity(id: string, traceIndex: number | null): string {
  // Tuple encoding keeps arbitrary top-level IDs distinct from nested indexes.
  return JSON.stringify([id, traceIndex])
}

export function projectToolCalls(content: readonly SessionMessageAssistant["content"][number][]): ToolCalls {
  const tools: Record<string, string> = {}
  for (const part of content) {
    if (part.type !== "tool" || part.state.status === "streaming") continue
    tools[callIdentity(part.id, null)] = part.name
    const calls = part.name === "execute" ? part.state.metadata?.toolCalls : undefined
    if (!Array.isArray(calls)) continue
    // Code Mode's trace has no call IDs. Preserve its append-only indexes even
    // when malformed records are skipped, without keeping inputs or outputs.
    calls.forEach((call, index) => {
      if (typeof call !== "object" || call === null || !("tool" in call) || typeof call.tool !== "string" || !call.tool) return
      tools[callIdentity(part.id, index)] = call.tool
    })
  }
  return tools
}
