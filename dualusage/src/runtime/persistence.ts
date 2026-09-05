import * as vscode from "vscode";
import { AppState, HistoryPoint, HistoryState, ProviderId, ProviderSnapshot } from "../domain/types";
import { worstUsedPercent } from "../domain/format";

const STATE_KEY = "dualusage.lastAppState";
const HISTORY_KEY = "dualusage.usageHistory";

/** Sample at most once per 5 minutes; keep ~48h of points. */
export const HISTORY_SAMPLE_MS = 5 * 60_000;
export const HISTORY_RETENTION_MS = 48 * 60 * 60_000;

export class UsagePersistence {
  constructor(private readonly memento: vscode.Memento) {}

  loadState(): AppState | undefined {
    const raw = this.memento.get<AppState>(STATE_KEY);
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    return sanitizeState(raw);
  }

  saveState(state: AppState): void {
    const clean = stripTransient(state);
    void this.memento.update(STATE_KEY, clean);
  }

  loadHistory(): HistoryState {
    const raw = this.memento.get<HistoryState>(HISTORY_KEY);
    if (!raw || !Array.isArray(raw.points)) {
      return { points: [] };
    }
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    return {
      points: raw.points.filter((p) => typeof p?.t === "number" && p.t >= cutoff),
    };
  }

  /**
   * Append a history sample when enough time has passed since the last point.
   * Returns the updated history (always).
   */
  recordHistory(state: AppState, nowMs = Date.now()): HistoryState {
    const current = this.loadHistory();
    const last = current.points[current.points.length - 1];
    if (last && nowMs - last.t < HISTORY_SAMPLE_MS) {
      return current;
    }

    const point: HistoryPoint = { t: nowMs };
    let any = false;
    for (const id of ["claude", "chatgpt", "cursor"] as ProviderId[]) {
      const snap = state[id];
      if (!snap || snap.status === "disabled" || snap.status === "polling") {
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

    const cutoff = nowMs - HISTORY_RETENTION_MS;
    const points = [...current.points.filter((p) => p.t >= cutoff), point];
    const next: HistoryState = { points };
    void this.memento.update(HISTORY_KEY, next);
    return next;
  }
}

function sanitizeState(raw: AppState): AppState {
  const out: AppState = {};
  for (const id of ["claude", "chatgpt", "cursor"] as ProviderId[]) {
    const snap = raw[id];
    if (!snap || typeof snap !== "object") {
      continue;
    }
    if (!Array.isArray(snap.windows)) {
      continue;
    }
    out[id] = {
      ...snap,
      provider: id,
      windows: snap.windows,
      source: snap.source === "cli" || snap.source === "rollout" ? snap.source : "api",
      capturedAt: typeof snap.capturedAt === "number" ? snap.capturedAt : Date.now(),
      status: snap.status === "disabled" ? "disabled" : snap.status === "ok" ? "ok" : snap.status,
      cached: true,
    };
  }
  return out;
}

/** Drop polling placeholders and errors without data before persisting. */
function stripTransient(state: AppState): AppState {
  const out: AppState = {};
  for (const id of ["claude", "chatgpt", "cursor"] as ProviderId[]) {
    const snap = state[id];
    if (!snap || snap.status === "polling") {
      continue;
    }
    if (snap.status === "disabled") {
      out[id] = disabledSnap(id);
      continue;
    }
    const hasData =
      snap.windows.length > 0 || !!snap.credits || !!snap.monthly || !!snap.codeReview;
    if (snap.status === "ok" || hasData) {
      const { cached: _c, stale: _s, ...rest } = snap;
      out[id] = { ...rest, cached: undefined, stale: undefined };
    }
  }
  return out;
}

function disabledSnap(provider: ProviderId): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: provider === "claude" ? "cli" : "api",
    capturedAt: Date.now(),
    status: "disabled",
  };
}
