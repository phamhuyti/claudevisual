import * as vscode from "vscode";
import {
  AppState,
  HistoryPoint,
  HistoryState,
  PROVIDER_IDS,
  ProviderId,
  ProviderSnapshot,
  RateWindow,
  SnapshotStatus,
} from "../domain/types";
import { worstUsedPercent } from "../domain/format";

const STATE_KEY = "dualusage.lastAppState";
const HISTORY_KEY = "dualusage.usageHistory";
const STATE_VERSION = 1;

/** Sample at most once per 5 minutes; keep ~48h of points. */
export const HISTORY_SAMPLE_MS = 5 * 60_000;
export const HISTORY_RETENTION_MS = 48 * 60 * 60_000;

interface PersistedState {
  v: number;
  state: AppState;
}

const STATUSES: readonly SnapshotStatus[] = [
  "ok",
  "disabled",
  "signed_out",
  "api_key_only",
  "cli_missing",
  "error",
  "polling",
];

export class UsagePersistence {
  private lastSavedJson: string | undefined;

  constructor(private readonly memento: vscode.Memento) {}

  loadState(): AppState | undefined {
    const raw = this.memento.get<unknown>(STATE_KEY);
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const envelope = raw as Partial<PersistedState>;
    if (typeof envelope.v === "number") {
      if (envelope.v !== STATE_VERSION || !envelope.state || typeof envelope.state !== "object") {
        return undefined;
      }
      return sanitizeState(envelope.state as Record<string, unknown>);
    }
    // Pre-versioned shape: the AppState object itself.
    return sanitizeState(raw as Record<string, unknown>);
  }

  /** Persist the durable part of `state`; no-op when nothing changed since the last write. */
  saveState(state: AppState): void {
    const clean: PersistedState = { v: STATE_VERSION, state: stripTransient(state) };
    const json = JSON.stringify(clean);
    if (json === this.lastSavedJson) {
      return;
    }
    this.lastSavedJson = json;
    void this.memento.update(STATE_KEY, clean);
  }

  loadHistory(nowMs = Date.now()): HistoryState {
    const raw = this.memento.get<HistoryState>(HISTORY_KEY);
    if (!raw || !Array.isArray(raw.points)) {
      return { points: [] };
    }
    const cutoff = nowMs - HISTORY_RETENTION_MS;
    return {
      points: raw.points.filter(
        (p) => !!p && typeof p.t === "number" && Number.isFinite(p.t) && p.t >= cutoff
      ),
    };
  }

  /**
   * Append a history sample when enough time has passed since the last point.
   * Only snapshots captured after the previous sample contribute, so a
   * kept-previous snapshot (failed refresh) is not re-sampled as new data.
   * Returns the updated history (the same object when nothing was added).
   */
  recordHistory(state: AppState, nowMs = Date.now()): HistoryState {
    const current = this.loadHistory(nowMs);
    const last = current.points[current.points.length - 1];
    if (last && nowMs - last.t < HISTORY_SAMPLE_MS) {
      return current;
    }

    const point: HistoryPoint = { t: nowMs };
    let any = false;
    for (const id of PROVIDER_IDS) {
      const snap = state[id];
      if (!snap || snap.status === "disabled" || snap.status === "polling") {
        continue;
      }
      if (last && snap.capturedAt <= last.t) {
        continue;
      }
      const worst = worstUsedPercent(snap);
      if (worst === undefined) {
        continue;
      }
      point[id] = Math.round(worst);
      any = true;
    }
    if (!any) {
      return current;
    }

    const next: HistoryState = { points: [...current.points, point] };
    void this.memento.update(HISTORY_KEY, next);
    return next;
  }
}

function sanitizeWindow(raw: unknown): RateWindow | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const w = raw as Record<string, unknown>;
  if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) {
    return undefined;
  }
  const out: RateWindow = { usedPercent: Math.min(100, Math.max(0, w.usedPercent)) };
  if (typeof w.windowSeconds === "number" && Number.isFinite(w.windowSeconds)) {
    out.windowSeconds = w.windowSeconds;
  }
  if (typeof w.resetsAt === "number" && Number.isFinite(w.resetsAt)) {
    out.resetsAt = w.resetsAt;
  }
  if (typeof w.resetsLabel === "string") {
    out.resetsLabel = w.resetsLabel;
  }
  return out;
}

function sanitizeState(raw: Record<string, unknown>): AppState {
  const out: AppState = {};
  for (const id of PROVIDER_IDS) {
    const snap = raw[id];
    if (!snap || typeof snap !== "object") {
      continue;
    }
    const s = snap as Record<string, unknown>;
    if (!Array.isArray(s.windows)) {
      continue;
    }
    const status = STATUSES.includes(s.status as SnapshotStatus)
      ? (s.status as SnapshotStatus)
      : undefined;
    if (!status || status === "polling") {
      continue;
    }
    const windows = s.windows.map(sanitizeWindow).filter((w): w is RateWindow => !!w);
    const codeReview = sanitizeWindow(s.codeReview);
    out[id] = {
      ...(s as unknown as ProviderSnapshot),
      provider: id,
      windows,
      codeReview,
      source: s.source === "cli" || s.source === "rollout" ? s.source : "api",
      // Unknown capture time → treat as ancient so it is due immediately and marked stale.
      capturedAt:
        typeof s.capturedAt === "number" && Number.isFinite(s.capturedAt) ? s.capturedAt : 0,
      status,
      cached: true,
      stale: undefined,
      refreshing: undefined,
    };
  }
  return out;
}

/** Drop polling placeholders, transient flags, PII, and data-less errors before persisting. */
function stripTransient(state: AppState): AppState {
  const out: AppState = {};
  for (const id of PROVIDER_IDS) {
    const snap = state[id];
    if (!snap || snap.status === "polling") {
      continue;
    }
    if (snap.status === "disabled") {
      out[id] = disabledSnap(id, snap.capturedAt);
      continue;
    }
    const hasData =
      snap.windows.length > 0 || !!snap.credits || !!snap.monthly || !!snap.codeReview;
    if (snap.status === "ok" || hasData) {
      const { cached: _c, stale: _s, refreshing: _r, email: _e, ...rest } = snap;
      out[id] = rest;
    }
  }
  return out;
}

function disabledSnap(provider: ProviderId, capturedAt: number): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: provider === "claude" ? "cli" : "api",
    capturedAt,
    status: "disabled",
  };
}
