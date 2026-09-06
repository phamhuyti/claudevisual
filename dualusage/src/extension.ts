import * as vscode from "vscode";
import { isProviderId, ProviderId } from "./domain/types";
import { usagePageUrl } from "./domain/usage-links";
import { initLog, logError, logInfo } from "./log";
import { UsageOrchestrator } from "./runtime/orchestrator";
import { UsagePersistence } from "./runtime/persistence";
import { migrateLegacySettings } from "./runtime/settings";
import { ThresholdNotifier } from "./runtime/threshold-notifier";
import { SidebarProvider } from "./ui/sidebar/sidebar-provider";
import { StatusBarController } from "./ui/status-bar";

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  logInfo("DualUsage activating");

  migrateLegacySettings().catch((err) => logError("settings migration failed", err));

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
    vscode.commands.registerCommand("dualusage.openUsagePage", async (arg?: unknown) => {
      const id = providerIdFromCommandArg(arg) ?? (await pickProvider("Open usage page for"));
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

/**
 * `dualusage.openUsagePage` can be invoked with a provider id (status bar,
 * command palette callers) or with the merged `data-vscode-context` object that
 * VS Code forwards from `webview/context` menus ({ webviewSection, provider, … }).
 */
export function providerIdFromCommandArg(arg: unknown): ProviderId | undefined {
  if (isProviderId(arg)) {
    return arg;
  }
  if (arg && typeof arg === "object") {
    const candidate = (arg as { provider?: unknown }).provider;
    return isProviderId(candidate) ? candidate : undefined;
  }
  return undefined;
}

async function toggleProviders(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  const items: Array<vscode.QuickPickItem & { id: ProviderId; key: string }> = [
    {
      id: "claude",
      key: "providers.claude.enabled",
      label: "Claude",
      description: "claude /usage CLI",
      picked: cfg.get<boolean>("providers.claude.enabled", false),
    },
    {
      id: "chatgpt",
      key: "providers.chatgpt.enabled",
      label: "ChatGPT",
      description: "Codex / WHAM API",
      picked: cfg.get<boolean>("providers.chatgpt.enabled", false),
    },
    {
      id: "cursor",
      key: "providers.cursor.enabled",
      label: "Cursor",
      description: "Dashboard API",
      picked: cfg.get<boolean>("providers.cursor.enabled", false),
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
    const next = selected.has(item.id);
    if (next === item.picked) {
      continue;
    }
    // Write to the scope that currently owns the effective value so a workspace
    // override does not make the QuickPick appear to do nothing.
    await cfg.update(item.key, next, owningTarget(cfg, item.key));
  }
}

function owningTarget(cfg: vscode.WorkspaceConfiguration, key: string): vscode.ConfigurationTarget {
  const info = cfg.inspect(key);
  if (info?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (info?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
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
