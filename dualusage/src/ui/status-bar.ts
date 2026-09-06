import * as vscode from "vscode";
import {
  formatCompactLine,
  formatCountdown,
  formatCursorPlanRemaining,
  formatProviderBody,
  formatProviderLine,
  formatResets,
  isLimitHit,
  shouldWarn,
  unicodeBar,
  windowLabel,
} from "../domain/format";
import { AppState, ProviderId, ProviderSnapshot } from "../domain/types";
import { DualUsageSettings, readSettings, warnPercentFor } from "../runtime/settings";

function providerTitle(id: ProviderId): string {
  if (id === "claude") {
    return "Claude";
  }
  if (id === "chatgpt") {
    return "ChatGPT";
  }
  return "Cursor";
}

function providerIcon(id: ProviderId): string {
  if (id === "claude") {
    return "$(comment-discussion)";
  }
  if (id === "chatgpt") {
    return "$(hubot)";
  }
  return "$(code)";
}

function clickCommand(
  id: ProviderId | "all",
  action: DualUsageSettings["statusBarClickAction"]
): string {
  if (action === "openSidebar") {
    return "dualusage.focusSidebar";
  }
  if (action === "openSettings") {
    return "dualusage.openSettings";
  }
  if (id === "all") {
    return "dualusage.refreshAll";
  }
  if (id === "claude") {
    return "dualusage.refreshClaude";
  }
  if (id === "chatgpt") {
    return "dualusage.refreshChatgpt";
  }
  return "dualusage.refreshCursor";
}

function formatUltra(snap: ProviderSnapshot, settings: DualUsageSettings): string {
  const parts: string[] = [];
  if (settings.statusBarShowWindows) {
    for (const w of snap.windows.slice(0, 2)) {
      parts.push(`${windowLabel(w.windowSeconds)} ${Math.round(w.usedPercent)}%`);
    }
  }
  if (settings.statusBarShowCredits && snap.credits?.hasCredits && snap.credits.balance) {
    const bal = String(snap.credits.balance).replace(/^\$/, "");
    parts.push(`$${bal}`);
  }
  if (settings.statusBarShowMonthly && snap.monthly) {
    if (snap.monthly.source === "cursor_plan") {
      parts.push(formatCursorPlanRemaining(snap.monthly));
    } else {
      parts.push(`$${snap.monthly.used.toFixed(0)}/$${snap.monthly.limit.toFixed(0)}`);
    }
  }
  const short = snap.provider === "claude" ? "C" : snap.provider === "chatgpt" ? "G" : "Cur";
  return parts.length ? `${short} ${parts.join(" · ")}` : `${short} ${formatProviderBody(snap)}`;
}

function formatLine(snap: ProviderSnapshot, settings: DualUsageSettings): string {
  if (settings.statusBarStyle === "ultra") {
    return formatUltra(snap, settings);
  }
  // Compact / split: optionally strip fields by rebuilding from body pieces.
  if (
    settings.statusBarShowWindows &&
    settings.statusBarShowCredits &&
    settings.statusBarShowMonthly
  ) {
    return formatProviderLine(snap);
  }
  const name =
    snap.provider === "claude" ? "Claude" : snap.provider === "chatgpt" ? "GPT" : "Cursor";
  const parts: string[] = [];
  if (settings.statusBarShowWindows) {
    for (const w of snap.windows) {
      parts.push(`${windowLabel(w.windowSeconds)} ${Math.round(w.usedPercent)}%`);
    }
  }
  if (settings.statusBarShowCredits && snap.credits) {
    if (snap.credits.unlimited) {
      parts.push("credits ∞");
    } else if (snap.credits.hasCredits && snap.credits.balance) {
      const raw = snap.credits.balance.trim();
      parts.push(raw.startsWith("$") ? raw : `$${raw}`);
    }
  }
  if (settings.statusBarShowMonthly && snap.monthly) {
    if (snap.monthly.source === "cursor_plan") {
      parts.push(formatCursorPlanRemaining(snap.monthly, { withPercent: true }));
    } else {
      parts.push(`monthly ${Math.round(snap.monthly.usedPercent)}%`);
    }
  }
  return parts.length ? `${name} ${parts.join(" · ")}` : formatProviderLine(snap);
}

export class StatusBarController implements vscode.Disposable {
  private readonly claudeItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    102
  );
  private readonly chatgptItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101
  );
  private readonly cursorItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  private readonly compactItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  constructor() {
    this.claudeItem.name = "DualUsage Claude";
    this.chatgptItem.name = "DualUsage ChatGPT";
    this.cursorItem.name = "DualUsage Cursor";
    this.compactItem.name = "DualUsage";
  }

  render(state: AppState): void {
    const settings = readSettings();
    if (settings.statusBarStyle === "compact" || settings.statusBarStyle === "ultra") {
      this.claudeItem.hide();
      this.chatgptItem.hide();
      this.cursorItem.hide();
      this.renderCompact(state, settings);
      return;
    }
    this.compactItem.hide();
    this.renderSplit(this.claudeItem, state.claude, settings);
    this.renderSplit(this.chatgptItem, state.chatgpt, settings);
    this.renderSplit(this.cursorItem, state.cursor, settings);
  }

  private renderCompact(state: AppState, settings: DualUsageSettings): void {
    const claude = state.claude?.status === "disabled" ? undefined : state.claude;
    const chatgpt = state.chatgpt?.status === "disabled" ? undefined : state.chatgpt;
    const cursor = state.cursor?.status === "disabled" ? undefined : state.cursor;
    if (!claude && !chatgpt && !cursor) {
      this.compactItem.hide();
      return;
    }

    let text: string;
    if (settings.statusBarStyle === "ultra") {
      const bits: string[] = [];
      if (claude) {
        bits.push(formatUltra(claude, settings));
      }
      if (chatgpt) {
        bits.push(formatUltra(chatgpt, settings));
      }
      if (cursor) {
        bits.push(formatUltra(cursor, settings));
      }
      text = bits.join(" | ") || "DualUsage";
    } else {
      text = formatCompactLine(claude, chatgpt, cursor);
    }

    this.compactItem.text = `$(dashboard) ${text}`;
    this.compactItem.tooltip = buildCombinedTooltip(claude, chatgpt, cursor);
    this.compactItem.command = clickCommand("all", settings.statusBarClickAction);
    this.applyBackground(this.compactItem, [claude, chatgpt, cursor], settings);
    this.compactItem.show();
  }

  private renderSplit(
    item: vscode.StatusBarItem,
    snap: ProviderSnapshot | undefined,
    settings: DualUsageSettings
  ): void {
    if (!snap || snap.status === "disabled") {
      item.hide();
      return;
    }
    item.text = `${providerIcon(snap.provider)} ${formatLine(snap, settings)}`;
    item.tooltip = buildTooltip(snap);
    item.command = clickCommand(snap.provider, settings.statusBarClickAction);
    this.applyBackground(item, [snap], settings);
    item.show();
  }

  private applyBackground(
    item: vscode.StatusBarItem,
    snaps: Array<ProviderSnapshot | undefined>,
    settings: DualUsageSettings
  ): void {
    const live = snaps.filter((s): s is ProviderSnapshot => !!s);
    if (live.some(isLimitHit)) {
      item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      return;
    }
    const warn = live.some((s) =>
      shouldWarn(s, warnPercentFor(s.provider, settings), settings.creditsWarnBalance)
    );
    item.backgroundColor = warn
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  }

  dispose(): void {
    this.claudeItem.dispose();
    this.chatgptItem.dispose();
    this.cursorItem.dispose();
    this.compactItem.dispose();
  }
}

function formatAge(capturedAtMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) {
    return "never";
  }
  const sec = Math.max(0, Math.round((nowMs - capturedAtMs) / 1000));
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hours = Math.floor(min / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function buildTooltip(snap: ProviderSnapshot): vscode.MarkdownString {
  const title = providerTitle(snap.provider);
  const lines: string[] = [`**${title} account usage**`, ""];
  if (snap.planType) {
    lines.push(`Plan: \`${snap.planType}\``);
  }
  if (snap.email) {
    lines.push(`Account: ${snap.email}`);
  }
  if (snap.status !== "ok") {
    lines.push(`Status: ${snap.status}${snap.error ? ` — ${snap.error}` : ""}`);
  } else if (snap.error) {
    lines.push(`$(warning) Last refresh failed: ${snap.error}`);
  }
  for (const w of snap.windows) {
    const cd = formatCountdown(w.resetsAt);
    lines.push(
      `${windowLabel(w.windowSeconds)}: \`${unicodeBar(w.usedPercent)}\` · resets ${formatResets(w)} (${cd})`
    );
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
    if (snap.monthly.source === "cursor_plan") {
      lines.push(
        `Plan remaining: \`${unicodeBar(snap.monthly.usedPercent)}\` ${formatCursorPlanRemaining(snap.monthly, { fractionDigits: 2 })} (of $${snap.monthly.limit.toFixed(2)})`
      );
    } else {
      lines.push(
        `Monthly: \`${unicodeBar(snap.monthly.usedPercent)}\` ($${snap.monthly.used.toFixed(2)} / $${snap.monthly.limit.toFixed(2)})`
      );
    }
  }
  if (snap.promoMessage) {
    lines.push(snap.promoMessage);
  }
  const flags: string[] = [];
  if (snap.cached) {
    flags.push("cached");
  }
  if (snap.stale) {
    flags.push("stale");
  }
  lines.push(
    "",
    `_source: ${snap.source} · updated ${formatAge(snap.capturedAt)}${flags.length ? ` (${flags.join(", ")})` : ""}_`,
    "",
    `[Refresh](command:dualusage.refresh${snap.provider === "claude" ? "Claude" : snap.provider === "chatgpt" ? "Chatgpt" : "Cursor"}) · [Open sidebar](command:dualusage.focusSidebar) · [Settings](command:dualusage.openSettings)`
  );
  const md = new vscode.MarkdownString(lines.join("\n"), true);
  md.isTrusted = {
    enabledCommands: [
      "dualusage.refreshClaude",
      "dualusage.refreshChatgpt",
      "dualusage.refreshCursor",
      "dualusage.refreshAll",
      "dualusage.focusSidebar",
      "dualusage.openSettings",
    ],
  };
  md.supportThemeIcons = true;
  return md;
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
  const md = new vscode.MarkdownString(parts.join("\n\n"), true);
  md.isTrusted = {
    enabledCommands: [
      "dualusage.refreshClaude",
      "dualusage.refreshChatgpt",
      "dualusage.refreshCursor",
      "dualusage.refreshAll",
      "dualusage.focusSidebar",
      "dualusage.openSettings",
    ],
  };
  md.supportThemeIcons = true;
  return md;
}
