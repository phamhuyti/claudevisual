// The advisor rule set. Each rule is a pure `(ctx) => Recommendation | null`:
// it inspects the derived `AdvisorContext` and either emits one recommendation or
// stays silent (null) when its condition doesn't hold. Rules never read raw
// `SessionState` — everything they need is pre-derived in the context, so they
// stay trivially unit-testable and independent of each other.

import { formatTokenCount } from "../session-display";
import { AdvisorContext, Recommendation } from "./advisor-types";
import { isSubscription } from "./advisor-config";

export type AdvisorRule = (ctx: AdvisorContext) => Recommendation | null;

function usageTotal(u: AdvisorContext["totalUsage"]): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
}

/** Context near/at the window limit — the most time-sensitive signal (a compaction
 *  is imminent and will silently drop detail). Precise or approximate both count;
 *  the `~` nuance is a display concern, not a reason to stay silent. */
const contextHealthRule: AdvisorRule = (ctx) => {
  if (ctx.contextPercent >= ctx.thresholds.contextCritPercent) {
    return {
      id: "context-critical",
      severity: "critical",
      category: "context",
      title: "Context almost full — wrap up or /compact now",
      detail: "You're near the model's window limit. Land the current change, then /compact or start a fresh session to avoid an auto-summary dropping detail mid-task.",
      metric: `${ctx.contextPercent}%`,
    };
  }
  if (ctx.contextPercent >= ctx.thresholds.contextWarnPercent) {
    return {
      id: "context-warn",
      severity: "warn",
      category: "context",
      title: "Context filling up",
      detail: "Consider finishing the current thread and compacting before the window forces an auto-summary.",
      metric: `${ctx.contextPercent}%`,
    };
  }
  return null;
};

/** Cache churn: writing far more cache than is being re-read means context is being
 *  re-sent instead of reused — cache-write is a premium bucket, so this is real money
 *  wasted. Gated on a creation floor so early sessions (naturally high ratio before
 *  reuse accrues) don't false-trip. */
const cacheChurnRule: AdvisorRule = (ctx) => {
  const created = ctx.totalUsage.cacheCreationInputTokens;
  const read = ctx.totalUsage.cacheReadInputTokens;
  if (created < ctx.thresholds.cacheChurnMinCreationTokens) {
    return null;
  }
  const ratio = created / Math.max(read, 1);
  if (ratio < ctx.thresholds.cacheChurnRatio) {
    return null;
  }
  const tail = isSubscription(ctx.plan)
    ? "Cache-write is a premium bucket that eats into your usage limit; batching edits later keeps more context cached."
    : "Cache-creation greatly outweighs cache-read — it's a premium bucket. Batching edits later keeps more context cached (cheaper).";
  return {
    id: "cache-churn",
    severity: "warn",
    category: "cache",
    title: "High cache churn — context is being re-written, not reused",
    detail: `Editing files early in a long session invalidates the prompt cache. ${tail}`,
    metric: `${ratio.toFixed(1)}× write:read`,
  };
};

/** Low overall cache reuse on a session with real spend — a softer, informational
 *  cousin of churn (fires even when the write:read ratio itself isn't extreme). */
const cacheEfficiencyRule: AdvisorRule = (ctx) => {
  if (ctx.economics.totalTokens < ctx.thresholds.cacheLowMinTotalTokens) {
    return null;
  }
  if (ctx.economics.cacheSavedPct >= ctx.thresholds.cacheLowSavedPct) {
    return null;
  }
  return {
    id: "cache-low-reuse",
    severity: "info",
    category: "cache",
    title: "Low cache reuse",
    detail: "Only a small share of tokens are cache reads. Keeping a stable prompt prefix (fewer early edits, fewer session restarts) lets more context stay warm.",
    metric: `${ctx.economics.cacheSavedPct}% reused`,
  };
};

/** Fresh (non-cached) tokens the model actually had to process new work on this
 *  turn set: input + output + cache-creation. Cache-read is deliberately excluded —
 *  it compounds every turn in any sufficiently long session regardless of workload
 *  type (each turn re-sends the full cached prefix), so folding it into the
 *  denominator drives output share toward zero for every long session and stops
 *  distinguishing genuinely read-heavy work from ordinary session length. */
function freshUsageTotal(u: AdvisorContext["mainUsage"]): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationInputTokens;
}

/** Model right-sizing (heuristic, conservative). A top-tier model that has done real
 *  work but generated very little output relative to the fresh context it processed
 *  likely didn't exercise the reasoning premium it costs — worth a "consider a lighter
 *  model" nudge. Phrased as a suggestion, never an assertion, to avoid punishing
 *  genuinely hard low-output work.
 *
 *  Measured on the MAIN agent's own usage only, not the session total. Delegated
 *  sub-agents run their own (often already-cheaper) models and do their own reading —
 *  folding their usage in here would judge Opus's fit by work Opus never did, and
 *  penalize exactly the "delegate research to cheap agents" pattern this advisor
 *  should be encouraging. */
const modelRightSizingRule: AdvisorRule = (ctx) => {
  if (!ctx.model || !ctx.model.toLowerCase().includes("opus")) {
    return null;
  }
  const fresh = freshUsageTotal(ctx.mainUsage);
  if (usageTotal(ctx.mainUsage) < ctx.thresholds.modelRightsizeMinTotalTokens) {
    return null;
  }
  const outputShare = ctx.mainUsage.outputTokens / Math.max(fresh, 1);
  if (outputShare > ctx.thresholds.modelRightsizeMaxOutputShare) {
    return null;
  }
  return {
    id: "model-rightsize",
    severity: "info",
    category: "model",
    title: "Consider a lighter model for this workload",
    detail: "The main agent is on Opus but has generated little output relative to the fresh context it's read directly (not counting delegated sub-agent work) — mostly reading/searching itself. Sonnet costs ~half and may suffice for read-heavy work; switch with /model.",
    metric: `${Math.round(outputShare * 100)}% output`,
  };
};

/** A single sub-agent that dominates the session's spend — flag for ROI review.
 *  Gated on BOTH an absolute token floor and a share of the session's total: large,
 *  deliberate fan-outs are fine even at high absolute token counts (a 500k-token
 *  agent is negligible in a 150M-token session), so only an agent that's genuinely
 *  the dominant cost center is worth surfacing. Even then, the copy stays hedged —
 *  token spend alone can't tell a narrow lookup that should've been a Grep/Read from
 *  legitimate large multi-step delegated work; only the user knows which it was. */
const subAgentCostRule: AdvisorRule = (ctx) => {
  const sessionTotal = ctx.economics.totalTokens;
  if (sessionTotal <= 0) {
    return null;
  }
  const expensive = ctx.economics.byAgent
    .filter(
      (a) =>
        a.agentId !== "main" &&
        a.tokens >= ctx.thresholds.subagentExpensiveTokens &&
        a.tokens / sessionTotal >= ctx.thresholds.subagentExpensiveShareOfSession
    )
    .sort((x, y) => y.tokens - x.tokens);
  if (expensive.length === 0) {
    return null;
  }
  const top = expensive[0];
  const pctOfSession = Math.round((top.tokens / sessionTotal) * 100);
  return {
    id: `subagent-expensive:${top.agentId}`,
    severity: "info",
    category: "orchestration",
    title: `Sub-agent dominates session spend: ${top.label}`,
    detail: "This sub-agent accounts for most of the session's spend. If it ran a narrow, single-purpose lookup, a direct Grep/Read would likely have been cheaper; if it carried out genuinely multi-step work, that's expected — worth a quick gut-check either way.",
    metric: `${formatTokenCount(top.tokens)} (${pctOfSession}% of session)`,
  };
};

/** Projected spend to the context limit, from the live burn rate. Purely
 *  informational planning signal; only meaningful with an active burn and headroom. */
const costProjectionRule: AdvisorRule = (ctx) => {
  if (!ctx.burnRatePerMin || ctx.burnRatePerMin < ctx.thresholds.costProjectionMinBurnPerMin) {
    return null;
  }
  const remaining = ctx.contextWindowTokens - ctx.contextUsedTokens;
  if (remaining <= 0) {
    return null;
  }
  const minutesLeft = remaining / ctx.burnRatePerMin;
  if (!isFinite(minutesLeft) || minutesLeft > 240) {
    return null; // plenty of runway — not worth surfacing
  }
  return {
    id: "cost-projection",
    severity: "info",
    category: "cost",
    title: "Approaching context limit at current pace",
    detail: "At the current token burn rate you'll reach the context window before long. Plan a natural stopping point or compaction.",
    metric: `~${Math.round(minutesLeft)} min left`,
  };
};

/** Repeated compaction = the window keeps overflowing. Compacting again loses more
 *  detail each time; splitting the work into a fresh session is usually better. */
const frequentCompactionRule: AdvisorRule = (ctx) => {
  if (ctx.compactionCount < ctx.thresholds.frequentCompactionCount) {
    return null;
  }
  return {
    id: "frequent-compaction",
    severity: "warn",
    category: "context",
    title: "Repeated compaction — context keeps overflowing",
    detail: "This session has compacted multiple times. Each compaction drops detail; consider splitting the remaining work into a fresh session instead of compacting again.",
    metric: `${ctx.compactionCount}× compacted`,
  };
};

/** A turn that stopped on `max_tokens` had its output truncated — usually a sign the
 *  ask was too big for one turn. */
const maxTokensStopRule: AdvisorRule = (ctx) => {
  if (ctx.lastStopReason !== "max_tokens") {
    return null;
  }
  return {
    id: "max-tokens-stop",
    severity: "info",
    category: "model",
    title: "A turn hit the output limit (truncated)",
    detail: "The last turn stopped at max_tokens, so its output was cut off. Breaking the request into smaller steps avoids wasted, incomplete generations.",
  };
};

/** Registry, in default emission order (engine re-sorts by severity afterwards). */
export const ADVISOR_RULES: AdvisorRule[] = [
  contextHealthRule,
  cacheChurnRule,
  cacheEfficiencyRule,
  frequentCompactionRule,
  modelRightSizingRule,
  maxTokensStopRule,
  subAgentCostRule,
  costProjectionRule,
];
