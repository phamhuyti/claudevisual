# DualUsage — manual checklist

## Claude only

1. Enable Claude; disable ChatGPT and Cursor in settings.
2. Ensure `claude` is on PATH and signed in.
3. Reload window → status bar shows `Claude 5h … · 7d …`.
4. Sidebar shows only Claude section.
5. Sign out / remove CLI → `sign in` or `cli n/a`.

## ChatGPT only

1. Enable ChatGPT; disable Claude and Cursor.
2. Sign in to `openai.chatgpt` with ChatGPT (not API key).
3. Status bar shows `GPT …`; flexible credits appear when present.
4. Team account: monthly meter from `spend_control`.
5. Logout → `sign in`.

## Cursor only

1. Enable Cursor; disable Claude and ChatGPT.
2. Sign in to the Cursor desktop app (so `state.vscdb` has `cursorAuth/accessToken`).
3. Status bar shows `Cursor $used/$limit (N%)` (and on-demand remaining when present).
4. Sidebar shows plan spend meter; optional on-demand remaining.
5. Sign out of Cursor / delete auth keys → `sign in`.

## All providers

1. Enable Claude, ChatGPT, and Cursor.
2. Three status items (split) or one compact line.
3. Sidebar shows all enabled sections; refresh updates all.
4. Disable one provider → that section/item disappears without breaking the others.

## Persist / history / toggles

1. Reload window with network offline → sidebar shows cached badges until live poll.
2. After ~5+ minutes of usage, provider cards show a sparkline.
3. Command Palette → DualUsage: Toggle Providers → disable one → card disappears.
4. Right-click a provider card → Open Usage Page opens the provider billing/usage URL.
5. Change `dualusage.providers.order` → card order updates after settings change.
