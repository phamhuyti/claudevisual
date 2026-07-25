// All tunable knobs for the advisor rules, in one place. `AdvisorThresholds` is the
// user-overridable subset (surfaced as `claudevisual.advisor.thresholds.*` settings);
// `DEFAULT_ADVISOR_THRESHOLDS` holds the dogfooded defaults, each with the reasoning
// behind its value so they can be re-tuned without hunting through rule logic.
// The score-mechanics constants below (weights, grade cutoffs, neutral floor) are
// internal to the scoring algorithm, not per-rule triggers, so they stay fixed.

/** Context-occupancy bands. Match the sidebar vitals meter (good/warn/crit) so the
 *  advisor and the context meter never disagree about "is this session in trouble".
 *  Only the advisor's own bands are user-configurable; the sidebar meter is a
 *  separate raw context% display and won't follow an override here. */
export interface AdvisorThresholds {
  contextWarnPercent: number;
  contextCritPercent: number;

  /** Cache churn: cache-creation tokens are billed at a premium over cache-read.
   *  A high creation:read ratio means context is being re-written instead of reused
   *  (waste). Only flag once creation passes a floor so tiny early sessions (where the
   *  ratio is naturally high before any reuse accrues) don't trip it. */
  cacheChurnRatio: number;
  cacheChurnMinCreationTokens: number;

  /** Cache efficiency: below this reuse rate on a session with real spend, the user is
   *  likely re-sending context they could keep warm. Info-level nudge, not a warning. */
  cacheLowSavedPct: number;
  cacheLowMinTotalTokens: number;

  /** A single sub-agent past this token spend AND past `subagentExpensiveShareOfSession`
   *  of the session's total is worth surfacing for ROI review. Both gates matter: the
   *  token floor stops a trivial agent in a tiny session from tripping the rule, and the
   *  share gate stops a legitimately huge (but proportionally small) delegated task in a
   *  long session from being flagged — a 500k-token agent is normal in a 150M-token
   *  session, not evidence of waste. */
  subagentExpensiveTokens: number;
  subagentExpensiveShareOfSession: number;

  /** Model right-sizing (heuristic, phrased "consider" — never asserted). Only consider
   *  a downgrade suggestion when the session is on a top-tier model, has done real work,
   *  and its output share is low (little generation → the reasoning premium wasn't used).
   *  Output share is measured against *fresh* tokens (input + output + cache-creation),
   *  excluding cache-read — cache-read compounds every turn in any long session regardless
   *  of workload type, so including it makes the ratio trend toward zero for every session
   *  and stops discriminating read-heavy from write-heavy work. */
  modelRightsizeMinTotalTokens: number;
  modelRightsizeMaxOutputShare: number;

  /** Cost projection only fires with a live burn rate and a known window with real
   *  headroom left — projecting from a stale/idle session would mislead. */
  costProjectionMinBurnPerMin: number;

  /** Repeated compaction means the context window keeps overflowing — a strong sign
   *  the session should be split rather than compacted again. One compaction is
   *  routine; this many is thrash. */
  frequentCompactionCount: number;
}

/** Defaults matching the common Claude Code session case; each overridable via the
 *  matching `claudevisual.advisor.thresholds.*` setting. */
export const DEFAULT_ADVISOR_THRESHOLDS: AdvisorThresholds = {
  contextWarnPercent: 75,
  contextCritPercent: 90,
  cacheChurnRatio: 1.5,
  cacheChurnMinCreationTokens: 50_000,
  cacheLowSavedPct: 25,
  cacheLowMinTotalTokens: 200_000,
  subagentExpensiveTokens: 500_000,
  subagentExpensiveShareOfSession: 0.15,
  modelRightsizeMinTotalTokens: 300_000,
  modelRightsizeMaxOutputShare: 0.08,
  costProjectionMinBurnPerMin: 1_000,
  frequentCompactionCount: 2,
};

/** Efficiency Score dimension weights (sum ~1.0). Context health and cache efficiency
 *  dominate because they're the most actionable, high-frequency levers. Internal to
 *  the scoring algorithm — not user-configurable. */
export const SCORE_WEIGHTS = {
  context: 0.35,
  cache: 0.3,
  model: 0.15,
  orchestration: 0.2,
} as const;

/** Score→grade cutoffs (inclusive lower bounds). */
export const GRADE_CUTOFFS: Array<{ min: number; grade: string }> = [
  { min: 90, grade: "A" },
  { min: 80, grade: "B" },
  { min: 70, grade: "C" },
  { min: 60, grade: "D" },
  { min: 0, grade: "F" },
];

/** Below this total spend a session hasn't done enough to score meaningfully —
 *  the score is rendered neutral rather than punishing a just-started session. */
export const SCORE_MIN_TOTAL_TOKENS = 20_000;
