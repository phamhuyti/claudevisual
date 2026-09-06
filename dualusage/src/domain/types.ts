export type ProviderId = "claude" | "chatgpt" | "cursor";

export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "chatgpt", "cursor"];

export function isProviderId(value: unknown): value is ProviderId {
  return value === "claude" || value === "chatgpt" || value === "cursor";
}

export interface RateWindow {
  usedPercent: number;
  windowSeconds?: number;
  /** Unix time in **seconds** (unlike `ProviderSnapshot.capturedAt`, which is ms). */
  resetsAt?: number;
  resetsLabel?: string;
}

export interface FlexibleCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
  overageLimitReached?: boolean;
}

export interface MonthlySpend {
  limit: number;
  used: number;
  remaining?: number;
  usedPercent: number;
  /** Unix time in **seconds**. */
  resetsAt?: number;
  source: "spend_control" | "monthly_usage_api" | "cursor_plan";
  enforcementMode?: string;
}

export type SnapshotStatus =
  "ok" | "disabled" | "signed_out" | "api_key_only" | "cli_missing" | "error" | "polling";

export interface ProviderSnapshot {
  provider: ProviderId;
  planType?: string;
  email?: string;
  windows: RateWindow[];
  codeReview?: RateWindow;
  credits?: FlexibleCredits;
  monthly?: MonthlySpend;
  allowed?: boolean;
  limitReached?: boolean;
  spendControlReached?: boolean;
  promoMessage?: string;
  resetCreditsAvailable?: number;
  source: "cli" | "api" | "rollout";
  /** Unix time in **milliseconds** when this data was captured. */
  capturedAt: number;
  status: SnapshotStatus;
  /**
   * Last fetch error. May be present alongside `status: "ok"` when a refresh
   * failed and the previous good numbers were kept.
   */
  error?: string;
  /** Shown from globalState before the first live poll completes. */
  cached?: boolean;
  /** True when capturedAt is older than 2× that provider's poll interval. */
  stale?: boolean;
  /** A fetch for this provider is in flight (transient, never persisted). */
  refreshing?: boolean;
}

export interface AppState {
  claude?: ProviderSnapshot;
  chatgpt?: ProviderSnapshot;
  cursor?: ProviderSnapshot;
}

/** One sparkline sample — worst used% per provider at time `t` (ms). */
export interface HistoryPoint {
  t: number;
  claude?: number;
  chatgpt?: number;
  cursor?: number;
}

export interface HistoryState {
  points: HistoryPoint[];
}

export interface DualUsageSettings {
  claudeEnabled: boolean;
  chatgptEnabled: boolean;
  cursorEnabled: boolean;
  providersOrder: ProviderId[];
  pollIntervalSeconds: number;
  /** 0 = use global pollIntervalSeconds. */
  claudePollIntervalSeconds: number;
  chatgptPollIntervalSeconds: number;
  cursorPollIntervalSeconds: number;
  warnPercent: number;
  /** 0 = use global warnPercent. */
  claudeWarnPercent: number;
  chatgptWarnPercent: number;
  cursorWarnPercent: number;
  creditsWarnBalance: number;
  claudePath: string;
  codexHome: string;
  cursorDataPath: string;
  chatgptSource: "auto" | "api" | "rollout";
  statusBarStyle: "split" | "compact" | "ultra";
  statusBarShowWindows: boolean;
  statusBarShowCredits: boolean;
  statusBarShowMonthly: boolean;
  statusBarClickAction: "refresh" | "openSidebar" | "openSettings";
  notificationsEnabled: boolean;
  notificationsPercent: number;
  debug: boolean;
}
