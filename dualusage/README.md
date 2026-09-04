# DualUsage

Account usage for **Claude**, **ChatGPT**, and **Cursor** in VS Code — status bar + sidebar.

Greenfield extension: independent provider adapters, shared UI. Does not inject into
Claude Code, the ChatGPT (`openai.chatgpt`) extension, or Cursor itself.

## Requirements

Install and sign in to at least one companion:

| Provider | Sign-in |
| --- | --- |
| Claude | [Claude Code](https://claude.com/product/claude-code) CLI signed in (`claude` on PATH) |
| ChatGPT | [ChatGPT VS Code extension](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt) — **Sign in with ChatGPT** (not API key only) |
| Cursor | [Cursor](https://cursor.com) desktop signed in (reads local `state.vscdb`) |

Credentials are read locally only:

- Claude: via headless `claude -p --no-session-persistence /usage` (uses CLI login)
- ChatGPT: `~/.codex/auth.json` (or `$CODEX_HOME`) + `GET https://chatgpt.com/backend-api/wham/usage`
- Cursor: `state.vscdb` (`cursorAuth/*`) + `POST https://api2.cursor.sh/…/GetCurrentPeriodUsage`

DualUsage never writes credentials and never logs access tokens. For Cursor it may refresh an
access token **in memory** when the JWT is expired (using the refresh token already on disk);
it does not write tokens back to `state.vscdb`.

## What you see

- **Status bar:** `Claude 5h … · 7d …`, `GPT … · $credits · monthly N%`, and/or `Cursor $used/$limit (N%) · $ondemand`
- **Sidebar (DualUsage activity bar):** plan, window meters, flexible / on-demand credits, monthly / plan spend
- Click a status item (or Command Palette) to refresh

### Included usage vs credits vs monthly

1. **Included plan windows** (Claude / ChatGPT rolling 5h / 7d) are used first.
2. **Flexible usage credits** (ChatGPT) or **on-demand remaining** (Cursor) apply after included limits.
3. **Monthly / plan spend** (ChatGPT Team/EDU, or Cursor billing-cycle plan spend) shows a separate meter.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `dualusage.providers.claude.enabled` | `true` | Show Claude |
| `dualusage.providers.chatgpt.enabled` | `true` | Show ChatGPT |
| `dualusage.providers.cursor.enabled` | `true` | Show Cursor |
| `dualusage.pollIntervalMinutes` | `1` | Refresh while window focused (minutes) |
| `dualusage.warnPercent` | `90` | Warning threshold for windows / monthly |
| `dualusage.creditsWarnBalance` | `1` | Warn when flexible / on-demand credits &lt; this USD |
| `dualusage.claudePath` | `""` | Optional `claude` binary path |
| `dualusage.codexHome` | `""` | Optional Codex home |
| `dualusage.cursorDataPath` | `""` | Optional Cursor data root or `state.vscdb` |
| `dualusage.chatgpt.source` | `auto` | `auto` / `api` / `rollout` |
| `dualusage.statusBar.style` | `split` | `split` (per provider) or `compact` |

## Install from a release

Download `dualusage-<version>.vsix` from the
[GitHub Releases](https://github.com/phamhuyti/claudevisual/releases) page, then in VS Code run
**Extensions: Install from VSIX…** (or `code --install-extension dualusage-<version>.vsix`).

Every push to `main` that touches `dualusage/` also uploads a `dualusage-vsix` artifact on the
[DualUsage workflow](https://github.com/phamhuyti/claudevisual/actions/workflows/dualusage.yml)
run, if you want a build that has not been released yet.

## Install from source

```bash
cd dualusage
npm install
npm run compile
npx vsce package --no-dependencies
# then: Extensions: Install from VSIX…
```

```bash
npm test
npm run typecheck
```

## Releasing

Releases are cut by the `DualUsage` GitHub Actions workflow
(`.github/workflows/dualusage.yml`). It typechecks, tests, packages the VSIX, and attaches it to
a GitHub Release with auto-generated notes.

1. Bump `version` in `dualusage/package.json` and merge to `main`.
2. Tag and push — the tag must be `dualusage-v<version>` and match `package.json`, otherwise the
   build fails:

   ```bash
   git tag dualusage-v0.2.0
   git push origin dualusage-v0.2.0
   ```

   Alternatively, run the workflow manually from the Actions tab with **release** checked; the
   tag is created from the current `package.json` version.

Marketplace publishing is opt-in: add a `VSCE_PAT` repository secret (a Marketplace personal
access token for the `phamhuyti` publisher) and the release job will also run `vsce publish` on
tag pushes, or on manual runs with **publish** checked. Without the secret, only the GitHub
Release is created.

## Privacy & limitations

- Local credentials only; no DualUsage cloud backend.
- ChatGPT and Cursor usage endpoints are undocumented product APIs and may change.
- Cursor auth requires a readable local `state.vscdb` (and `sqlite3` or `python3` on PATH to query it).
- OS keyring-only Codex auth (no `auth.json` file) is not supported in v0.1 — open the ChatGPT extension so it writes file auth, or set Codex to file credential store.
- API-key-only OpenAI auth cannot query ChatGPT plan windows; sign in with ChatGPT.

## License

MIT
