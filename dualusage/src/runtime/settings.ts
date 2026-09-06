import * as vscode from "vscode";
import { DualUsageSettings, isProviderId, PROVIDER_IDS, ProviderId } from "../domain/types";

export type { DualUsageSettings };

export const DEFAULT_POLL_SECONDS = 60;
export const MIN_POLL_SECONDS = 5;

/** Settings whose change requires the orchestrator to re-plan / re-poll. */
export const POLLING_SETTING_KEYS: readonly string[] = [
  "dualusage.pollIntervalSeconds",
  "dualusage.pollIntervalMinutes",
  "dualusage.claudePath",
  "dualusage.codexHome",
  "dualusage.cursorDataPath",
  "dualusage.chatgpt.source",
  ...PROVIDER_IDS.flatMap((id) => [
    `dualusage.providers.${id}.enabled`,
    `dualusage.providers.${id}.pollIntervalSeconds`,
    `dualusage.providers.${id}.pollIntervalMinutes`,
  ]),
];

export function affectsPolling(e: vscode.ConfigurationChangeEvent): boolean {
  return POLLING_SETTING_KEYS.some((key) => e.affectsConfiguration(key));
}

export function readSettings(): DualUsageSettings {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  return {
    claudeEnabled: cfg.get<boolean>("providers.claude.enabled", false) === true,
    chatgptEnabled: cfg.get<boolean>("providers.chatgpt.enabled", false) === true,
    cursorEnabled: cfg.get<boolean>("providers.cursor.enabled", false) === true,
    providersOrder: normalizeOrder(cfg.get<string[]>("providers.order", [...PROVIDER_IDS])),
    pollIntervalSeconds: resolveGlobalPollSeconds(cfg),
    claudePollIntervalSeconds: resolveProviderPollSeconds(cfg, "claude"),
    chatgptPollIntervalSeconds: resolveProviderPollSeconds(cfg, "chatgpt"),
    cursorPollIntervalSeconds: resolveProviderPollSeconds(cfg, "cursor"),
    warnPercent: numberSetting(cfg, "warnPercent", 90, { min: 1, max: 100 }),
    claudeWarnPercent: numberSetting(cfg, "providers.claude.warnPercent", 0, { min: 0, max: 100 }),
    chatgptWarnPercent: numberSetting(cfg, "providers.chatgpt.warnPercent", 0, {
      min: 0,
      max: 100,
    }),
    cursorWarnPercent: numberSetting(cfg, "providers.cursor.warnPercent", 0, { min: 0, max: 100 }),
    creditsWarnBalance: numberSetting(cfg, "creditsWarnBalance", 1, { min: 0 }),
    claudePath: stringSetting(cfg, "claudePath"),
    codexHome: stringSetting(cfg, "codexHome"),
    cursorDataPath: stringSetting(cfg, "cursorDataPath"),
    chatgptSource: enumSetting(cfg, "chatgpt.source", ["auto", "api", "rollout"], "auto"),
    statusBarStyle: enumSetting(cfg, "statusBar.style", ["split", "compact", "ultra"], "split"),
    statusBarShowWindows: cfg.get<boolean>("statusBar.showWindows", true) !== false,
    statusBarShowCredits: cfg.get<boolean>("statusBar.showCredits", true) !== false,
    statusBarShowMonthly: cfg.get<boolean>("statusBar.showMonthly", true) !== false,
    statusBarClickAction: enumSetting(
      cfg,
      "statusBar.clickAction",
      ["refresh", "openSidebar", "openSettings"],
      "refresh"
    ),
    notificationsEnabled: cfg.get<boolean>("notifications.enabled", true) !== false,
    notificationsPercent: numberSetting(cfg, "notifications.percent", 0, { min: 0, max: 100 }),
    debug: cfg.get<boolean>("debug", false) === true,
  };
}

export function warnPercentFor(id: ProviderId, settings = readSettings()): number {
  const per =
    id === "claude"
      ? settings.claudeWarnPercent
      : id === "chatgpt"
        ? settings.chatgptWarnPercent
        : settings.cursorWarnPercent;
  return per > 0 ? per : settings.warnPercent;
}

export function pollIntervalSecondsFor(id: ProviderId, settings = readSettings()): number {
  const per =
    id === "claude"
      ? settings.claudePollIntervalSeconds
      : id === "chatgpt"
        ? settings.chatgptPollIntervalSeconds
        : settings.cursorPollIntervalSeconds;
  const seconds = per > 0 ? per : settings.pollIntervalSeconds;
  return Math.max(MIN_POLL_SECONDS, seconds);
}

/** Coerce a possibly non-numeric user value; fall back to `def` when not finite. */
function numberSetting(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  def: number,
  range: { min?: number; max?: number } = {}
): number {
  const raw = cfg.get<unknown>(key, def);
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) {
    return def;
  }
  let v = n;
  if (range.min !== undefined) {
    v = Math.max(range.min, v);
  }
  if (range.max !== undefined) {
    v = Math.min(range.max, v);
  }
  return v;
}

function stringSetting(cfg: vscode.WorkspaceConfiguration, key: string): string {
  const raw = cfg.get<unknown>(key, "");
  return typeof raw === "string" ? raw : "";
}

function enumSetting<T extends string>(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  allowed: readonly T[],
  def: T
): T {
  const raw = cfg.get<unknown>(key, def);
  return allowed.includes(raw as T) ? (raw as T) : def;
}

function isUserSet(cfg: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = cfg.inspect(key);
  if (!inspected) {
    return false;
  }
  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined
  );
}

/** Convert a legacy global `pollIntervalMinutes` value to seconds (≥ MIN). */
export function legacyGlobalMinutesToSeconds(minutes: unknown): number {
  const m = typeof minutes === "number" ? minutes : Number(minutes);
  if (!Number.isFinite(m) || m <= 0) {
    return DEFAULT_POLL_SECONDS;
  }
  return Math.max(MIN_POLL_SECONDS, Math.round(m * 60));
}

/** Convert a legacy per-provider `pollIntervalMinutes` (0 = inherit) to seconds. */
export function legacyProviderMinutesToSeconds(minutes: unknown): number {
  const m = typeof minutes === "number" ? minutes : Number(minutes);
  if (!Number.isFinite(m) || m <= 0) {
    return 0;
  }
  return Math.max(MIN_POLL_SECONDS, Math.round(m * 60));
}

function resolveGlobalPollSeconds(cfg: vscode.WorkspaceConfiguration): number {
  if (isUserSet(cfg, "pollIntervalSeconds")) {
    return numberSetting(cfg, "pollIntervalSeconds", DEFAULT_POLL_SECONDS, {
      min: MIN_POLL_SECONDS,
    });
  }
  // Read-side fallback for users whose legacy value has not been migrated yet.
  if (isUserSet(cfg, "pollIntervalMinutes")) {
    return legacyGlobalMinutesToSeconds(cfg.get<unknown>("pollIntervalMinutes"));
  }
  return DEFAULT_POLL_SECONDS;
}

/** 0 = inherit global; any positive value is clamped to MIN_POLL_SECONDS. */
function resolveProviderPollSeconds(
  cfg: vscode.WorkspaceConfiguration,
  provider: ProviderId
): number {
  const secKey = `providers.${provider}.pollIntervalSeconds`;
  if (isUserSet(cfg, secKey)) {
    const v = numberSetting(cfg, secKey, 0, { min: 0 });
    return v > 0 ? Math.max(MIN_POLL_SECONDS, v) : 0;
  }
  const minKey = `providers.${provider}.pollIntervalMinutes`;
  if (isUserSet(cfg, minKey)) {
    return legacyProviderMinutesToSeconds(cfg.get<unknown>(minKey));
  }
  return 0;
}

function normalizeOrder(raw: unknown): ProviderId[] {
  const seen = new Set<ProviderId>();
  const out: ProviderId[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (isProviderId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of PROVIDER_IDS) {
    if (!seen.has(id)) {
      out.push(id);
    }
  }
  return out;
}

interface LegacyMigration {
  legacyKey: string;
  newKey: string;
  convert: (minutes: unknown) => number;
}

const LEGACY_MIGRATIONS: readonly LegacyMigration[] = [
  {
    legacyKey: "pollIntervalMinutes",
    newKey: "pollIntervalSeconds",
    convert: legacyGlobalMinutesToSeconds,
  },
  ...PROVIDER_IDS.map((id) => ({
    legacyKey: `providers.${id}.pollIntervalMinutes`,
    newKey: `providers.${id}.pollIntervalSeconds`,
    convert: legacyProviderMinutesToSeconds,
  })),
];

type InspectResult = NonNullable<ReturnType<vscode.WorkspaceConfiguration["inspect"]>>;

const SCOPES: ReadonlyArray<{
  target: vscode.ConfigurationTarget;
  pick: (info: InspectResult) => unknown;
}> = [
  { target: vscode.ConfigurationTarget.Global, pick: (i) => i.globalValue },
  { target: vscode.ConfigurationTarget.Workspace, pick: (i) => i.workspaceValue },
  { target: vscode.ConfigurationTarget.WorkspaceFolder, pick: (i) => i.workspaceFolderValue },
];

/**
 * One-time write migration: copy each legacy `*.pollIntervalMinutes` value to
 * `*.pollIntervalSeconds` in the scope that holds it (unless seconds is already
 * set there) and remove the legacy key so it stops overriding the new default.
 * Failures are per-scope and non-fatal (e.g. no workspace open).
 */
export async function migrateLegacySettings(): Promise<string[]> {
  const cfg = vscode.workspace.getConfiguration("dualusage");
  const migrated: string[] = [];
  for (const m of LEGACY_MIGRATIONS) {
    const legacy = cfg.inspect<unknown>(m.legacyKey);
    if (!legacy) {
      continue;
    }
    const next = cfg.inspect<unknown>(m.newKey);
    for (const scope of SCOPES) {
      const legacyValue = scope.pick(legacy);
      if (legacyValue === undefined) {
        continue;
      }
      try {
        if (next === undefined || scope.pick(next) === undefined) {
          await cfg.update(m.newKey, m.convert(legacyValue), scope.target);
        }
        await cfg.update(m.legacyKey, undefined, scope.target);
        migrated.push(`${m.legacyKey}@${scope.target}`);
      } catch {
        // Scope not writable (e.g. no workspace); the read-side fallback still applies.
      }
    }
  }
  return migrated;
}
