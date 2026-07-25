import * as vscode from "vscode";
import { EventLogReader } from "./core/event-log-reader";
import { JsonlTailer } from "./core/jsonl-tailer";
import { normalizeCwd, projectDirForCwd } from "./core/project-hash";
import { SessionStateStore } from "./core/session-state-store";
import { initLogger, logError, logInfo } from "./diagnostics/logger";
import {
  detectStatusLine,
  installHooks,
  installStatusLineDirect,
  previewStatusLineWrap,
  restoreOriginalStatusLine,
  uninstallHooks,
  wrapStatusLine,
} from "./hooks/installer";
import { DashboardPanel } from "./ui/webview/panel";
import { StatusBar } from "./ui/status-bar";
import { LimitsStatusBar } from "./ui/limits-status-bar";
import { AdvisorNotifier } from "./ui/advisor-notifier";
import { SidebarViewProvider } from "./ui/webview-view/sidebar-view-provider";
import { UsageLimitsPoller } from "./core/usage-poller";

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  // Account-wide 5h/7d rate limits — independent of any workspace session, so
  // wired here (outside `rebuild`) and driven by its own headless-`/usage`
  // poller rather than the JSONL store. Shows even when no session is open.
  const limitsStatusBar = new LimitsStatusBar();
  const usagePoller = new UsageLimitsPoller();
  context.subscriptions.push(
    limitsStatusBar,
    usagePoller,
    usagePoller.onDidChange((snapshot) => limitsStatusBar.render(snapshot))
  );
  usagePoller.start();

  // Persists across store rebuilds (workspace-folder changes) so its "already
  // notified" dedupe state isn't lost mid-session.
  const advisorNotifier = new AdvisorNotifier();
  context.subscriptions.push(advisorNotifier);

  // Sidebar webview is registered exactly once (a view id can't be
  // re-registered); its backing store is swapped via `setStore` whenever
  // `rebuild()` recreates the store on a workspace-folder change.
  const sidebarProvider = new SidebarViewProvider(context.extensionPath);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewId, sidebarProvider),
    sidebarProvider
  );

  // Tracks whichever SessionStateStore `rebuild()` (below) currently owns, so
  // the "Open Dashboard" command — registered once here, outside `rebuild`'s
  // per-workspace-folder-change lifecycle — always hands DashboardPanel the
  // live store instead of a stale/disposed one.
  let currentStore: SessionStateStore | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand("claudevisual.installHooks", () => void runInstallHooks(context)),
    vscode.commands.registerCommand("claudevisual.uninstallHooks", () => void runUninstallHooks()),
    vscode.commands.registerCommand("claudevisual.wrapStatusLine", () => void runWrapStatusLine(context)),
    vscode.commands.registerCommand("claudevisual.previewStatusLineWrap", () => void runPreviewStatusLineWrap(context)),
    vscode.commands.registerCommand("claudevisual.restoreOriginalStatusLine", () =>
      void runRestoreOriginalStatusLine(context)
    ),
    vscode.commands.registerCommand("claudevisual.openDashboard", () => {
      if (!currentStore) {
        void vscode.window.showInformationMessage("ClaudeVisual: open a workspace folder first.");
        return;
      }
      DashboardPanel.createOrShow(context, currentStore);
    }),
    vscode.commands.registerCommand("claudevisual.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:dinhphu.claudevisual")
    ),
    vscode.commands.registerCommand("claudevisual.refreshLimits", () => usagePoller.refresh())
  );

  // Rebuilt whenever workspace folders change (added/removed/reloaded) — not just
  // once at activation. Without this, opening a folder in an already-running VS
  // Code window (activation already ran with zero folders) would leave the
  // extension permanently idle for the rest of that window's lifetime.
  let activeDisposables: vscode.Disposable[] = [];

  const rebuild = (): void => {
    activeDisposables.forEach((d) => d.dispose());
    activeDisposables = [];

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      logInfo("no workspace folder open — ClaudeVisual stays idle");
      currentStore = undefined;
      statusBar.render([]);
      sidebarProvider.setStore(undefined);
      return;
    }

    const workspaceCwds = folders.map((f) => normalizeCwd(f.uri.fsPath));

    // One tailer per open folder (each watches its own ~/.claude/projects/<hash> dir),
    // but a single shared store/status-bar so a multi-root workspace never has one
    // folder's render non-deterministically overwrite another's.
    const tailers = workspaceCwds.map((cwd) => new JsonlTailer(projectDirForCwd(cwd)));
    const tailerByCwd = new Map(workspaceCwds.map((cwd, i) => [cwd, tailers[i]]));
    // Single shared reader (not one per folder): the opt-in hooks event log
    // lives at one fixed path (~/.claude/claudevisual/), independent of any
    // workspace folder.
    const eventLogReader = new EventLogReader();
    eventLogReader.start();
    const store = new SessionStateStore(tailers, workspaceCwds, eventLogReader);
    currentStore = store;
    sidebarProvider.setStore(store);

    // Tracks which tailer owns each known session's sub-agent watcher, so a
    // session that drops out of a later `sessions` list (ended, or its
    // transcript aged out of the store) can still be found and disposed —
    // without this, `addSessionSubagentWatcher` calls accumulate forever
    // with no matching `disposeSessionSubagentWatcher`, leaking one live OS
    // file watcher per session for the lifetime of the VS Code window.
    const subagentWatcherOwner = new Map<string, JsonlTailer>();

    activeDisposables.push(...tailers, eventLogReader, store);
    activeDisposables.push(
      store.onDidChange((sessions) => {
        statusBar.render(sessions);
        advisorNotifier.update(sessions);
        const currentSessionIds = new Set(sessions.map((s) => s.sessionId));

        // Lazily register each known session's narrow sub-agent watcher on
        // the one tailer that owns its project directory. Idempotent per
        // sessionId, so calling this on every store change is cheap and
        // never grows into a broad/recursive watch.
        for (const session of sessions) {
          const tailer = tailerByCwd.get(normalizeCwd(session.cwd));
          if (!tailer) {
            continue;
          }
          tailer.addSessionSubagentWatcher(session.sessionId);
          subagentWatcherOwner.set(session.sessionId, tailer);
        }

        // Evict watchers for sessions no longer in the store's known set.
        for (const [sessionId, tailer] of subagentWatcherOwner) {
          if (!currentSessionIds.has(sessionId)) {
            tailer.disposeSessionSubagentWatcher(sessionId);
            subagentWatcherOwner.delete(sessionId);
          }
        }
      })
    );

    for (const tailer of tailers) {
      void tailer.primeExisting();
    }

    logInfo(`activated for ${workspaceCwds.length} workspace folder(s)`);
  };

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(rebuild));
  context.subscriptions.push({ dispose: () => activeDisposables.forEach((d) => d.dispose()) });

  rebuild();
}

export function deactivate(): void {
  // All resources are registered in context.subscriptions and disposed by VS Code.
}

async function runInstallHooks(context: vscode.ExtensionContext): Promise<void> {
  try {
    const result = await installHooks(context.extensionPath);
    logInfo(
      `hooks installed: [${result.installedEvents.join(", ") || "none — already installed"}]` +
        ` (settings=${result.settingsPath}, backup=${result.backupPath ?? "none"})`
    );
    if (result.installedEvents.length === 0) {
      void vscode.window.showInformationMessage("ClaudeVisual: hooks were already installed.");
    } else {
      void vscode.window.showInformationMessage(
        `ClaudeVisual: installed hooks for ${result.installedEvents.length} event(s).`
      );
    }
  } catch (err) {
    logError("failed to install hooks", err);
    void vscode.window.showErrorMessage(
      `ClaudeVisual: failed to install hooks — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function runUninstallHooks(): Promise<void> {
  try {
    const result = await uninstallHooks();
    logInfo(
      `hooks uninstalled: removed ${result.removedCount} entrie(s)` +
        ` (settings=${result.settingsPath}, backup=${result.backupPath ?? "none"})`
    );
    void vscode.window.showInformationMessage(
      result.removedCount > 0
        ? `ClaudeVisual: removed ${result.removedCount} hook entrie(s).`
        : "ClaudeVisual: no hook entries found to remove."
    );
  } catch (err) {
    logError("failed to uninstall hooks", err);
    void vscode.window.showErrorMessage(
      `ClaudeVisual: failed to uninstall hooks — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * "ClaudeVisual: Wrap StatusLine" — branches on the current `statusLine`
 * state: empty/absent asks to install ClaudeVisual's own statusline
 * directly; already set asks to wrap it (never a silent overwrite); already
 * wrapped by us is a no-op info message.
 */
async function runWrapStatusLine(context: vscode.ExtensionContext): Promise<void> {
  try {
    const detection = await detectStatusLine();

    if (detection.kind === "already-wrapped") {
      void vscode.window.showInformationMessage("ClaudeVisual: statusLine is already wrapped.");
      return;
    }

    if (detection.kind === "empty") {
      const choice = await vscode.window.showInformationMessage(
        "No statusLine is currently configured in ~/.claude/settings.json. Install ClaudeVisual's statusline directly?",
        { modal: true },
        "Install"
      );
      if (choice !== "Install") {
        return;
      }
      const result = await installStatusLineDirect(context.extensionPath, context.globalState);
      logInfo(
        `statusLine installed directly: installed=${result.installed}` +
          ` (settings=${result.settingsPath}, backup=${result.backupPath ?? "none"})`
      );
      void vscode.window.showInformationMessage("ClaudeVisual: statusLine installed.");
      return;
    }

    // detection.kind === "foreign" — an existing, unrelated statusLine command is set.
    const choice = await vscode.window.showWarningMessage(
      `ClaudeVisual will wrap the existing statusLine command instead of replacing it:\n\n${detection.current.command}\n\n` +
        "Your existing statusline keeps rendering unchanged — ClaudeVisual only tees its stdin for precise " +
        "context%/cost. Use \"ClaudeVisual: Preview StatusLine Wrap\" first to see the exact before/after.",
      { modal: true },
      "Wrap StatusLine"
    );
    if (choice !== "Wrap StatusLine") {
      return;
    }
    const result = await wrapStatusLine(context.extensionPath, context.globalState);
    logInfo(
      `statusLine wrap: wrapped=${result.wrapped} alreadyWrapped=${result.alreadyWrapped}` +
        ` (settings=${result.settingsPath}, backup=${result.backupPath ?? "none"})`
    );
    void vscode.window.showInformationMessage(
      result.wrapped ? "ClaudeVisual: statusLine wrapped." : "ClaudeVisual: statusLine was already wrapped."
    );
  } catch (err) {
    logError("failed to wrap statusLine", err);
    void vscode.window.showErrorMessage(
      `ClaudeVisual: failed to wrap statusLine — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * "ClaudeVisual: Preview StatusLine Wrap" — read-only. Opens the exact
 * before/after `statusLine` JSON in VS Code's native side-by-side diff
 * editor, so the user can inspect precisely what "Wrap StatusLine" would
 * change before committing to it.
 */
async function runPreviewStatusLineWrap(context: vscode.ExtensionContext): Promise<void> {
  try {
    const preview = await previewStatusLineWrap(context.extensionPath);
    const beforeDoc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(preview.before ?? { note: "no statusLine currently set" }, null, 2),
      language: "json",
    });
    const afterDoc = await vscode.workspace.openTextDocument({
      content: JSON.stringify(preview.after, null, 2),
      language: "json",
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeDoc.uri,
      afterDoc.uri,
      "ClaudeVisual: StatusLine Wrap Preview (before ↔ after)"
    );
  } catch (err) {
    logError("failed to preview statusLine wrap", err);
    void vscode.window.showErrorMessage(
      `ClaudeVisual: failed to preview statusLine wrap — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * "ClaudeVisual: Restore Original StatusLine" — restores `statusLine` to
 * exactly what it was before wrap/direct-install, sourced from `globalState`
 * (not by re-deriving it from the current, possibly-mutated, settings.json).
 */
async function runRestoreOriginalStatusLine(context: vscode.ExtensionContext): Promise<void> {
  try {
    const result = await restoreOriginalStatusLine(context.globalState);
    if (!result.restored) {
      void vscode.window.showInformationMessage("ClaudeVisual: no wrapped/installed statusLine to restore.");
      return;
    }
    logInfo(`statusLine restored (settings=${result.settingsPath}, backup=${result.backupPath ?? "none"})`);
    void vscode.window.showInformationMessage("ClaudeVisual: statusLine restored to its original value.");
  } catch (err) {
    logError("failed to restore statusLine", err);
    void vscode.window.showErrorMessage(
      `ClaudeVisual: failed to restore statusLine — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
