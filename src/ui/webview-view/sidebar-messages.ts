// Host <-> sidebar-webview message contract. Kept free of any `vscode` or
// `core/*` runtime import (this file is bundled into the browser-context
// sidebar client too), so the view-model here is a plain serializable DTO —
// no Maps, Dates, or class instances cross the boundary.

/** Category a tool call is bucketed into, driving its color + icon in the feed. */
export type ToolCategory = "read" | "edit" | "bash" | "flow" | "agent" | "other";

/** One agent (sub-agent) as shown in the flat agent list. */
export interface AgentViewModel {
  agentId: string;
  type: string;
  status: "running" | "completed";
  tokens: number;
  colorIndex: number;
  model?: string;
  spawnReason?: string;
  /** Nesting depth in the reconstructed agent tree (0 = spawned by the main
   *  session). Drives the row's indentation. */
  depth: number;
  /** Count of this agent's observed tool calls — an honest activity proxy shown
   *  for running agents (there is no ground-truth progress signal). */
  calls: number;
  /** Elapsed time (ms) spanned by this agent's observed tool calls (first→last),
   *  or undefined when fewer than two are recorded. Shown for completed agents. */
  durationMs?: number;
  /** This agent's own tool calls + files, shown when its row is expanded. */
  detail: AgentDetailViewModel;
}

/** Per-agent drill-down payload (its own recent tool calls + files touched). */
export interface AgentDetailViewModel {
  calls: FeedItemViewModel[];
  files: FileViewModel[];
}

/** One agent's slice of the session token spend (economics stacked bar). */
export interface EconomicsAgentSlice {
  label: string;
  tokens: number;
  colorIndex: number;
}

/** Token spend grouped by model (economics per-model rollup). */
export interface EconomicsModelSlice {
  model: string;
  tokens: number;
}

/** Token + cache economics for a session. */
export interface EconomicsViewModel {
  totalTokens: number;
  cacheReadTokens: number;
  cacheSavedPct: number;
  byAgent: EconomicsAgentSlice[];
  byModel: EconomicsModelSlice[];
}

/** One bar in the Activity heartbeat chart. `colorIndex` drives its color
 *  (agent identity, matching the Orchestration tree); the rest is the
 *  hover-tooltip content — otherwise the chart would carry no information
 *  beyond "something happened, in this color". */
export interface HeartbeatSample {
  colorIndex: number;
  /** Agent identity label: "main", or the sub-agent's type. */
  label: string;
  tool: string;
  /** Raw epoch ms — drives the bar's real proportional position on the
   *  Activity timeline (a lull in activity reads as literal empty space,
   *  not just "the next dash in sequence"). */
  ts: number;
  /** Local `HH:MM:SS`, from the tool call's real transcript timestamp. */
  time: string;
}

/** One entry in the recent-activity feed. */
export interface FeedItemViewModel {
  name: string;
  detail?: string;
  category: ToolCategory;
  /** Local `HH:MM:SS`, from the tool call's real transcript timestamp. */
  time: string;
  /** `true` for `Agent` spawns — rendered with the dashed "spawn" treatment. */
  spawn: boolean;
}

/** One file the session touched, grouped by directory in the files panel. */
export interface FileViewModel {
  path: string;
  base: string;
  dir: string;
  access: "edit" | "read";
}

/** One advisor recommendation as shown in the sidebar (flat mirror of the core
 *  `Recommendation` — redefined here to keep this file core-import-free). */
export interface AdvisorRecommendationViewModel {
  id: string;
  severity: "critical" | "warn" | "info";
  category: "cost" | "context" | "cache" | "model" | "orchestration";
  title: string;
  detail?: string;
  metric?: string;
}

/** One axis of the Efficiency Score. */
export interface AdvisorDimensionViewModel {
  key: string;
  label: string;
  score: number;
}

/** The Advisor section payload: composite score + ranked recommendations, plus a
 *  plan-aware cost framing string (subscription proxy vs billed money). */
export interface AdvisorViewModel {
  score: number;
  grade: string;
  /** True when the session hasn't done enough to score — render muted. */
  neutral: boolean;
  dimensions: AdvisorDimensionViewModel[];
  recommendations: AdvisorRecommendationViewModel[];
  /** Preformatted cost figure (e.g. "≈ $1.20 est. API-equiv."), or undefined. */
  costDisplay?: string;
  costTooltip?: string;
}

/** Everything the sidebar renders for a single session. */
export interface SessionViewModel {
  sessionId: string;
  shortId: string;
  cwd: string;
  /** Claude Code's own auto-generated session title, or undefined until the
   *  first `ai-title` transcript line has been seen. */
  title?: string;
  /** `source` of the latest `SessionStart` hook event (`"startup" | "resume" |
   *  "clear" | "compact"`), when hooks are installed — otherwise undefined. */
  sessionStartSource?: string;
  /** For a just-`/clear`-ed, still-empty session, the title/shortId of the prior
   *  same-`cwd` session, for continuity. Undefined otherwise. */
  clearedFrom?: string;
  model?: string;
  running: boolean;
  live: boolean;
  contextPercent: number;
  contextPrecise: boolean;
  /** Current context occupancy (tokens) — the exact numerator when `contextPrecise`
   *  is true, else the JSONL-derived `lastTurnContextTokens` approximation. */
  contextUsedTokens: number;
  /** The denominator `contextPercent` was computed against (tokens). */
  contextWindowTokens: number;
  totalTokens: number;
  costUsd?: number;
  /** `true` when `costUsd` is a pricing-table estimate (statusline wrap absent),
   *  `false` when it's the precise statusline-derived cost. */
  costEstimated: boolean;
  /** Approximate token spend rate (tokens/min), or undefined when not yet
   *  measurable / the session is idle. Rendered as `~NK/min`, else `—`. */
  burnRatePerMin?: number;
  /** The main session as the orchestration tree's synthetic root node (its own
   *  model, main-only token spend, and recent activity). Present only when the
   *  session has spawned sub-agents; `agents` nest one level beneath it. */
  mainAgent?: AgentViewModel;
  /** Sub-agent rows in pre-order tree layout (parent before its nested
   *  children), each carrying its `depth` for indentation (0 = spawned by main;
   *  rendered one level deeper when `mainAgent` is the visible root). */
  agents: AgentViewModel[];
  economics: EconomicsViewModel;
  /** Efficiency Advisor: composite score + ranked cost/efficiency recommendations. */
  advisor: AdvisorViewModel;
  /** Activity heartbeat: one bar per recent tool call across main + every
   *  sub-agent, ordered oldest → newest. Empty when the session has no
   *  recorded tool calls yet. */
  heartbeat: HeartbeatSample[];
  feed: FeedItemViewModel[];
  files: FileViewModel[];
}

/** Account-wide rate limits shown in the sidebar header. Plain serializable
 *  mirror of the host-side `UsageSnapshot` (kept core-import-free like the rest
 *  of this file). Percentages are omitted until a `/usage` run has parsed. */
export interface LimitsViewModel {
  status: "disabled" | "idle" | "polling" | "ok" | "error";
  fiveHourPercent?: number;
  sevenDayPercent?: number;
  fiveHourResets?: string;
  sevenDayResets?: string;
  /** Percent at/above which a window renders in the warning color. */
  warnPercent: number;
  /** Short failure reason when `status === "error"`. */
  error?: string;
}

export interface SidebarViewModel {
  sessions: SessionViewModel[];
  /** Account-wide 5h/7d limits header. Undefined while the feature is off or
   *  before the first poller snapshot has reached the sidebar. */
  limits?: LimitsViewModel;
}

/** Host → client: the full current view-model (replaces prior render). */
export interface StateMessage {
  type: "state";
  vm: SidebarViewModel;
}

export type HostToSidebarMessage = StateMessage;

/** Client → host: the webview finished mounting and wants the current state. */
export interface ReadyMessage {
  type: "ready";
}

/** Client → host: an Advisor tip's "Copy" action was clicked — `text` is the
 *  prompt already formatted for pasting into a chat. */
export interface AdvisorTipActionMessage {
  type: "advisor-copy";
  text: string;
}

export type SidebarToHostMessage = ReadyMessage | AdvisorTipActionMessage;
