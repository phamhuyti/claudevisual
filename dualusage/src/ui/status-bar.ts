import * as vscode from "vscode";
import {
  formatCompactLine,
  formatProviderLine,
  formatResets,
  shouldWarn,
  windowLabel,
} from "../domain/format";
import { AppState, ProviderSnapshot } from "../domain/types";
import { readSettings } from "../runtime/settings";

export class StatusBarController implements vscode.Disposable {
  private readonly claudeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  private readonly chatgptItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly compactItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  constructor() {
    this.claudeItem.name = "DualUsage Claude";
    this.chatgptItem.name = "DualUsage ChatGPT";
    this.compactItem.name = "DualUsage";
    this.claudeItem.command = "dualusage.refreshClaude";
    this.chatgptItem.command = "dualusage.refreshChatgpt";
    this.compactItem.command = "dualusage.refreshAll";
  }

  render(state: AppState): void {
    const settings = readSettings();
    if (settings.statusBarStyle === "compact") {
      this.claudeItem.hide();
      this.chatgptItem.hide();
      this.renderCompact(state, settings.warnPercent, settings.creditsWarnBalance);
      return;
    }
    this.compactItem.hide();
    this.renderSplit(this.claudeItem, state.claude, settings.warnPercent, settings.creditsWarnBalance);
    this.renderSplit(this.chatgptItem, state.chatgpt, settings.warnPercent, settings.creditsWarnBalance);
  }

  private renderCompact(state: AppState, warnPercent: number, creditsWarnBalance: number): void {
    const claude = state.claude?.status === "disabled" ? undefined : state.claude;
    const chatgpt = state.chatgpt?.status === "disabled" ? undefined : state.chatgpt;
    if (!claude && !chatgpt) {
      this.compactItem.hide();
      return;
    }
    this.compactItem.text = `$(dashboard) ${formatCompactLine(claude, chatgpt)}`;
    this.compactItem.tooltip = buildCombinedTooltip(claude, chatgpt);
    const warn =
      (claude ? shouldWarn(claude, warnPercent, creditsWarnBalance) : false) ||
      (chatgpt ? shouldWarn(chatgpt, warnPercent, creditsWarnBalance) : false);
    this.compactItem.backgroundColor = warn
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    this.compactItem.show();
  }

  private renderSplit(
    item: vscode.StatusBarItem,
    snap: ProviderSnapshot | undefined,
    warnPercent: number,
    creditsWarnBalance: number
  ): void {
    if (!snap || snap.status === "disabled") {
      item.hide();
      return;
    }
    item.text = `$(dashboard) ${formatProviderLine(snap)}`;
    item.tooltip = buildTooltip(snap);
    item.backgroundColor = shouldWarn(snap, warnPercent, creditsWarnBalance)
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    item.show();
  }

  dispose(): void {
    this.claudeItem.dispose();
    this.chatgptItem.dispose();
    this.compactItem.dispose();
  }
}

function buildTooltip(snap: ProviderSnapshot): vscode.MarkdownString {
  const title = snap.provider === "claude" ? "Claude" : "ChatGPT";
  const lines: string[] = [`**${title} account usage**`, ""];
  if (snap.planType) {
    lines.push(`Plan: \`${snap.planType}\``);
  }
  if (snap.email) {
    lines.push(`Account: ${snap.email}`);
  }
  if (snap.status !== "ok") {
    lines.push(`Status: ${snap.status}${snap.error ? ` — ${snap.error}` : ""}`);
  }
  for (const w of snap.windows) {
    lines.push(`${windowLabel(w.windowSeconds)}: ${Math.round(w.usedPercent)}% used · resets ${formatResets(w)}`);
  }
  if (snap.credits) {
    if (snap.credits.unlimited) {
      lines.push("Credits: unlimited");
    } else if (snap.credits.hasCredits && snap.credits.balance) {
      lines.push(`Credits: $${String(snap.credits.balance).replace(/^\$/, "")}`);
    } else {
      lines.push("Credits: none");
    }
  }
  if (snap.monthly) {
    lines.push(
      `Monthly: ${Math.round(snap.monthly.usedPercent)}%` +
        ` ($${snap.monthly.used.toFixed(2)} / $${snap.monthly.limit.toFixed(2)})`
    );
  }
  lines.push("", `_source: ${snap.source}_`, "", "Click to refresh.");
  return new vscode.MarkdownString(lines.join("\n"));
}

function buildCombinedTooltip(claude?: ProviderSnapshot, chatgpt?: ProviderSnapshot): vscode.MarkdownString {
  const parts: string[] = [];
  if (claude) {
    parts.push(buildTooltip(claude).value);
  }
  if (chatgpt) {
    if (parts.length) {
      parts.push("---");
    }
    parts.push(buildTooltip(chatgpt).value);
  }
  return new vscode.MarkdownString(parts.join("\n\n"));
}
