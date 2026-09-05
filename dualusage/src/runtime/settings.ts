import * as vscode from "vscode";
import { DualUsageSettings } from "../domain/types";

export type { DualUsageSettings };

export function readSettings(): DualUsageSettings {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  return {
    claudeEnabled: cfg.get<boolean>("providers.claude.enabled", true),
    chatgptEnabled: cfg.get<boolean>("providers.chatgpt.enabled", true),
    cursorEnabled: cfg.get<boolean>("providers.cursor.enabled", true),
    pollIntervalMinutes: Math.max(1, cfg.get<number>("pollIntervalMinutes", 1)),
    warnPercent: cfg.get<number>("warnPercent", 90),
    creditsWarnBalance: cfg.get<number>("creditsWarnBalance", 1),
    claudePath: cfg.get<string>("claudePath", ""),
    codexHome: cfg.get<string>("codexHome", ""),
    cursorDataPath: cfg.get<string>("cursorDataPath", ""),
    chatgptSource: cfg.get<"auto" | "api" | "rollout">("chatgpt.source", "auto"),
    statusBarStyle: cfg.get<"split" | "compact" | "ultra">("statusBar.style", "split"),
    statusBarShowWindows: cfg.get<boolean>("statusBar.showWindows", true),
    statusBarShowCredits: cfg.get<boolean>("statusBar.showCredits", true),
    statusBarShowMonthly: cfg.get<boolean>("statusBar.showMonthly", true),
    statusBarClickAction: cfg.get<"refresh" | "openSidebar" | "openSettings">(
      "statusBar.clickAction",
      "refresh"
    ),
    notificationsEnabled: cfg.get<boolean>("notifications.enabled", true),
    notificationsPercent: cfg.get<number>("notifications.percent", 0),
    debug: cfg.get<boolean>("debug", false),
  };
}
