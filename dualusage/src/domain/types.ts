export type ProviderId = "claude" | "chatgpt" | "cursor";

export interface RateWindow {
  usedPercent: number;
  windowSeconds?: number;
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
  resetsAt?: number;
  source: "spend_control" | "monthly_usage_api" | "cursor_plan";
  enforcementMode?: string;
}

export type SnapshotStatus =
  | "ok"
  | "disabled"
  | "signed_out"
  | "api_key_only"
  | "cli_missing"
  | "error"
  | "polling";

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
  capturedAt: number;
  status: SnapshotStatus;
  error?: string;
  /** Shown from globalState before the first live poll completes. */
  cached?: boolean;
  /** True when capturedAt is older than 2× that provider's poll interval. */
  stale?: boolean;
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
  pollIntervalMinutes: number;
  /** 0 = use global pollIntervalMinutes. */
  claudePollIntervalMinutes: number;
  chatgptPollIntervalMinutes: number;
  cursorPollIntervalMinutes: number;
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
