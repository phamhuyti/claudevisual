import { FlexibleCredits, MonthlySpend, ProviderSnapshot, RateWindow } from "./types";

/** Human label for a rolling window duration (seconds). */
export function windowLabel(windowSeconds: number | undefined): string {
  if (windowSeconds === undefined || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return "?";
  }
  const hours = windowSeconds / 3600;
  if (Math.abs(hours - 3) < 0.6) {
    return "3h";
  }
  if (Math.abs(hours - 5) < 0.6) {
    return "5h";
  }
  if (Math.abs(hours - 24) < 1) {
    return "24h";
  }
  const days = windowSeconds / 86400;
  if (Math.abs(days - 7) < 0.3) {
    return "7d";
  }
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h}h`;
  }
  const d = Math.round(days);
  return `${d}d`;
}

/** Format one rate window for status-bar text. */
export function formatWindowShort(w: RateWindow): string {
  return `${windowLabel(w.windowSeconds)} ${Math.round(w.usedPercent)}%`;
}

function formatCreditsShort(credits: FlexibleCredits | undefined): string | undefined {
  if (!credits) {
    return undefined;
  }
  if (credits.unlimited) {
    return "credits ∞";
  }
  if (credits.hasCredits && credits.balance) {
    const raw = credits.balance.trim();
    if (!raw) {
      return undefined;
    }
    return raw.startsWith("$") ? raw : `$${raw}`;
  }
  return undefined;
}

function formatMonthlyShort(monthly: MonthlySpend | undefined): string | undefined {
  if (!monthly) {
    return undefined;
  }
  if (monthly.source === "cursor_plan") {
    return `$${monthly.used.toFixed(0)}/$${monthly.limit.toFixed(0)} (${Math.round(monthly.usedPercent)}%)`;
  }
  return `monthly ${Math.round(monthly.usedPercent)}%`;
}

/** Compact one-line status text for a provider (without the provider name prefix). */
export function formatProviderBody(snap: ProviderSnapshot): string {
  if (snap.status === "disabled") {
    return "off";
  }
  if (snap.status === "polling" && snap.windows.length === 0) {
    return "…";
  }
  if (snap.status === "signed_out") {
    return "sign in";
  }
  if (snap.status === "api_key_only") {
    return "ChatGPT login";
  }
  if (snap.status === "cli_missing") {
    return "cli n/a";
  }
  if (snap.status === "error" && snap.windows.length === 0 && !snap.credits && !snap.monthly) {
    return "n/a";
  }

  const parts: string[] = [];
  for (const w of snap.windows) {
    parts.push(formatWindowShort(w));
  }
  const credits = formatCreditsShort(snap.credits);
  if (credits) {
    parts.push(credits);
  }
  const monthly = formatMonthlyShort(snap.monthly);
  if (monthly) {
    parts.push(monthly);
  }
  if (parts.length === 0) {
    return snap.status === "ok" ? "no data" : "…";
  }
  return parts.join(" · ");
}

export function formatProviderLine(snap: ProviderSnapshot): string {
  const name =
    snap.provider === "claude" ? "Claude" : snap.provider === "chatgpt" ? "GPT" : "Cursor";
  return `${name} ${formatProviderBody(snap)}`;
}

export function formatCompactLine(
  claude?: ProviderSnapshot,
  chatgpt?: ProviderSnapshot,
  cursor?: ProviderSnapshot
): string {
  const bits: string[] = [];
  if (claude && claude.status !== "disabled") {
    bits.push(formatProviderLine(claude));
  }
  if (chatgpt && chatgpt.status !== "disabled") {
    bits.push(formatProviderLine(chatgpt));
  }
  if (cursor && cursor.status !== "disabled") {
    bits.push(formatProviderLine(cursor));
  }
  return bits.join(" | ") || "DualUsage";
}

export function parseBalanceNumber(balance: string | undefined): number | undefined {
  if (!balance) {
    return undefined;
  }
  const n = Number(balance.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function shouldWarn(
  snap: ProviderSnapshot,
  warnPercent: number,
  creditsWarnBalance: number
): boolean {
  if (snap.status === "disabled") {
    return false;
  }
  if (snap.limitReached || snap.spendControlReached || snap.credits?.overageLimitReached) {
    return true;
  }
  for (const w of snap.windows) {
    if (w.usedPercent >= warnPercent) {
      return true;
    }
  }
  if (snap.monthly && snap.monthly.usedPercent >= warnPercent) {
    return true;
  }
  if (snap.credits?.hasCredits && !snap.credits.unlimited) {
    const bal = parseBalanceNumber(snap.credits.balance);
    if (bal !== undefined && bal < creditsWarnBalance) {
      return true;
    }
  }
  return false;
}

export function formatResets(w: RateWindow): string {
  if (w.resetsLabel) {
    return w.resetsLabel;
  }
  if (w.resetsAt === undefined) {
    return "—";
  }
  try {
    return new Date(w.resetsAt * 1000).toLocaleString();
  } catch {
    return "—";
  }
}

export type Severity = "ok" | "warn" | "crit";

/** Map a used% against warnPercent into ok / warn / crit. */
export function severityForPercent(usedPercent: number, warnPercent: number): Severity {
  if (usedPercent >= 100 || usedPercent >= warnPercent) {
    return "crit";
  }
  if (usedPercent >= Math.max(0, warnPercent - 15)) {
    return "warn";
  }
  return "ok";
}

/**
 * Relative countdown from a unix-seconds reset timestamp.
 * Returns e.g. "2h 14m", "45m", "just now", or "—" when unknown.
 */
export function formatCountdown(resetsAtSeconds: number | undefined, nowMs = Date.now()): string {
  if (resetsAtSeconds === undefined || !Number.isFinite(resetsAtSeconds)) {
    return "—";
  }
  const ms = resetsAtSeconds * 1000 - nowMs;
  if (ms <= 0) {
    return "now";
  }
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) {
    return "<1m";
  }
  if (totalMin < 60) {
    return `${totalMin}m`;
  }
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Pace marker position (0–100): how far through the rolling window we are,
 * derived from resetsAt + windowSeconds. Undefined when inputs are incomplete.
 */
export function pacePercent(
  windowSeconds: number | undefined,
  resetsAtSeconds: number | undefined,
  nowMs = Date.now()
): number | undefined {
  if (
    windowSeconds === undefined ||
    resetsAtSeconds === undefined ||
    !Number.isFinite(windowSeconds) ||
    windowSeconds <= 0 ||
    !Number.isFinite(resetsAtSeconds)
  ) {
    return undefined;
  }
  const elapsed = windowSeconds - (resetsAtSeconds * 1000 - nowMs) / 1000;
  const pct = (elapsed / windowSeconds) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Unicode meter for tooltips, e.g. ▰▰▰▰▰▱▱▱▱▱ 52%. */
export function unicodeBar(usedPercent: number, width = 10): string {
  const clamped = Math.min(100, Math.max(0, usedPercent));
  const filled = Math.round((clamped / 100) * width);
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)} ${Math.round(clamped)}%`;
}

export function isLimitHit(snap: ProviderSnapshot): boolean {
  return !!(
    snap.limitReached ||
    snap.spendControlReached ||
    snap.credits?.overageLimitReached ||
    snap.windows.some((w) => w.usedPercent >= 100) ||
    (snap.monthly && snap.monthly.usedPercent >= 100)
  );
}

/** Worst used% across windows + monthly, for collapsed glance rows. */
export function worstUsedPercent(snap: ProviderSnapshot): number | undefined {
  let worst: number | undefined;
  for (const w of snap.windows) {
    if (worst === undefined || w.usedPercent > worst) {
      worst = w.usedPercent;
    }
  }
  if (snap.monthly && (worst === undefined || snap.monthly.usedPercent > worst)) {
    worst = snap.monthly.usedPercent;
  }
  if (snap.codeReview && (worst === undefined || snap.codeReview.usedPercent > worst)) {
    worst = snap.codeReview.usedPercent;
  }
  return worst;
}

/** Soonest resetsAt among windows/monthly, for collapsed glance countdown. */
export function soonestResetsAt(snap: ProviderSnapshot): number | undefined {
  let soonest: number | undefined;
  for (const w of snap.windows) {
    if (w.resetsAt !== undefined && (soonest === undefined || w.resetsAt < soonest)) {
      soonest = w.resetsAt;
    }
  }
  if (
    snap.monthly?.resetsAt !== undefined &&
    (soonest === undefined || snap.monthly.resetsAt < soonest)
  ) {
    soonest = snap.monthly.resetsAt;
  }
  return soonest;
}
