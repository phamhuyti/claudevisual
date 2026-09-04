import {
  FlexibleCredits,
  MonthlySpend,
  ProviderSnapshot,
  RateWindow,
} from "../../domain/types";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
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

function centsToUsd(cents: number): number {
  return cents / 100;
}

function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

function msToUnixSeconds(ms: number | undefined): number | undefined {
  if (ms === undefined || !Number.isFinite(ms)) {
    return undefined;
  }
  // Accept already-seconds values (< year 2100 in seconds ≈ 4e9).
  if (ms < 1e12) {
    return Math.floor(ms);
  }
  return Math.floor(ms / 1000);
}

/**
 * Map Cursor GetCurrentPeriodUsage (+ optional plan info) into DualUsage snapshot fields.
 */
export function parseCursorPeriodUsage(
  payload: unknown,
  opts?: { planName?: string; email?: string; membershipType?: string }
): Omit<ProviderSnapshot, "provider" | "capturedAt" | "status" | "source"> {
  const root = asRecord(payload) ?? {};
  const planUsage = asRecord(root.planUsage);
  const spendLimit = asRecord(root.spendLimitUsage);

  const billingStartMs = asNumber(root.billingCycleStart);
  const billingEndMs = asNumber(root.billingCycleEnd);
  const resetsAt = msToUnixSeconds(billingEndMs);

  let windowSeconds: number | undefined;
  if (
    billingStartMs !== undefined &&
    billingEndMs !== undefined &&
    billingEndMs > billingStartMs
  ) {
    windowSeconds = Math.max(1, Math.round((billingEndMs - billingStartMs) / 1000));
  }

  const windows: RateWindow[] = [];
  let monthly: MonthlySpend | undefined;
  let limitReached = false;

  if (planUsage) {
    const limitCents = asNumber(planUsage.limit);
    const includedSpend = asNumber(planUsage.includedSpend);
    const totalSpend = asNumber(planUsage.totalSpend);
    const usedCents =
      includedSpend !== undefined
        ? includedSpend
        : totalSpend !== undefined
          ? totalSpend
          : undefined;
    const totalPct = asNumber(planUsage.totalPercentUsed);
    const apiPct = asNumber(planUsage.apiPercentUsed);

    let usedPercent: number | undefined;
    if (limitCents !== undefined && limitCents > 0 && usedCents !== undefined) {
      usedPercent = (usedCents / limitCents) * 100;
    } else if (totalPct !== undefined) {
      usedPercent = totalPct;
    } else if (apiPct !== undefined) {
      usedPercent = apiPct;
    }

    if (usedPercent !== undefined) {
      usedPercent = Math.min(100, Math.max(0, usedPercent));
      limitReached = usedPercent >= 100;
    }

    if (limitCents !== undefined && limitCents > 0 && usedCents !== undefined) {
      const limit = centsToUsd(limitCents);
      const used = centsToUsd(usedCents);
      const pct =
        usedPercent ?? Math.min(100, Math.max(0, (used / limit) * 100));
      monthly = {
        limit,
        used,
        remaining:
          asNumber(planUsage.remaining) !== undefined
            ? centsToUsd(asNumber(planUsage.remaining)!)
            : Math.max(0, limit - used),
        usedPercent: pct,
        resetsAt,
        source: "cursor_plan",
      };
    } else if (usedPercent !== undefined) {
      windows.push({
        usedPercent,
        windowSeconds,
        resetsAt,
      });
    }
  }

  let credits: FlexibleCredits | undefined;
  if (spendLimit) {
    const individualRemaining = asNumber(spendLimit.individualRemaining);
    const individualLimit = asNumber(spendLimit.individualLimit);
    const pooledRemaining = asNumber(spendLimit.pooledRemaining);
    const remainingCents =
      individualRemaining !== undefined
        ? individualRemaining
        : pooledRemaining !== undefined
          ? pooledRemaining
          : undefined;
    if (remainingCents !== undefined || individualLimit !== undefined) {
      const hasCredits =
        (remainingCents !== undefined && remainingCents > 0) ||
        (individualLimit !== undefined && individualLimit > 0);
      credits = {
        hasCredits,
        unlimited: false,
        balance:
          remainingCents !== undefined ? formatUsd(centsToUsd(remainingCents)) : undefined,
        overageLimitReached:
          individualLimit !== undefined &&
          individualLimit > 0 &&
          asNumber(spendLimit.individualUsed) !== undefined &&
          (asNumber(spendLimit.individualUsed) ?? 0) >= individualLimit
            ? true
            : undefined,
      };
    }
  }

  const planFromPayload = asString(asRecord(root.planInfo)?.planName);
  const planType =
    opts?.planName ||
    planFromPayload ||
    opts?.membershipType ||
    undefined;

  const displayMessage = asString(root.displayMessage);

  return {
    planType,
    email: opts?.email,
    windows,
    credits,
    monthly,
    limitReached: limitReached || undefined,
    promoMessage: displayMessage,
  };
}

export function parseCursorPlanInfo(payload: unknown): string | undefined {
  const root = asRecord(payload);
  const info = asRecord(root?.planInfo);
  return asString(info?.planName);
}
