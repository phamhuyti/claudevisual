import * as vscode from "vscode";
import { ProviderId } from "./domain/types";
import { usagePageUrl } from "./domain/usage-links";
import { initLog, logInfo } from "./log";
import { UsageOrchestrator } from "./runtime/orchestrator";
import { UsagePersistence } from "./runtime/persistence";
import { ThresholdNotifier } from "./runtime/threshold-notifier";
import { SidebarProvider } from "./ui/sidebar/sidebar-provider";
import { StatusBarController } from "./ui/status-bar";

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  logInfo("DualUsage activating");

  const persistence = new UsagePersistence(context.globalState);
  const orchestrator = new UsageOrchestrator({ persistence });
  const statusBar = new StatusBarController();
  const sidebar = new SidebarProvider(context.extensionPath);
  const notifier = new ThresholdNotifier();

  // Show cached numbers immediately.
  statusBar.render(orchestrator.current);
  sidebar.setState(orchestrator.current);
  sidebar.setHistory(orchestrator.currentHistory);

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
    orchestrator.onDidChangeHistory((history) => {
      sidebar.setHistory(history);
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
    ),
    vscode.commands.registerCommand("dualusage.toggleProvider", () => toggleProviders()),
    vscode.commands.registerCommand("dualusage.openUsagePage", async (provider?: ProviderId) => {
      const fromContext = sidebar.takeContextProvider();
      const id =
        provider ??
        fromContext ??
        (await pickProvider("Open usage page for"));
      if (!id) {
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(usagePageUrl(id)));
    })
  );

  orchestrator.start();
}

export function deactivate(): void {
  // disposables handled via context.subscriptions
}

async function toggleProviders(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  const items: Array<vscode.QuickPickItem & { id: ProviderId; key: string }> = [
    {
      id: "claude",
      key: "providers.claude.enabled",
      label: "Claude",
      description: "claude /usage CLI",
      picked: cfg.get<boolean>("providers.claude.enabled", true),
    },
    {
      id: "chatgpt",
      key: "providers.chatgpt.enabled",
      label: "ChatGPT",
      description: "Codex / WHAM API",
      picked: cfg.get<boolean>("providers.chatgpt.enabled", true),
    },
    {
      id: "cursor",
      key: "providers.cursor.enabled",
      label: "Cursor",
      description: "Dashboard API",
      picked: cfg.get<boolean>("providers.cursor.enabled", true),
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "DualUsage providers",
    placeHolder: "Select providers to show",
  });
  if (!picked) {
    return;
  }
  const selected = new Set(picked.map((p) => p.id));
  for (const item of items) {
    await cfg.update(item.key, selected.has(item.id), vscode.ConfigurationTarget.Global);
  }
}

async function pickProvider(title: string): Promise<ProviderId | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "Claude", id: "claude" as const },
      { label: "ChatGPT", id: "chatgpt" as const },
      { label: "Cursor", id: "cursor" as const },
    ],
    { title }
  );
  return picked?.id;
}
