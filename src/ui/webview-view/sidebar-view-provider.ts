import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { SessionStateStore } from "../../core/session-state-store";
import { SessionState } from "../../core/types";
import { HostToSidebarMessage, LimitsViewModel, SidebarToHostMessage, SidebarViewModel } from "./sidebar-messages";
import { toSidebarViewModel } from "./session-view-model";
import { resolveAdvisorConfig } from "../../config/advisor-plan";
import { copyAdvisorTip } from "../advisor-tip-handoff";
import { UsageSnapshot } from "../../core/usage-poller";

/**
 * Sidebar `WebviewView` (replaces the former native TreeView). Registered once
 * for the lifetime of the extension; the underlying `SessionStateStore` is
 * swapped via {@link setStore} whenever `extension.ts` rebuilds it on a
 * workspace-folder change, so the view always reflects the live store without
 * re-registering the provider (which VS Code forbids for a duplicate view id).
 */
export class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "claudevisual.sessions";

  private view: vscode.WebviewView | undefined;
  private storeSub: vscode.Disposable | undefined;
  private lastVm: SidebarViewModel = { sessions: [] };
  /** Latest account-limits header, fed independently of the session store (it
   *  comes from the usage poller, not any workspace folder). Merged into every
   *  posted view-model so it survives session-driven re-renders. */
  private lastLimits: LimitsViewModel | undefined;

  constructor(private readonly extensionPath: string) {}

  /** Feed the newest account-limits snapshot from the usage poller. */
  setLimits(snapshot: UsageSnapshot): void {
    const warnPercent = vscode.workspace
      .getConfiguration("claudevisual.limits")
      .get<number>("warnPercent", 90);
    this.lastLimits = {
      status: snapshot.status,
      fiveHourPercent: snapshot.limits?.fiveHour?.percent,
      sevenDayPercent: snapshot.limits?.sevenDay?.percent,
      fiveHourResets: snapshot.limits?.fiveHour?.resetsLabel,
      sevenDayResets: snapshot.limits?.sevenDay?.resetsLabel,
      warnPercent,
      error: snapshot.error,
    };
    this.post(this.lastVm);
  }

  /** Rebinds to a new store (or clears when no workspace folder is open). */
  setStore(store: SessionStateStore | undefined): void {
    this.storeSub?.dispose();
    if (store) {
      this.storeSub = store.onDidChange((sessions) => this.update(sessions));
      this.update(store.snapshot());
    } else {
      this.update([]);
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, "dist", "webview-view"))],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage((message: SidebarToHostMessage) => {
      if (message?.type === "ready") {
        this.post(this.lastVm);
        return;
      }
      if (message?.type === "advisor-copy") {
        void copyAdvisorTip(message.text);
      }
    });
    // Re-post the latest state whenever the view becomes visible again — a
    // hidden webview is torn down and re-resolved, losing its DOM otherwise.
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.post(this.lastVm);
      }
    });
    // Clear the ref on dispose so a later store change doesn't post to a dead
    // webview (VS Code swallows it, but nulling is tidier than relying on that).
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
    this.post(this.lastVm);
  }

  private update(sessions: readonly SessionState[]): void {
    this.lastVm = toSidebarViewModel(sessions, resolveAdvisorConfig());
    this.post(this.lastVm);
  }

  private post(vm: SidebarViewModel): void {
    // Always carry the latest limits header so a session-driven re-post never
    // blanks it (and vice-versa: setLimits re-posts with the last sessions vm).
    const message: HostToSidebarMessage = { type: "state", vm: { ...vm, limits: this.lastLimits } };
    void this.view?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.file(path.join(this.extensionPath, "dist", "webview-view"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "sidebar.css"));
    const nonce = crypto.randomBytes(16).toString("base64");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>ClaudeVisual Sessions</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.storeSub?.dispose();
  }
}
