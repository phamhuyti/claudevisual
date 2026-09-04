# DualUsage

Account usage for **Claude** and **ChatGPT** in VS Code — status bar + sidebar.

Greenfield extension: independent provider adapters, shared UI. Does not inject into
Claude Code or the ChatGPT (`openai.chatgpt`) extension.

## Requirements

Install and sign in to at least one companion:

| Provider | Sign-in |
| --- | --- |
| Claude | [Claude Code](https://claude.com/product/claude-code) CLI signed in (`claude` on PATH) |
| ChatGPT | [ChatGPT VS Code extension](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt) — **Sign in with ChatGPT** (not API key only) |

Credentials are read locally only:

- Claude: via headless `claude -p --no-session-persistence /usage` (uses CLI login)
- ChatGPT: `~/.codex/auth.json` (or `$CODEX_HOME`) + `GET https://chatgpt.com/backend-api/wham/usage`

DualUsage never writes credentials, never logs access tokens, and does not refresh OAuth.

## What you see

- **Status bar:** `Claude 5h … · 7d …` and/or `GPT 5h … · 7d … · $credits · monthly N%`
- **Sidebar (DualUsage activity bar):** plan, window meters, flexible usage credits, monthly Team/EDU spend
- Click a status item (or Command Palette) to refresh

### Included usage vs credits vs monthly

1. **Included plan windows** (rolling 5h / 7d, durations labeled from the payload) are used first.
2. **Flexible usage credits** (personal Plus/Pro purchases) apply after included limits — shown as `$balance` or `credits ∞`.
3. **Monthly spend** (Team `spend_control.individual_limit`, or EDU/Enterprise via a monthly-usage fallback API) shows a separate monthly meter.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `dualusage.providers.claude.enabled` | `true` | Show Claude |
| `dualusage.providers.chatgpt.enabled` | `true` | Show ChatGPT |
| `dualusage.pollIntervalMinutes` | `1` | Refresh while window focused (minutes) |
| `dualusage.warnPercent` | `90` | Warning threshold for windows / monthly |
| `dualusage.creditsWarnBalance` | `1` | Warn when flexible credits &lt; this USD |
| `dualusage.claudePath` | `""` | Optional `claude` binary path |
| `dualusage.codexHome` | `""` | Optional Codex home |
| `dualusage.chatgpt.source` | `auto` | `auto` / `api` / `rollout` |
| `dualusage.statusBar.style` | `split` | `split` (two items) or `compact` |

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

## Privacy & limitations

- Local credentials only; no DualUsage cloud backend.
- ChatGPT usage endpoints are undocumented product APIs and may change.
- OS keyring-only Codex auth (no `auth.json` file) is not supported in v0.1 — open the ChatGPT extension so it writes file auth, or set Codex to file credential store.
- API-key-only OpenAI auth cannot query ChatGPT plan windows; sign in with ChatGPT.

## License

MIT
