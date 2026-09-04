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

function providerTitle(snap: ProviderSnapshot): string {
  if (snap.provider === "claude") {
    return "Claude";
  }
  if (snap.provider === "chatgpt") {
    return "ChatGPT";
  }
  return "Cursor";
}

export class StatusBarController implements vscode.Disposable {
  private readonly claudeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
  private readonly chatgptItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  private readonly cursorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly compactItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  constructor() {
    this.claudeItem.name = "DualUsage Claude";
    this.chatgptItem.name = "DualUsage ChatGPT";
    this.cursorItem.name = "DualUsage Cursor";
    this.compactItem.name = "DualUsage";
    this.claudeItem.command = "dualusage.refreshClaude";
    this.chatgptItem.command = "dualusage.refreshChatgpt";
    this.cursorItem.command = "dualusage.refreshCursor";
    this.compactItem.command = "dualusage.refreshAll";
  }

  render(state: AppState): void {
    const settings = readSettings();
    if (settings.statusBarStyle === "compact") {
      this.claudeItem.hide();
      this.chatgptItem.hide();
      this.cursorItem.hide();
      this.renderCompact(state, settings.warnPercent, settings.creditsWarnBalance);
      return;
    }
    this.compactItem.hide();
    this.renderSplit(this.claudeItem, state.claude, settings.warnPercent, settings.creditsWarnBalance);
    this.renderSplit(this.chatgptItem, state.chatgpt, settings.warnPercent, settings.creditsWarnBalance);
    this.renderSplit(this.cursorItem, state.cursor, settings.warnPercent, settings.creditsWarnBalance);
  }

  private renderCompact(state: AppState, warnPercent: number, creditsWarnBalance: number): void {
    const claude = state.claude?.status === "disabled" ? undefined : state.claude;
    const chatgpt = state.chatgpt?.status === "disabled" ? undefined : state.chatgpt;
    const cursor = state.cursor?.status === "disabled" ? undefined : state.cursor;
    if (!claude && !chatgpt && !cursor) {
      this.compactItem.hide();
      return;
    }
    this.compactItem.text = `$(dashboard) ${formatCompactLine(claude, chatgpt, cursor)}`;
    this.compactItem.tooltip = buildCombinedTooltip(claude, chatgpt, cursor);
    const warn =
      (claude ? shouldWarn(claude, warnPercent, creditsWarnBalance) : false) ||
      (chatgpt ? shouldWarn(chatgpt, warnPercent, creditsWarnBalance) : false) ||
      (cursor ? shouldWarn(cursor, warnPercent, creditsWarnBalance) : false);
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
    this.cursorItem.dispose();
    this.compactItem.dispose();
  }
}

function buildTooltip(snap: ProviderSnapshot): vscode.MarkdownString {
  const title = providerTitle(snap);
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
      const label = snap.provider === "cursor" ? "On-demand remaining" : "Credits";
      lines.push(`${label}: $${String(snap.credits.balance).replace(/^\$/, "")}`);
    } else {
      lines.push(snap.provider === "cursor" ? "On-demand: none" : "Credits: none");
    }
  }
  if (snap.monthly) {
    lines.push(
      `Monthly: ${Math.round(snap.monthly.usedPercent)}%` +
        ` ($${snap.monthly.used.toFixed(2)} / $${snap.monthly.limit.toFixed(2)})`
    );
  }
  if (snap.promoMessage) {
    lines.push(snap.promoMessage);
  }
  lines.push("", `_source: ${snap.source}_`, "", "Click to refresh.");
  return new vscode.MarkdownString(lines.join("\n"));
}

function buildCombinedTooltip(
  claude?: ProviderSnapshot,
  chatgpt?: ProviderSnapshot,
  cursor?: ProviderSnapshot
): vscode.MarkdownString {
  const parts: string[] = [];
  for (const snap of [claude, chatgpt, cursor]) {
    if (!snap) {
      continue;
    }
    if (parts.length) {
      parts.push("---");
    }
    parts.push(buildTooltip(snap).value);
  }
  return new vscode.MarkdownString(parts.join("\n\n"));
}
