import * as vscode from "vscode";
import { AdvisorConfig, BillingPlan } from "../core/advisor/advisor-config";
import { AdvisorThresholds, DEFAULT_ADVISOR_THRESHOLDS } from "../core/advisor/advisor-thresholds";

/**
 * Resolves the Efficiency Advisor's full config — billing plan + per-rule
 * thresholds — from the `claudevisual.advisor.*` settings. Kept in the config layer
 * (not core, which stays vscode-free) so every host (webviews, status bar,
 * notifier) shares one source. Falls back to the built-in default for any
 * unset or invalid value, so a single bad setting never breaks the advisor.
 */
export function resolveAdvisorConfig(): AdvisorConfig {
  const cfg = vscode.workspace.getConfiguration("claudevisual");
  const raw = cfg.get<string>("advisor.plan");
  const plan: BillingPlan = raw === "pro" || raw === "api" || raw === "max" ? raw : "max";
  return { plan, thresholds: resolveThresholds(cfg) };
}

/** Reads each `claudevisual.advisor.thresholds.*` setting, keeping the default for
 *  any entry that's unset or not a finite number (e.g. a stray empty string). */
function resolveThresholds(cfg: vscode.WorkspaceConfiguration): AdvisorThresholds {
  const num = (key: keyof AdvisorThresholds): number => {
    const value = cfg.get<number>(`advisor.thresholds.${key}`);
    return typeof value === "number" && isFinite(value) ? value : DEFAULT_ADVISOR_THRESHOLDS[key];
  };
  return {
    contextWarnPercent: num("contextWarnPercent"),
    contextCritPercent: num("contextCritPercent"),
    cacheChurnRatio: num("cacheChurnRatio"),
    cacheChurnMinCreationTokens: num("cacheChurnMinCreationTokens"),
    cacheLowSavedPct: num("cacheLowSavedPct"),
    cacheLowMinTotalTokens: num("cacheLowMinTotalTokens"),
    subagentExpensiveTokens: num("subagentExpensiveTokens"),
    subagentExpensiveShareOfSession: num("subagentExpensiveShareOfSession"),
    modelRightsizeMinTotalTokens: num("modelRightsizeMinTotalTokens"),
    modelRightsizeMaxOutputShare: num("modelRightsizeMaxOutputShare"),
    costProjectionMinBurnPerMin: num("costProjectionMinBurnPerMin"),
    frequentCompactionCount: num("frequentCompactionCount"),
  };
}
