import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { AppState, HistoryState, ProviderId } from "../../domain/types";
import { usagePageUrl } from "../../domain/usage-links";
import { readSettings, warnPercentFor } from "../../runtime/settings";

/** Settings the webview needs for meters / credits warn styling. */
export interface WebviewSettings {
  warnPercent: number;
  creditsWarnBalance: number;
  warnPercentByProvider: Record<ProviderId, number>;
  providersOrder: ProviderId[];
  pollIntervalMinutes: number;
  pollIntervalByProvider: Record<ProviderId, number>;
}

type HostToWebview =
  | {
      type: "state";
      state: AppState;
      settings: WebviewSettings;
      history: HistoryState;
    }
  | { type: "settings"; settings: WebviewSettings }
  | { type: "history"; history: HistoryState };

type WebviewToHost =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "refreshProvider"; provider: string }
  | { type: "openSettings" }
  | { type: "openExternal"; url: string }
  | { type: "toggleProvider" }
  | { type: "openUsagePage"; provider: string };

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "dualusage.sidebar";

  private view?: vscode.WebviewView;
  private state: AppState = {};
  private history: HistoryState = { points: [] };
  private ready = false;
  private readonly extensionPath: string;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("dualusage")) {
          this.postSettings();
          this.post();
        }
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, "dist"))],
    };
    webviewView.webview.html = this.html(webviewView.webview);

    const subscription = webviewView.webview.onDidReceiveMessage((msg: WebviewToHost) => {
      if (!msg || typeof msg !== "object") {
        return;
      }
      if (msg.type === "ready") {
        this.ready = true;
        this.post();
        return;
      }
      if (msg.type === "refresh") {
        void vscode.commands.executeCommand("dualusage.refreshAll");
        return;
      }
      if (msg.type === "refreshProvider" && typeof msg.provider === "string") {
        if (msg.provider === "claude") {
          void vscode.commands.executeCommand("dualusage.refreshClaude");
        } else if (msg.provider === "chatgpt") {
          void vscode.commands.executeCommand("dualusage.refreshChatgpt");
        } else if (msg.provider === "cursor") {
          void vscode.commands.executeCommand("dualusage.refreshCursor");
        }
        return;
      }
      if (msg.type === "openSettings") {
        void vscode.commands.executeCommand("dualusage.openSettings");
        return;
      }
      if (msg.type === "toggleProvider") {
        void vscode.commands.executeCommand("dualusage.toggleProvider");
        return;
      }
      if (msg.type === "openUsagePage" && typeof msg.provider === "string") {
        const id = msg.provider as ProviderId;
        if (id === "claude" || id === "chatgpt" || id === "cursor") {
          void vscode.env.openExternal(vscode.Uri.parse(usagePageUrl(id)));
        }
        return;
      }
      if (msg.type === "openExternal" && typeof msg.url === "string") {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    });
    this.disposables.push(subscription);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.ready = false;
      }
    });
  }

  setState(state: AppState): void {
    this.state = state;
    this.post();
  }

  setHistory(history: HistoryState): void {
    this.history = history;
    if (!this.view || !this.ready) {
      return;
    }
    const message: HostToWebview = { type: "history", history };
    void this.view.webview.postMessage(message);
  }

  private webviewSettings(): WebviewSettings {
    const s = readSettings();
    return {
      warnPercent: s.warnPercent,
      creditsWarnBalance: s.creditsWarnBalance,
      warnPercentByProvider: {
        claude: warnPercentFor("claude", s),
        chatgpt: warnPercentFor("chatgpt", s),
        cursor: warnPercentFor("cursor", s),
      },
      providersOrder: s.providersOrder,
      pollIntervalMinutes: s.pollIntervalMinutes,
      pollIntervalByProvider: {
        claude:
          s.claudePollIntervalMinutes > 0 ? s.claudePollIntervalMinutes : s.pollIntervalMinutes,
        chatgpt:
          s.chatgptPollIntervalMinutes > 0 ? s.chatgptPollIntervalMinutes : s.pollIntervalMinutes,
        cursor:
          s.cursorPollIntervalMinutes > 0 ? s.cursorPollIntervalMinutes : s.pollIntervalMinutes,
      },
    };
  }

  private post(): void {
    if (!this.view || !this.ready) {
      return;
    }
    const message: HostToWebview = {
      type: "state",
      state: this.state,
      settings: this.webviewSettings(),
      history: this.history,
    };
    void this.view.webview.postMessage(message);
  }

  private postSettings(): void {
    if (!this.view || !this.ready) {
      return;
    }
    const message: HostToWebview = {
      type: "settings",
      settings: this.webviewSettings(),
    };
    void this.view.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.extensionPath, "dist", "sidebar-main.js"))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.extensionPath, "dist", "sidebar.css"))
    );
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"><div class="muted">Loading…</div></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.view = undefined;
    this.ready = false;
  }
}
