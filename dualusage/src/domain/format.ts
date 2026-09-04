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
  const name = snap.provider === "claude" ? "Claude" : "GPT";
  return `${name} ${formatProviderBody(snap)}`;
}

export function formatCompactLine(claude?: ProviderSnapshot, chatgpt?: ProviderSnapshot): string {
  const bits: string[] = [];
  if (claude && claude.status !== "disabled") {
    bits.push(formatProviderLine(claude));
  }
  if (chatgpt && chatgpt.status !== "disabled") {
    bits.push(formatProviderLine(chatgpt));
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
