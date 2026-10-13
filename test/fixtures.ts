import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo, TokenUsageInfo } from "@opencode/client"
import { calculateVitals, projectMessages } from "../src/metrics.ts"

export const usage: TokenUsageInfo = { input: 100, output: 20, reasoning: 10, cache: { read: 50, write: 5 } }

export function user(id = "msg_001"): SessionMessageInfo {
  return { id, type: "user", text: "A prompt that must not be retained", time: { created: 1 } }
}

export function assistant(id = "msg_002", changes: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "model" },
    content: [{ type: "text", text: "A response that must not be retained" }],
    time: { created: 2, completed: 3 },
    tokens: { ...usage, cache: { ...usage.cache } },
    ...changes,
  }
}

export function tool(id: string, name: string, changes: Partial<SessionMessageAssistantTool> = {}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id,
    name,
    state: { status: "running", input: {}, metadata: {} },
    time: { created: 2, ran: 3 },
    ...changes,
  }
}

export function sampleVitals() {
  return calculateVitals(projectMessages([user(), assistant()]))
}
