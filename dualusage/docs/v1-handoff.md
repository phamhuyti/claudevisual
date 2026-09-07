# DualUsage — road to 1.0 (handoff)

Snapshot taken at **0.4.5** (`main` @ `92b2a70`, 2026-09-07). This document records what is
missing for a 1.0 release, why, and in what order to do it. It is written for whoever picks up the
project next (human or agent); keep it updated as items land — tick the boxes and move the
snapshot forward.

Related: [`README.md`](../README.md) (user docs), [`CHANGELOG.md`](../CHANGELOG.md),
[`manual-checklist.md`](manual-checklist.md), release workflow
[`.github/workflows/dualusage.yml`](../../.github/workflows/dualusage.yml).

## 1. Where the project is

| Area         | State at 0.4.5                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code         | ~5.3k LOC in `src/`, 3 providers (Claude CLI, ChatGPT/Codex WHAM API, Cursor dashboard API), shared status bar + webview sidebar, persistence with a versioned envelope |
| Tests        | 82 unit tests (mocha, `vscode` stubbed) on Ubuntu only; no integration test, no webview render test, no Windows/macOS run                                               |
| CI / release | Lint, format, typecheck, test, `vsce package`; tag `dualusage-v<version>` → GitHub Release with VSIX. All actions on Node 24 runtimes                                   |
| Distribution | **Not on the VS Code Marketplace, not on Open VSX.** Only the VSIX attached to GitHub Releases. `vsce publish` step exists but is skipped (no `VSCE_PAT`)               |
| Support      | `bugs.url` points at GitHub Issues, but **Issues are disabled** on `phamhuyti/claudevisual`                                                                             |
| Repo         | Monorepo that still contains the legacy ClaudeVisual 0.1.0 extension at the root (root `ci.yml` builds it); the repo name does not match the product                    |
| Manifest     | No `extensionKind`, no `capabilities` (`untrustedWorkspaces`, `virtualWorkspaces`)                                                                                      |
| Docs         | README settings table lists 13 of the 25 live settings (29 declared, 4 deprecated); no troubleshooting / FAQ / privacy section                                          |
| i18n         | `package.nls.json` + `package.nls.vi.json` for the manifest only; every runtime string (status bar, tooltips, webview) is hard-coded English                            |

## 2. What 1.0 promises

1.0 is a stability contract, not a feature milestone:

- Setting keys, command IDs, and the persisted-state envelope do not change within 1.x (only
  additive changes; deprecations get a full minor cycle with migration).
- The extension is installable from the marketplace each target audience actually uses
  (VS Code Marketplace **and** Open VSX — Cursor's extension gallery is Open VSX).
- Every provider degrades honestly: when an upstream API/CLI changes shape, the user sees an error
  with a link to report it, never wrong numbers.
- There is a support channel and a way to produce a redacted diagnostics bundle.
- Behaviour is verified on Windows, macOS, and Linux, and in Remote / Restricted Mode.

## 3. Blockers (must land before 1.0)

### 3.1 Distribution

- [ ] **Open VSX** (required, not optional). Cursor uses Open VSX for third-party extensions and
      mirrors it through its own proxy with security scanning
      ([Cursor docs](https://cursor.com/help/customization/extensions)). Create the `phamhuyti`
      namespace, generate a token → repository secret `OVSX_PAT`, add an `ovsx publish` step next to
      `vsce publish` in the release job
      ([publishing guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)).
- [ ] **VS Code Marketplace**. Publisher `phamhuyti` needs an Azure DevOps PAT (scope
      _Marketplace › Manage_) → secret `VSCE_PAT`; the workflow already publishes on tag pushes
      when the secret is set
      ([publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
- [ ] Keep `engines.vscode` **at or below** the VS Code version Cursor is built on (currently
      `^1.90.0`, fine). Cursor's gallery filters out extensions whose engine is newer than its base
      ([forum thread](https://forum.cursor.com/t/my-extension-not-searchable-in-cursor-marketplace-published-verified-on-open-vsx/165455)).
      Do not raise it for `node:sqlite`; the CLI fallback covers older builds.
- [ ] Listing metadata: `galleryBanner`, `qna`, `pricing: "Free"`, refreshed screenshots for the
      current UI. Optionally request Cursor's _Verified_ badge (needs a homepage that links to the
      Open VSX listing, then a post in the forum's Extension Verification category).
- [ ] Decide where DualUsage lives (see §6): enable Issues here, or move to `phamhuyti/dualusage`.

### 3.2 Manifest hardening (`package.json`)

- [ ] `"extensionKind": ["ui", "workspace"]`. Without it an extension with `main` defaults to
      running on the **remote** side in Remote SSH / WSL / Dev Containers — where `state.vscdb`,
      `~/.codex/auth.json`, and the `claude` CLI usually do not exist, so all three providers show
      "sign in". The data lives on the local machine; prefer `ui`
      ([Remote extensions guide](https://code.visualstudio.com/api/advanced-topics/remote-extensions)).
- [ ] `"capabilities": { "untrustedWorkspaces": { "supported": true } }`. Undeclared → the
      extension is **disabled in Restricted Mode**. It reads only user-level data and the path
      settings are already `machine`-scoped, so `true` is correct
      ([Workspace Trust guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)).
- [ ] `"capabilities": { "virtualWorkspaces": true }` — nothing depends on workspace files
      ([Virtual Workspaces guide](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)).

### 3.3 Support channel and diagnostics

- [ ] Enable GitHub Issues (or point `bugs.url` at the new repo) and add issue templates:
      _bug_, _provider data looks wrong / schema changed_, _feature_.
- [ ] Command **DualUsage: Copy Diagnostics** — extension version, OS, VS Code/Cursor version,
      per-provider status + last error, which `state.vscdb` reader was used (`node:sqlite` /
      `sqlite3` / `python3`), effective poll intervals. Tokens, emails, and paths under `$HOME`
      redacted. This is what makes upstream-API-change reports actionable.

### 3.4 Provider reliability (largest risk)

All three data sources are unofficial. Add one shared behaviour first: when a response/CLI output
fails to parse, publish `status: "error"` with a stable message ("<provider> data format changed —
report at <issues url>") and keep the last good numbers, instead of rendering partial or zero
values.

**Claude**

- [ ] Today: spawn `claude -p --no-session-persistence /usage` every poll; the code itself notes it
      flakes about one run in three and retries (`src/providers/claude/cli-usage.ts`).
- [ ] Alternative: `GET https://api.anthropic.com/api/oauth/usage` — the endpoint `/usage` calls
      internally. Returns `five_hour` / `seven_day` / `seven_day_opus` with `utilization` (%) and
      `resets_at`. **Undocumented**, Pro/Max only, and aggressively rate-limited unless the request
      carries `User-Agent: claude-code/<version>` plus `anthropic-beta: oauth-2025-04-20`
      ([claude-code#30930](https://github.com/anthropics/claude-code/issues/30930),
      [claude-code#31637](https://github.com/anthropics/claude-code/issues/31637)). Token comes from
      `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) on Linux/Windows, or the macOS
      Keychain item `Claude Code-credentials`. Do **not** write that file back.
- [ ] Proposed shape: direct API as primary (no process spawn, no flake), CLI as fallback, both
      behind the parse-failure guard above. Needs the owner's OK on relying on an undocumented
      endpoint (§6). Anthropic has open feature requests for an official endpoint; re-check before
      building.

**ChatGPT / Codex**

- [ ] Verified in Codex source (`codex-rs/config/src/types.rs`, `AuthCredentialsStoreMode`): the
      default credential store is still **`File`** (`auth.json`); `keyring` / `auto` are opt-in.
      The current `auth.json`-only reader (`src/providers/chatgpt/auth.ts`) therefore covers the
      default install. Add keyring support for users who opted in: macOS Keychain service
      `Codex Auth`, Windows Credential Manager, Linux Secret Service
      ([Codex auth docs](https://developers.openai.com/codex/auth)).
- [ ] Decode the access token's `exp` before calling WHAM. Today an expired token costs a 401 round
      trip and yields "sign in again", which is misleading — Codex refreshes tokens itself when it
      runs. Message should be "open Codex / the ChatGPT extension so it refreshes the session".
      Do **not** refresh from DualUsage: it would have to write `auth.json` back.

**Cursor**

- [ ] `src/providers/cursor/adapter.ts` already prefers Cursor's own unexpired token, then the
      in-memory cache, and only then calls the OAuth refresh endpoint. **Verify on a real account**
      whether that endpoint rotates and invalidates the previous refresh token; if it does, a
      DualUsage refresh can log the Cursor desktop app out. In that case never refresh — only read
      tokens Cursor wrote.
- [ ] Both dashboard endpoints (`GetCurrentPeriodUsage`, plan info) are undocumented; keep the
      recorded fixtures under `test/fixtures/cursor-*.json` current and put them behind the
      parse-failure guard.

**Verification**

- [ ] `npm run smoke -- --provider <id>`: a manual script that runs one adapter against the real
      local credentials and prints the parsed snapshot (redacted). CI cannot do this; make it a
      release-checklist step.

### 3.5 Tests and CI

- [ ] OS matrix (`ubuntu`, `windows`, `macos`) for the unit suite. The Windows executable
      resolution and `cmd.exe` escaping in `cli-usage.ts` are only tested through logic today.
- [ ] `@vscode/test-electron` smoke: activation, every `contributes.commands` entry registered,
      view registered, no errors in Restricted Mode, clean deactivate.
- [ ] Webview render test (jsdom or Playwright) for `src/ui/sidebar/webview-main.ts`. The 0.4.3
      regression (CSP blocking inline `style=""`, meters disappeared) is exactly the class of bug
      unit tests cannot catch.
- [ ] Refresh `manual-checklist.md` for the current UI and run it on all three OSes before the RC.

### 3.6 Docs and the stability contract

- [ ] README: complete settings table (25 live keys), **Troubleshooting** (sign-in states,
      `state.vscdb` unreadable, Remote/WSL behaviour, Restricted Mode), **Privacy** (per-provider
      data flow, no telemetry, nothing written back).
- [ ] Freeze setting keys and command IDs. At 1.0 drop the four deprecated
      `*.pollIntervalMinutes` declarations but **keep** `migrateLegacySettings()` through 1.x.
- [ ] State a short semver policy in README/CHANGELOG (what counts as breaking for an extension:
      renamed/removed settings or commands, persisted-state envelope changes).

## 4. Worth doing, not blocking

- Localisation done properly or not at all: either add `vscode.l10n` + a webview string bundle and
  finish `vi`, or drop `package.nls.vi.json`. Half-translated UI is worse than English.
- `createOutputChannel("DualUsage", { log: true })` (LogOutputChannel) so users pick the log level
  from the Output panel instead of the `dualusage.debug` setting.
- Accessibility pass on the webview with a screen reader (focus order, live regions).
- Measure activation time on a slow machine (already `onStartupFinished`, ~50 KB bundle — expected
  fine, but record the number).
- Keep the `ProviderAdapter` contract generic enough that a fourth provider (Gemini CLI, Copilot
  premium requests) needs no UI changes.

## 5. Suggested sequence

| Release      | Scope                                                                                                                                  | Notes                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **0.5**      | §3.1 distribution, §3.2 manifest, §3.3 Issues + diagnostics, README troubleshooting/privacy                                            | Config/manifest only; low risk. Needs the two secrets from §6   |
| **0.6**      | §3.4: parse-failure guard, Claude direct API + CLI fallback, Codex keyring + `exp` check, Cursor rotation verification, `smoke` script | Highest-risk work; ship behind settings where behaviour changes |
| **0.7**      | §3.5 test matrix + integration + webview tests; l10n decision executed                                                                 |                                                                 |
| **1.0.0-rc** | Freeze settings/commands, drop deprecated declarations, full manual checklist on 3 OSes with real accounts                             | Publish as pre-release on both marketplaces                     |
| **1.0.0**    | Contract in §2 holds                                                                                                                   |                                                                 |

No calendar estimates on purpose; each row is scoped by the subsystems it touches.

## 6. Decisions only the owner can make

1. **Publisher accounts**: create `VSCE_PAT` (Azure DevOps, Marketplace › Manage) and `OVSX_PAT`
   (open-vsx.org namespace `phamhuyti`) and add them as repository secrets.
2. **Repo**: enable Issues on `claudevisual`, or move DualUsage to its own repo
   (`phamhuyti/dualusage`). Moving gives a clean listing URL and separates it from the legacy
   ClaudeVisual extension; it also means updating `repository`, `bugs`, `homepage`, and the
   absolute image URLs in README.
3. **Claude data source**: accept the undocumented `api.anthropic.com/api/oauth/usage` endpoint
   (with CLI fallback), or stay CLI-only and live with the flake/retry cost.
4. **Vietnamese localisation**: finish it or remove it.
5. **Telemetry**: recommendation is none, stated explicitly in the Privacy section.

## 7. Facts verified for this document

| Claim                                                        | Source                                                                                                                       | Checked    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Cursor's extension gallery is Open VSX behind a proxy        | [cursor.com/help/customization/extensions](https://cursor.com/help/customization/extensions)                                 | 2026-09-06 |
| Codex default credential store is `File` (`auth.json`)       | [`codex-rs/config/src/types.rs`](https://github.com/openai/codex/blob/main/codex-rs/config/src/types.rs) — `#[default] File` | 2026-09-06 |
| `/api/oauth/usage` exists, is undocumented, UA-bucketed 429s | [anthropics/claude-code#30930](https://github.com/anthropics/claude-code/issues/30930)                                       | 2026-09-06 |
| Extension not on Marketplace / Open VSX                      | `npx @vscode/vsce show phamhuyti.dualusage` → not found; `open-vsx.org/api/phamhuyti/dualusage` → 404                        | 2026-09-06 |
| Issues disabled on the repo                                  | `gh issue list` → "repository has disabled issues"                                                                           | 2026-09-06 |
| Workflow actions on Node 24 runtimes, zero annotations       | Release run for `dualusage-v0.4.5`                                                                                           | 2026-09-06 |
