# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Account-wide rate limits (5-hour and 7-day usage %) in both a dedicated status-bar item
  and a header pinned above the sidebar session list, fetched by running the official
  `claude -p /usage` headlessly on an interval — no credential handling. Polls only while
  the window is focused (default every 5 min), turns a warning color past
  `claudevisual.limits.warnPercent`, and offers a `ClaudeVisual: Refresh Account Limits`
  command. Configurable via `claudevisual.limits.*` (`enabled`, `pollIntervalMinutes`,
  `warnPercent`, `claudePath`).
- Efficiency Advisor rule thresholds (context warn/crit %, cache churn ratio, cache
  low-reuse floor, expensive sub-agent cap, model right-sizing gates, cost-projection
  burn floor, frequent-compaction count) are now configurable via
  `claudevisual.advisor.thresholds.*` settings instead of hardcoded constants.
- Gear icon button in the Sessions sidebar's title bar, opening VS Code Settings
  pre-filtered to ClaudeVisual's own settings.

## [0.1.0] — 2026-07-11

First public release: source-available on GitHub and submitted to the VS Code Marketplace.

### Added
- Sidebar redesigned from a flat native `TreeView` into a `WebviewView`: agent tree with
  parent→child nesting, per-agent model/tokens/duration, token + cache economics, an
  activity heartbeat, a tool-call feed, and a files-touched panel.
- Token burn-rate (`~NK/min`) sampled on a bounded ring, shown in vitals; `—` before the
  second sample or once a session goes idle.
- Honest `N calls` progress chip on running agents — no fabricated percentage.
- Sidebar sessions now collapse to their vitals row by default regardless of live status
  (previously a live session auto-expanded), with an explicit "View detail"/"Hide detail"
  toggle button in place of the implicit chevron. An expanded session gets an accent-colored
  frame and its vitals header stays pinned (`position: sticky`) while scrolling its own body,
  so it stays visually distinct from collapsed siblings.
- Efficiency Advisor grade badge and a severity-tinted left border on the vitals row, so a
  low-scoring session stands out in the (collapsed) list without opening its detail.

### Fixed
- Sub-agent detection matched the wrong tool_use name (`Task`) — real transcripts name the
  spawn tool `Agent`; every sub-agent row, and everything built on top of it, was silently
  never populating.
- Sub-agent identity/nesting was keyed off the spawning tool_use's `id`, which is not the
  child's real agentId in real transcripts — every real spawn produced two split ghost rows
  (one correctly typed with 0 tokens, one with real tokens stuck at type `"unknown"`), and
  nesting never linked. Re-keyed around each sub-agent's `agent-<agentId>.meta.json` sidecar
  (`agentType`, `description`, `parentAgentId`, `toolUseId`), which is the actual source of
  truth; re-verified end-to-end against real transcripts. See
  `plans/20260710-2005-sidebar-orchestration-webview/phase-04-nesting-extras.md`.

## [0.0.1] — 2026-07-10

Initial implementation, all 7 planned phases.

### Added
- JSONL-tailing baseline: session state (model, tokens, context%, permission mode) parsed
  live from Claude Code's own transcript files. Status bar display.
- Sidebar TreeView: per-session hierarchy of sub-agents, skills invoked, and recent tool
  calls. Sessions keyed by `sessionId`, so concurrent same-cwd sessions render as siblings.
- Opt-in hooks (`ClaudeVisual: Install/Uninstall Hooks`): low-latency running-indicator via
  a dedicated NDJSON event log, safely appended to `settings.json`'s hook arrays.
- Opt-in StatusLine wrap (`ClaudeVisual: Wrap/Preview/Restore StatusLine`): precise
  context%/cost numbers, wrapping (never overwriting) an existing `statusLine` command.
- Dashboard webview (`ClaudeVisual: Open Dashboard`): hand-rolled charts fed by incremental
  diffs, dual-scope (global/project) config-editing form with diff/confirm + Undo.
- Unit test suite (84 tests) covering transcript parsing, state reduction, project-hash
  mapping, and the settings.json safe-write path; manual live/E2E checklist for the
  hook/statusline/config paths.
- `.vsix` packaging via `@vscode/vsce`; local build/deploy workflow (`npm run reinstall`).

### Fixed
- Concurrent writes to `settings.json` could race and silently drop a change — writes are
  now serialized per file path.
- Undo could delete a user's entire `settings.json` instead of reverting one field when no
  prior backup existed — now scoped to the specific key, with a hash guard that refuses
  rather than clobbers if other writes landed since.
- Hook/statusline commands baked in a version-specific extension path that broke after every
  VS Code auto-update — matching is now version-independent.
- The JSONL tailer could do an unbounded full-file read on a resumed older session's first
  live touch — now tail-primes consistently with activation-time behavior.
- Sub-agent file watchers leaked indefinitely — now disposed when a session drops out of the
  known-session set.
