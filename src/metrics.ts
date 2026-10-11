import type { ModelInfo, SessionMessageInfo, TokenUsageInfo } from "@opencode/client"

/** Only retain counts/usage metadata, never prompt text, tool output, or files. */
export type MetricMessage = {
  id: string
  type: SessionMessageInfo["type"]
  completed?: number
  tokens?: TokenUsageInfo
  model?: { providerID: string; id: string }
  compactionCompleted?: boolean
}

export type Vitals = {
  turns: number
  steps: number
  completedSteps: number
  tokens: TokenUsageInfo
  totalTokens: number
  context?: { tokens: number; percent?: number }
}

export function tokenTotal(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function projectMessages(messages: readonly SessionMessageInfo[]): MetricMessage[] {
  return messages.map((message) => ({
    id: message.id,
    type: message.type,
    ...(message.type === "assistant"
      ? {
          completed: message.time.completed,
          tokens: message.tokens && {
            ...message.tokens,
            cache: { ...message.tokens.cache },
          },
          model: { providerID: message.model.providerID, id: message.model.id },
        }
      : {}),
    ...(message.type === "compaction" ? { compactionCompleted: message.status === "completed" } : {}),
  }))
}

export function mergeMessages(...groups: readonly (readonly MetricMessage[])[]): MetricMessage[] {
  const messages = new Map<string, MetricMessage>()
  for (const group of groups) {
    for (const message of group) {
      const previous = messages.get(message.id)
      // A stale/streaming TUI snapshot must not erase finalized provider usage.
      messages.set(message.id, {
        ...previous,
        ...message,
        completed: message.completed ?? previous?.completed,
        tokens: message.tokens ?? previous?.tokens,
      })
    }
  }
  // Match the sortable-ID comparisons OpenCode uses for undo boundaries.
  return [...messages.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function calculateVitals(
  messages: readonly MetricMessage[],
  models: readonly Pick<ModelInfo, "id" | "providerID" | "limit">[] = [],
  boundary?: string,
): Vitals {
  const visible = boundary ? messages.filter((message) => message.id < boundary) : messages
  const tokens: TokenUsageInfo = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  let turns = 0
  let steps = 0
  let completedSteps = 0
  let lastUsage: MetricMessage | undefined

  for (const message of visible) {
    if (message.type === "user") turns++
    if (message.type === "compaction" && message.compactionCompleted) lastUsage = undefined
    if (message.type !== "assistant") continue
    steps++
    if (message.completed !== undefined) completedSteps++
    if (!message.tokens) continue
    tokens.input += message.tokens.input
    tokens.output += message.tokens.output
    tokens.reasoning += message.tokens.reasoning
    tokens.cache.read += message.tokens.cache.read
    tokens.cache.write += message.tokens.cache.write
    lastUsage = message
  }

  const contextTokens = lastUsage?.tokens && tokenTotal(lastUsage.tokens)
  const selectedModel = lastUsage?.model
  const model = selectedModel && models.find(
    (model) => model.providerID === selectedModel.providerID && model.id === selectedModel.id,
  )
  return {
    turns,
    steps,
    completedSteps,
    tokens,
    totalTokens: tokenTotal(tokens),
    context: contextTokens && contextTokens > 0
      ? {
          tokens: contextTokens,
          percent: model?.limit.context ? Math.round(contextTokens / model.limit.context * 100) : undefined,
        }
      : undefined,
  }
}
