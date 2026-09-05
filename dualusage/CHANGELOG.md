# Changelog

All notable changes to DualUsage are documented in this file.

## [0.4.3] — 2026-09-05

### Changed

- Claude, ChatGPT, and Cursor providers are **disabled by default**. Enable the ones you use via Settings or **DualUsage: Toggle Providers**.

## [0.4.2] — 2026-09-05

### Changed

- Poll / refresh interval is now configured in **seconds** (`dualusage.pollIntervalSeconds`, default `60`, minimum `5`) instead of minutes. Legacy `pollIntervalMinutes` values are still read and converted ×60.

## [0.4.1] — 2026-09-05

### Changed

- Cursor plan usage now shows **remaining** dollars (e.g. `$0 left`) in the status bar, tooltip, and sidebar instead of `$used/$limit`.

## [0.4.0]

### Fixed

- Dispose webview message listeners when the sidebar view is disposed (no stacked handlers).
- Context-menu **Open Usage Page** uses the right-clicked provider (via contextProvider handshake).
- Open Settings filter uses the correct publisher id.

### Added

- Unit tests for orchestrator refresh queue, status bar backgrounds, and format/render helpers (40 tests).
- README light/dark sidebar preview images.
- Minimal Vietnamese `package.nls.vi.json` for core command/view strings.

 — 2026-09-05

### Added

- Persist last AppState in `globalState` so status bar / sidebar show cached numbers immediately on startup.
- Usage history ring (≈1 sample / 5 minutes, ~48h) with sparkline in provider cards.
- Stale / cached badges; per-provider `pollIntervalMinutes` and `warnPercent`; `providers.order`.
- `dualusage.toggleProvider` QuickPick + webview context menu; deep links to each provider usage page.
- ESLint, Prettier, EditorConfig, Dependabot; marketplace icon/banner/categories; onboarding walkthrough.
- Unit tests for persistence, threshold notifier, and cached orchestrator hydrate.
- Root README marks ClaudeVisual as legacy in favor of DualUsage; ChatGPTVisual plan marked superseded.

## [0.3.0] — 2026-09-05

### Added

- Redesigned sidebar with design tokens, provider cards, ring gauge for the primary window, secondary meters with pace markers, live countdown, collapse state, skeleton/empty/error CTAs, and accessibility roles.
- Status-bar styles: `split`, `compact`, and `ultra`; per-field visibility for windows / credits / monthly; configurable click action (`refresh` | `openSidebar` | `openSettings`).
- Trusted Markdown tooltips with unicode bars, countdown, and command links.
- Provider-specific status-bar codicons; error background when a limit is hit; warning background at warn threshold.
- Threshold notifications (toast once per threshold crossing) via `dualusage.notifications.*`.
- View title actions for Refresh All and Open Settings; `dualusage.focusSidebar` command.
- Activity-bar gauge icon.

### Fixed

- Packaged VSIX now includes `dist/sidebar.css` (sidebar was blank when installed from Marketplace/VSIX).
- Sidebar warn colors now respect `dualusage.warnPercent` (settings posted to the webview).
- Claude `/usage` retries up to 3 times (~8s apart) to reduce flaky signed-out / stale readings.
- Manual refresh queues while a poll is in flight; fetches use `AbortController` on dispose/restart.
- Webview ready handshake so the first state is not lost (no stuck “Loading…”).
- Message listener disposal and cryptographically random CSP nonces.

## [0.2.1] — 2026-09-05

### Fixed

- CSS packaging, ready handshake, Claude CLI retries, refresh queue + abort, webview typecheck (`tsconfig.webview.json`), settings posted to webview.

## [0.2.0] — prior

- Multi-provider usage (Claude, ChatGPT, Cursor) in status bar and sidebar.
