import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AppState } from "../../domain/types";

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "dualusage.sidebar";

  private view?: vscode.WebviewView;
  private state: AppState = {};
  private readonly extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, "dist"))],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg?.type === "refresh") {
        void vscode.commands.executeCommand("dualusage.refreshAll");
      }
    });
    this.post();
  }

  setState(state: AppState): void {
    this.state = state;
    this.post();
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: "state", state: this.state });
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.extensionPath, "dist", "sidebar-main.js"))
    );
    const cssPath = path.join(this.extensionPath, "src", "ui", "sidebar", "sidebar.css");
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${css}</style>
</head>
<body>
  <div id="root"><div class="muted">Loading…</div></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.view = undefined;
  }
}
