import * as vscode from "vscode";
import { LimitWindow } from "../core/usage-limits";
import { UsageSnapshot } from "../core/usage-poller";

/**
 * Dedicated status-bar item for the account-wide rate limits: `5h X% · 7d Y%`.
 * Separate from the per-session `StatusBar` because these numbers are
 * account-wide and must show even when no Claude Code session is active in the
 * workspace. Right-aligned so it sits apart from the session item.
 */
export class LimitsStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  constructor() {
    this.item.name = "ClaudeVisual Limits";
    this.item.command = "claudevisual.refreshLimits";
    this.render({ status: "idle" });
  }

  render(snapshot: UsageSnapshot): void {
    if (snapshot.status === "disabled") {
      this.item.hide();
      return;
    }

    if (snapshot.status === "error" && !snapshot.limits) {
      this.item.text = "$(dashboard) limits n/a";
      this.item.tooltip = new vscode.MarkdownString(
        `**Account limits unavailable**\n\n${snapshot.error ?? "the /usage report could not be read"}\n\n` +
          "Make sure Claude Code is installed and signed in. Click to retry."
      );
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    const limits = snapshot.limits;
    if (!limits) {
      this.item.text = "$(sync~spin) limits…";
      this.item.tooltip = "Fetching account usage limits…";
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    const warnPercent = vscode.workspace
      .getConfiguration("claudevisual.limits")
      .get<number>("warnPercent", 90);
    const parts: string[] = [];
    if (limits.fiveHour) {
      parts.push(`5h ${limits.fiveHour.percent}%`);
    }
    if (limits.sevenDay) {
      parts.push(`7d ${limits.sevenDay.percent}%`);
    }

    const maxPercent = Math.max(limits.fiveHour?.percent ?? 0, limits.sevenDay?.percent ?? 0);
    this.item.backgroundColor =
      maxPercent >= warnPercent ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;

    this.item.text = `$(dashboard) ${parts.join(" · ")}`;
    this.item.tooltip = buildTooltip(snapshot);
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

function windowLine(label: string, w: LimitWindow | undefined): string {
  if (!w) {
    return `${label}: —`;
  }
  const resets = w.resetsLabel ? ` · resets ${w.resetsLabel}` : "";
  return `${label}: ${w.percent}% used${resets}`;
}

function buildTooltip(snapshot: UsageSnapshot): vscode.MarkdownString {
  const limits = snapshot.limits!;
  const lines: string[] = [
    "**Claude Code account limits**",
    "",
    windowLine("5-hour window", limits.fiveHour),
    windowLine("7-day window (all models)", limits.sevenDay),
  ];
  if (limits.fableWeek) {
    lines.push(windowLine("7-day window (Fable)", limits.fableWeek));
  }
  if (snapshot.capturedAt !== undefined) {
    lines.push("", `_as of ${formatAge(Date.now() - snapshot.capturedAt)}_`);
  }
  lines.push("", "Account-wide, via `claude /usage`. Click to refresh now.");
  const md = new vscode.MarkdownString(lines.join("\n"));
  return md;
}

function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}
