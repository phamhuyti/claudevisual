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
    pollIntervalSeconds: resolveGlobalPollSeconds(cfg),
    claudePollIntervalSeconds: resolveProviderPollSeconds(cfg, "claude"),
    chatgptPollIntervalSeconds: resolveProviderPollSeconds(cfg, "chatgpt"),
    cursorPollIntervalSeconds: resolveProviderPollSeconds(cfg, "cursor"),
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

const DEFAULT_POLL_SECONDS = 60;
const MIN_POLL_SECONDS = 5;

export function pollIntervalSecondsFor(id: ProviderId, settings = readSettings()): number {
  const per =
    id === "claude"
      ? settings.claudePollIntervalSeconds
      : id === "chatgpt"
        ? settings.chatgptPollIntervalSeconds
        : settings.cursorPollIntervalSeconds;
  const seconds = per > 0 ? per : settings.pollIntervalSeconds;
  return Math.max(MIN_POLL_SECONDS, seconds);
}

function isUserSet(cfg: vscode.WorkspaceConfiguration, key: string): boolean {
  // Unit-test vscode stubs may omit `inspect`; treat as unset → use defaults / migration.
  if (typeof cfg.inspect !== "function") {
    return false;
  }
  const inspected = cfg.inspect(key);
  if (!inspected) {
    return false;
  }
  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined
  );
}

function resolveGlobalPollSeconds(cfg: vscode.WorkspaceConfiguration): number {
  if (isUserSet(cfg, "pollIntervalSeconds")) {
    return Math.max(MIN_POLL_SECONDS, cfg.get<number>("pollIntervalSeconds", DEFAULT_POLL_SECONDS));
  }
  if (isUserSet(cfg, "pollIntervalMinutes")) {
    const minutes = Math.max(1, cfg.get<number>("pollIntervalMinutes", 1));
    return Math.max(MIN_POLL_SECONDS, Math.round(minutes * 60));
  }
  return DEFAULT_POLL_SECONDS;
}

/** 0 = inherit global. Migrates legacy *.pollIntervalMinutes when seconds unset. */
function resolveProviderPollSeconds(
  cfg: vscode.WorkspaceConfiguration,
  provider: "claude" | "chatgpt" | "cursor"
): number {
  const secKey = `providers.${provider}.pollIntervalSeconds`;
  if (isUserSet(cfg, secKey)) {
    return Math.max(0, cfg.get<number>(secKey, 0));
  }
  const minKey = `providers.${provider}.pollIntervalMinutes`;
  if (isUserSet(cfg, minKey)) {
    const minutes = Math.max(0, cfg.get<number>(minKey, 0));
    return minutes > 0 ? Math.max(MIN_POLL_SECONDS, Math.round(minutes * 60)) : 0;
  }
  return 0;
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
