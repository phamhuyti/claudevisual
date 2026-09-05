import * as vscode from "vscode";
import { initLog, logInfo } from "./log";
import { UsageOrchestrator } from "./runtime/orchestrator";
import { ThresholdNotifier } from "./runtime/threshold-notifier";
import { SidebarProvider } from "./ui/sidebar/sidebar-provider";
import { StatusBarController } from "./ui/status-bar";

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  logInfo("DualUsage activating");

  const orchestrator = new UsageOrchestrator();
  const statusBar = new StatusBarController();
  const sidebar = new SidebarProvider(context.extensionPath);
  const notifier = new ThresholdNotifier();

  context.subscriptions.push(
    orchestrator,
    statusBar,
    sidebar,
    notifier,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    orchestrator.onDidChange((state) => {
      statusBar.render(state);
      sidebar.setState(state);
      notifier.update(state);
    }),
    vscode.commands.registerCommand("dualusage.refreshAll", () => orchestrator.refreshAll()),
    vscode.commands.registerCommand("dualusage.refreshClaude", () =>
      orchestrator.refreshProvider("claude")
    ),
    vscode.commands.registerCommand("dualusage.refreshChatgpt", () =>
      orchestrator.refreshProvider("chatgpt")
    ),
    vscode.commands.registerCommand("dualusage.refreshCursor", () =>
      orchestrator.refreshProvider("cursor")
    ),
    vscode.commands.registerCommand("dualusage.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:phamhuyti.dualusage")
    ),
    vscode.commands.registerCommand("dualusage.focusSidebar", () =>
      vscode.commands.executeCommand(`${SidebarProvider.viewId}.focus`)
    )
  );

  statusBar.render(orchestrator.current);
  orchestrator.start();
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}
