import type { Vitals } from "./metrics.ts"

type ToolCount = Vitals["tools"][number]
type ToolSubtotal = ToolCount & { children: ToolCount[] }

const rubydexGroup = { name: "rubydex", prefix: "rubydex.", label: "rubydex (subtotal)" }
const byUsage = (left: ToolCount, right: ToolCount) => right.calls - left.calls || left.name.localeCompare(right.name)

/** Presentation policy only: recorded tool names and session accounting stay untouched. */
export function toolBreakdown(tools: readonly ToolCount[]): { label: string; calls: number }[] {
  const children: ToolCount[] = []
  const items: (ToolCount | ToolSubtotal)[] = []
  for (const tool of tools) {
    if (tool.name.startsWith(rubydexGroup.prefix)) children.push(tool)
    else items.push(tool)
  }
  if (children.length) {
    items.push({
      name: rubydexGroup.name,
      calls: children.reduce((total, tool) => total + tool.calls, 0),
      children,
    })
  }
  return items.toSorted(byUsage).flatMap((item) => {
    if (!("children" in item)) return [{ label: `  ${item.name}`, calls: item.calls }]
    return [
      { label: `  ${rubydexGroup.label}`, calls: item.calls },
      ...item.children.toSorted(byUsage).map((tool) => ({
        label: `    ${tool.name.slice(rubydexGroup.prefix.length)}`,
        calls: tool.calls,
      })),
    ]
  })
}
