# Changelog

## Unreleased

### Added

- Sidebar-only tool-call statistics: a session total and exact per-tool counts, sorted by frequency. Includes running, completed, and failed calls, with history backfill, live updates, deduplication, and undo support. The prompt footer and `/vitals` dialog are unchanged.
- Include nested Code Mode invocations from `execute` metadata, so MCP tools such as Rubydex appear under their own names instead of only as `execute`.
- Group dotted sidebar tool names by their namespace under `<namespace> (subtotal)` headings, including Rubydex, POSH, and other tool namespaces. Plain tool names remain separate; individual tool counts are indented beneath their subtotal. Session totals and recorded tool names are unchanged.

## [0.3.0] - 2026-10-12

### Changed

- Simplified the prompt footer to turns, model steps, and current context usage. Cumulative total tokens and recorded cost now appear only in the sidebar and the detailed `/vitals` view.
- Kept the footer context-only while the sidebar is visible to avoid repeating sidebar metrics.

### Removed

- Removed the `tokens` and `cost` display options. All metrics are always enabled, and previous option values are ignored.

### Fixed

- Always show recorded session cost in the sidebar and `/vitals`, including `$0.00`.

[0.3.0]: https://github.com/skatkov/opencode-vitals-terminal/releases/tag/v0.3.0
