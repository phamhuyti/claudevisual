import * as vscode from "vscode";
import { DualUsageSettings } from "../domain/types";

export function readSettings(): DualUsageSettings {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  return {
    claudeEnabled: cfg.get<boolean>("providers.claude.enabled", true),
    chatgptEnabled: cfg.get<boolean>("providers.chatgpt.enabled", true),
    pollIntervalMinutes: Math.max(1, cfg.get<number>("pollIntervalMinutes", 5)),
    warnPercent: cfg.get<number>("warnPercent", 90),
    creditsWarnBalance: cfg.get<number>("creditsWarnBalance", 1),
    claudePath: cfg.get<string>("claudePath", ""),
    codexHome: cfg.get<string>("codexHome", ""),
    chatgptSource: cfg.get<"auto" | "api" | "rollout">("chatgpt.source", "auto"),
    statusBarStyle: cfg.get<"split" | "compact">("statusBar.style", "split"),
    debug: cfg.get<boolean>("debug", false),
  };
}
