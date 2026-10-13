import type { Vitals } from "./metrics.ts"

type ToolCount = Vitals["tools"][number]
type ToolSubtotal = ToolCount & { children: ToolCount[] }

const byUsage = (left: ToolCount, right: ToolCount) => right.calls - left.calls || left.name.localeCompare(right.name)

/** Presentation policy only: recorded tool names and session accounting stay untouched. */
export function toolBreakdown(tools: readonly ToolCount[]): { label: string; calls: number }[] {
  const groups = new Map<string, ToolSubtotal>()
  const items: (ToolCount | ToolSubtotal)[] = []
  for (const tool of tools) {
    const separator = tool.name.indexOf(".")
    if (separator <= 0 || separator === tool.name.length - 1) {
      items.push(tool)
      continue
    }
    const name = tool.name.slice(0, separator)
    let group = groups.get(name)
    if (!group) {
      group = { name, calls: 0, children: [] }
      groups.set(name, group)
    }
    group.calls += tool.calls
    group.children.push({ name: tool.name.slice(separator + 1), calls: tool.calls })
  }
  items.push(...groups.values())
  return items.toSorted(byUsage).flatMap((item) => {
    if (!("children" in item)) return [{ label: `  ${item.name}`, calls: item.calls }]
    return [
      { label: `  ${item.name} (subtotal)`, calls: item.calls },
      ...item.children.toSorted(byUsage).map((tool) => ({
        label: `    ${tool.name}`,
        calls: tool.calls,
      })),
    ]
  })
}
