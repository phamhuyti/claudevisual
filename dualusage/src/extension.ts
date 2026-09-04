import * as vscode from "vscode";
import { initLog, logInfo } from "./log";
import { UsageOrchestrator } from "./runtime/orchestrator";
import { SidebarProvider } from "./ui/sidebar/sidebar-provider";
import { StatusBarController } from "./ui/status-bar";

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  logInfo("DualUsage activating");

  const orchestrator = new UsageOrchestrator();
  const statusBar = new StatusBarController();
  const sidebar = new SidebarProvider(context.extensionPath);

  context.subscriptions.push(
    orchestrator,
    statusBar,
    sidebar,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    orchestrator.onDidChange((state) => {
      statusBar.render(state);
      sidebar.setState(state);
    }),
    vscode.commands.registerCommand("dualusage.refreshAll", () => orchestrator.refreshAll()),
    vscode.commands.registerCommand("dualusage.refreshClaude", () => orchestrator.refreshProvider("claude")),
    vscode.commands.registerCommand("dualusage.refreshChatgpt", () => orchestrator.refreshProvider("chatgpt"))
  );

  statusBar.render(orchestrator.current);
  orchestrator.start();
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
