# Changelog

All notable changes to DualUsage are documented in this file.

## [0.4.4] — 2026-09-06

### Security

- `dualusage.claudePath`, `dualusage.codexHome`, and `dualusage.cursorDataPath` are now `machine`-scoped: they can only be set in user/remote settings, never by a workspace's `.vscode/settings.json`.
- The Claude CLI is no longer launched through a shell on Windows. The executable is resolved via `PATH`/`PATHEXT`; only `.cmd`/`.bat` shims go through `cmd.exe`, with every metacharacter escaped.

### Fixed

- **Sidebar meters, pace markers, and skeleton bars render again.** The webview CSP blocks inline `style=""` attributes; sizes are now applied via the CSSOM.
- **Open Usage Page** from a card's right-click menu opened `file:///undefined`; the command now accepts the webview context object VS Code forwards (the `contextProvider` round-trip was removed).
- Onboarding walkthrough registers again (steps used an invalid `media.icon` key) and the "enable providers" step completes for any provider, not just Claude.
- Data-less states (`signed out`, `cli missing`, …) no longer flicker to `…` on every poll; a `refreshing` flag drives the spinner instead.
- A failed refresh that keeps the previous numbers now shows the error in the status-bar tooltip and on the card.
- A forced **Refresh All** queued behind an in-flight poll is no longer replaced by a later single-provider refresh.
- Stale badges are re-evaluated while the window is unfocused; the status-bar tooltip shows data age and cached/stale flags.
- Non-numeric setting values fall back to defaults instead of producing `NaN` intervals (which made the poll timer spin at 1 ms).
- Per-provider `pollIntervalSeconds` is clamped to the 5 s minimum like the global value.
- Threshold toasts honour per-provider `warnPercent`, are not re-fired for cached numbers on every window reload, use ±5 % hysteresis, and key rate windows by duration instead of array position.
- Status-bar warning background uses the per-provider `warnPercent`.
- History no longer re-samples a snapshot whose refresh failed (flat-lined sparklines); retention uses the injected clock.
- Persisted state is versioned, validated on load (unknown statuses / malformed windows dropped), written only when changed, and no longer includes the account email.
- Tooltip unicode bars are only full at 100 % (95–99 % previously looked complete); sub-hour windows show minutes; `$0.40 left` instead of `$0 left`; a bare `$` balance is not treated as `$0`.
- ChatGPT usage deep link points at `chatgpt.com/codex/settings/usage`.
- README screenshots use absolute URLs so they render on the Marketplace page.

### Changed

- Providers are fetched and published independently: a slow Claude CLI run no longer withholds fresh ChatGPT/Cursor numbers, and settings changes only restart polling when a polling-related key changed.
- Cursor: `state.vscdb` is read asynchronously via Node's built-in `node:sqlite` (VS Code ≥ 1.102) before falling back to the `sqlite3`/`python3` CLIs; an unreadable database is reported as an error instead of "signed out". Minted access tokens are cached until they expire, and a rotated refresh token is honoured, instead of refreshing on every poll.
- Legacy `*.pollIntervalMinutes` values are migrated once on activation (written as seconds, legacy key removed) and are declared as deprecated settings so they no longer show as "Unknown Configuration Setting".
- CI runs `lint` and `format:check`.

## [0.4.3] — 2026-09-05

### Changed

- Claude, ChatGPT, and Cursor providers are **disabled by default**. Enable the ones you use via Settings or **DualUsage: Toggle Providers**.

## [0.4.2] — 2026-09-05

### Changed

- Poll / refresh interval is now configured in **seconds** (`dualusage.pollIntervalSeconds`, default `60`, minimum `5`) instead of minutes. Legacy `pollIntervalMinutes` values are still read and converted ×60.

## [0.4.1] — 2026-09-05

### Changed

- Cursor plan usage now shows **remaining** dollars (e.g. `$0 left`) in the status bar, tooltip, and sidebar instead of `$used/$limit`.

## [0.4.0] — 2026-09-05

### Fixed

- Dispose webview message listeners when the sidebar view is disposed (no stacked handlers).
- Context-menu **Open Usage Page** uses the right-clicked provider (via contextProvider handshake).
- Open Settings filter uses the correct publisher id.

### Added

- Unit tests for orchestrator refresh queue, status bar backgrounds, and format/render helpers (40 tests).
- README light/dark sidebar preview images.
- Minimal Vietnamese `package.nls.vi.json` for core command/view strings.
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
