import { FlexibleCredits, MonthlySpend, ProviderSnapshot, RateWindow } from "../../domain/types";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function windowFromJson(win: unknown): RateWindow | undefined {
  const o = asRecord(win);
  if (!o) {
    return undefined;
  }
  const used = asNumber(o.used_percent);
  if (used === undefined) {
    return undefined;
  }
  const secs = asNumber(o.limit_window_seconds);
  const resetsAt = asNumber(o.reset_at);
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    windowSeconds: secs !== undefined && secs > 0 ? secs : undefined,
    resetsAt: resetsAt !== undefined ? Math.floor(resetsAt) : undefined,
  };
}

function parseCredits(raw: unknown): FlexibleCredits | undefined {
  const o = asRecord(raw);
  if (!o || o.has_credits === undefined) {
    return undefined;
  }
  const hasCredits = Boolean(o.has_credits);
  const unlimited = Boolean(o.unlimited);
  const balanceRaw = o.balance;
  const balance =
    hasCredits &&
    balanceRaw !== null &&
    balanceRaw !== undefined &&
    String(balanceRaw).trim() !== ""
      ? String(balanceRaw)
      : undefined;
  return {
    hasCredits,
    unlimited,
    balance,
    overageLimitReached: asBool(o.overage_limit_reached) ?? undefined,
  };
}

export function parseMonthlyFromSpendControl(raw: unknown): MonthlySpend | undefined {
  const spend = asRecord(raw);
  if (!spend) {
    return undefined;
  }
  const lim = asRecord(spend.individual_limit);
  if (!lim) {
    return undefined;
  }
  const limit = asNumber(lim.limit);
  const used = asNumber(lim.used);
  if (limit === undefined || used === undefined || limit <= 0) {
    return undefined;
  }
  const usedPercent =
    asNumber(lim.used_percent) ?? Math.min(100, Math.max(0, (used / limit) * 100));
  const remaining = asNumber(lim.remaining);
  const resetsAt = asNumber(lim.reset_at);
  return {
    limit,
    used,
    remaining,
    usedPercent,
    resetsAt: resetsAt !== undefined ? Math.floor(resetsAt) : undefined,
    source: "spend_control",
    enforcementMode: asString(lim.enforcement_mode) ?? asString(lim.source),
  };
}

export function parseMonthlyUsageApi(payload: unknown): MonthlySpend | undefined {
  const o = asRecord(payload);
  if (!o) {
    return undefined;
  }
  const used = asNumber(o.current_month_usage);
  const eff = asRecord(o.effective_monthly_limit);
  const limit = eff ? asNumber(eff.limit) : undefined;
  if (used === undefined || limit === undefined || limit <= 0) {
    return undefined;
  }
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    usedPercent: Math.min(100, Math.max(0, (used / limit) * 100)),
    source: "monthly_usage_api",
    enforcementMode: asString(eff?.enforcement_mode),
  };
}

export function needsMonthlyFallback(
  planType: string | undefined,
  monthly: MonthlySpend | undefined,
  credits: FlexibleCredits | undefined
): boolean {
  if (monthly) {
    return false;
  }
  if (credits?.hasCredits && credits.balance) {
    return false;
  }
  const plan = (planType ?? "").toLowerCase();
  return plan === "team" || plan === "education" || plan === "enterprise" || plan === "edu";
}

/**
 * Parse GET /backend-api/wham/usage JSON into a partial snapshot (status filled by caller).
 */
export function parseWhamUsagePayload(payload: unknown): Omit<
  ProviderSnapshot,
  "provider" | "capturedAt" | "status" | "source"
> & {
  spendControlReached?: boolean;
} {
  const root = asRecord(payload) ?? {};
  const rate = asRecord(root.rate_limit) ?? {};
  const windows: RateWindow[] = [];
  const primary = windowFromJson(rate.primary_window);
  const secondary = windowFromJson(rate.secondary_window);
  if (primary) {
    windows.push(primary);
  }
  if (secondary) {
    windows.push(secondary);
  }
  windows.sort((a, b) => (a.windowSeconds ?? 0) - (b.windowSeconds ?? 0));

  const credits = parseCredits(root.credits);
  const monthly = parseMonthlyFromSpendControl(root.spend_control);
  const spend = asRecord(root.spend_control);

  let promoMessage: string | undefined;
  const promo = root.promo;
  if (typeof promo === "string") {
    promoMessage = promo.trim() || undefined;
  } else {
    const po = asRecord(promo);
    const msg = po ? asString(po.message) : undefined;
    promoMessage = msg?.trim() || undefined;
  }

  const resetCredits = asRecord(root.rate_limit_reset_credits);
  const resetCreditsAvailable = resetCredits
    ? (asNumber(resetCredits.applicable_available_count) ?? asNumber(resetCredits.available_count))
    : undefined;

  const codeReview =
    windowFromJson(root.code_review_rate_limit) ??
    windowFromJson(asRecord(root.code_review_rate_limit)?.primary_window);

  return {
    planType: asString(root.plan_type),
    email: asString(root.email),
    windows,
    codeReview,
    credits,
    monthly,
    allowed: asBool(rate.allowed),
    limitReached: asBool(rate.limit_reached),
    spendControlReached: asBool(spend?.reached),
    promoMessage,
    resetCreditsAvailable,
  };
}
