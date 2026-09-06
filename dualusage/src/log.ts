import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
let debugEnabled = false;

export function initLog(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel("DualUsage");
  context.subscriptions.push(channel);
  debugEnabled = vscode.workspace.getConfiguration("dualusage").get<boolean>("debug", false);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("dualusage.debug")) {
        debugEnabled = vscode.workspace.getConfiguration("dualusage").get<boolean>("debug", false);
      }
    })
  );
}

export function logInfo(message: string): void {
  channel?.appendLine(`[info] ${message}`);
}

export function logDebug(message: string): void {
  if (!debugEnabled) {
    return;
  }
  channel?.appendLine(`[debug] ${message}`);
}

export function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err !== undefined ? String(err) : "";
  channel?.appendLine(`[error] ${message}${detail ? `: ${detail}` : ""}`);
  if (debugEnabled && err instanceof Error && err.stack) {
    channel?.appendLine(err.stack);
  }
}
