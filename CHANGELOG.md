# Changelog

## [0.3.0] - 2026-10-12

### Changed

- Simplified the prompt footer to turns, model steps, and current context usage. Cumulative total tokens and recorded cost now appear only in the sidebar and the detailed `/vitals` view.
- Kept the footer context-only while the sidebar is visible to avoid repeating sidebar metrics.

### Removed

- Removed the `tokens` and `cost` display options. All metrics are always enabled, and previous option values are ignored.

### Fixed

- Always show recorded session cost in the sidebar and `/vitals`, including `$0.00`.

[0.3.0]: https://github.com/skatkov/opencode-vitals-terminal/releases/tag/v0.3.0
