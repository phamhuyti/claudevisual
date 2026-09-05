import * as vscode from "vscode";
import { DualUsageSettings, ProviderId } from "../domain/types";

export type { DualUsageSettings };

const DEFAULT_ORDER: ProviderId[] = ["claude", "chatgpt", "cursor"];

export function readSettings(): DualUsageSettings {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  return {
    claudeEnabled: cfg.get<boolean>("providers.claude.enabled", true),
    chatgptEnabled: cfg.get<boolean>("providers.chatgpt.enabled", true),
    cursorEnabled: cfg.get<boolean>("providers.cursor.enabled", true),
    providersOrder: normalizeOrder(cfg.get<string[]>("providers.order", DEFAULT_ORDER)),
    pollIntervalMinutes: Math.max(1, cfg.get<number>("pollIntervalMinutes", 1)),
    claudePollIntervalMinutes: Math.max(0, cfg.get<number>("providers.claude.pollIntervalMinutes", 0)),
    chatgptPollIntervalMinutes: Math.max(0, cfg.get<number>("providers.chatgpt.pollIntervalMinutes", 0)),
    cursorPollIntervalMinutes: Math.max(0, cfg.get<number>("providers.cursor.pollIntervalMinutes", 0)),
    warnPercent: cfg.get<number>("warnPercent", 90),
    claudeWarnPercent: Math.max(0, cfg.get<number>("providers.claude.warnPercent", 0)),
    chatgptWarnPercent: Math.max(0, cfg.get<number>("providers.chatgpt.warnPercent", 0)),
    cursorWarnPercent: Math.max(0, cfg.get<number>("providers.cursor.warnPercent", 0)),
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

export function warnPercentFor(id: ProviderId, settings = readSettings()): number {
  const per =
    id === "claude"
      ? settings.claudeWarnPercent
      : id === "chatgpt"
        ? settings.chatgptWarnPercent
        : settings.cursorWarnPercent;
  return per > 0 ? per : settings.warnPercent;
}

export function pollIntervalMinutesFor(id: ProviderId, settings = readSettings()): number {
  const per =
    id === "claude"
      ? settings.claudePollIntervalMinutes
      : id === "chatgpt"
        ? settings.chatgptPollIntervalMinutes
        : settings.cursorPollIntervalMinutes;
  return per > 0 ? per : settings.pollIntervalMinutes;
}

function normalizeOrder(raw: string[] | undefined): ProviderId[] {
  const seen = new Set<ProviderId>();
  const out: ProviderId[] = [];
  for (const id of raw ?? []) {
    if ((id === "claude" || id === "chatgpt" || id === "cursor") && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) {
      out.push(id);
    }
  }
  return out;
}
