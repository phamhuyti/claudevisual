import * as vscode from "vscode";
import {
  AppState,
  DualUsageSettings,
  HistoryState,
  PROVIDER_IDS,
  ProviderId,
  ProviderSnapshot,
} from "../domain/types";
import { logDebug, logError } from "../log";
import { createAdapters } from "../providers/registry";
import { FetchContext, ProviderAdapter } from "../providers/types";
import { UsagePersistence } from "./persistence";
import {
  affectsPolling,
  DEFAULT_POLL_SECONDS,
  MIN_POLL_SECONDS,
  pollIntervalSecondsFor,
  readSettings,
} from "./settings";

export type AdapterFactory = (settings: DualUsageSettings) => ProviderAdapter[];

export interface OrchestratorOptions {
  persistence?: UsagePersistence;
  /** Injectable clock for tests (ms). */
  now?: () => number;
  /** Override adapter creation (tests). */
  createAdapters?: AdapterFactory;
}

/**
 * Schedules provider fetches and owns the published AppState.
 *
 * - Each provider is tracked in flight independently, so a slow Claude CLI run
 *   never withholds fresh ChatGPT/Cursor numbers.
 * - Results are merged and published as they settle; persistence happens once
 *   per batch.
 * - `restart()` bumps a generation counter: anything still running from an
 *   older generation is aborted and its results / bookkeeping are discarded.
 */
export class UsageOrchestrator implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AppState>();
  readonly onDidChange = this.emitter.event;

  private readonly historyEmitter = new vscode.EventEmitter<HistoryState>();
  readonly onDidChangeHistory = this.historyEmitter.event;

  private state: AppState = {};
  private history: HistoryState = { points: [] };
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly inFlight = new Set<ProviderId>();
  /** Providers whose forced refresh was requested while they were in flight. */
  private readonly pendingForce = new Set<ProviderId>();
  private abort = new AbortController();
  private generation = 0;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly persistence?: UsagePersistence;
  private readonly now: () => number;
  private readonly createAdapters: AdapterFactory;

  constructor(opts: OrchestratorOptions = {}) {
    this.persistence = opts.persistence;
    this.now = opts.now ?? Date.now;
    this.createAdapters = opts.createAdapters ?? createAdapters;
    if (this.persistence) {
      const cached = this.persistence.loadState();
      if (cached && Object.keys(cached).length > 0) {
        this.state = this.withStaleFlags(cached);
      }
      this.history = this.persistence.loadHistory(this.now());
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (affectsPolling(e)) {
          this.restart();
        }
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) {
          void this.poll(false);
        }
      })
    );
  }

  get current(): AppState {
    return this.state;
  }

  get currentHistory(): HistoryState {
    return this.history;
  }

  start(): void {
    this.restart();
  }

  refreshAll(): void {
    void this.poll(true);
  }

  refreshProvider(id: ProviderId): void {
    void this.poll(true, id);
  }

  /** Seed state without polling (tests / restore). */
  hydrate(state: AppState): void {
    this.publish(this.withStaleFlags(state));
  }

  private tickMs(): number {
    const settings = readSettings();
    const seconds = [
      settings.pollIntervalSeconds,
      settings.claudePollIntervalSeconds,
      settings.chatgptPollIntervalSeconds,
      settings.cursorPollIntervalSeconds,
    ].filter((s) => Number.isFinite(s) && s > 0);
    const smallest = seconds.length ? Math.min(...seconds) : DEFAULT_POLL_SECONDS;
    return Math.max(MIN_POLL_SECONDS * 1000, smallest * 1000);
  }

  private enabledMap(settings = readSettings()): Record<ProviderId, boolean> {
    return {
      claude: settings.claudeEnabled,
      chatgpt: settings.chatgptEnabled,
      cursor: settings.cursorEnabled,
    };
  }

  private withStaleFlags(state: AppState): AppState {
    const next: AppState = {};
    const now = this.now();
    const settings = readSettings();
    for (const id of PROVIDER_IDS) {
      const snap = state[id];
      if (!snap) {
        continue;
      }
      const intervalMs = pollIntervalSecondsFor(id, settings) * 1000;
      const age = now - (snap.capturedAt || 0);
      next[id] = {
        ...snap,
        stale: snap.status !== "disabled" && age > intervalMs * 2,
      };
    }
    return next;
  }

  /** Re-publish only when some provider's stale flag actually changed. */
  private refreshStaleFlags(): void {
    const next = this.withStaleFlags(this.state);
    const changed = PROVIDER_IDS.some(
      (id) => (this.state[id]?.stale ?? false) !== (next[id]?.stale ?? false)
    );
    if (changed) {
      this.publish(next);
    }
  }

  private dueProviders(
    force: boolean,
    only: ProviderId | undefined,
    settings: DualUsageSettings
  ): ProviderId[] {
    const enabled = this.enabledMap(settings);
    const now = this.now();
    return PROVIDER_IDS.filter((id) => {
      if (only && id !== only) {
        return false;
      }
      if (!enabled[id]) {
        return false;
      }
      if (force || only) {
        return true;
      }
      const snap = this.state[id];
      if (!snap || snap.status === "polling" || !snap.capturedAt) {
        return true;
      }
      const intervalMs = pollIntervalSecondsFor(id, settings) * 1000;
      return now - snap.capturedAt >= intervalMs;
    });
  }

  private restart(): void {
    this.generation += 1;
    this.abort.abort();
    this.abort = new AbortController();
    this.inFlight.clear();
    this.pendingForce.clear();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.disposed) {
      return;
    }
    const enabled = this.enabledMap();
    const now = this.now();
    const next: AppState = {};
    for (const id of PROVIDER_IDS) {
      const prev = this.state[id];
      if (!enabled[id]) {
        next[id] = disabledSnap(id, now);
      } else if (prev && prev.status !== "disabled") {
        next[id] = { ...prev, refreshing: false };
      } else {
        next[id] = pollingSnap(id, now);
      }
    }
    this.publish(this.withStaleFlags(next));

    void this.poll(true);
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) {
        void this.poll(false);
      } else {
        this.refreshStaleFlags();
      }
    }, this.tickMs());
  }

  private async poll(force: boolean, only?: ProviderId): Promise<void> {
    if (this.disposed) {
      return;
    }
    const settings = readSettings();
    const due: ProviderId[] = [];
    for (const id of this.dueProviders(force, only, settings)) {
      if (this.inFlight.has(id)) {
        if (force) {
          this.pendingForce.add(id);
        }
      } else {
        due.push(id);
      }
    }
    if (due.length === 0) {
      this.refreshStaleFlags();
      return;
    }

    const gen = this.generation;
    const signal = this.abort.signal;
    const enabled = this.enabledMap(settings);
    const ctx: FetchContext = {
      claudePath: settings.claudePath,
      codexHome: settings.codexHome,
      cursorDataPath: settings.cursorDataPath,
      chatgptSource: settings.chatgptSource,
      signal,
    };

    let adapters: ProviderAdapter[];
    try {
      adapters = this.createAdapters(settings).filter((a) => due.includes(a.id));
    } catch (err) {
      logError("orchestrator: creating adapters failed", err);
      return;
    }
    logDebug(`orchestrator: polling ${adapters.map((a) => a.id).join(",") || "(none)"}`);

    const pending: AppState = { ...this.state };
    for (const a of adapters) {
      pending[a.id] = pendingSnap(a.id, pending[a.id], this.now());
    }
    for (const id of PROVIDER_IDS) {
      if (!enabled[id]) {
        pending[id] = disabledSnap(id, this.now());
      }
    }
    try {
      this.publish(this.withStaleFlags(pending));
    } catch (err) {
      logError("orchestrator: publish failed", err);
    }

    await Promise.all(adapters.map((adapter) => this.fetchOne(adapter, ctx, gen, signal, enabled)));
    if (this.disposed || gen !== this.generation) {
      return;
    }
    this.persist();
  }

  /** Fetch one provider; never rejects. Bookkeeping is skipped for stale generations. */
  private async fetchOne(
    adapter: ProviderAdapter,
    ctx: FetchContext,
    gen: number,
    signal: AbortSignal,
    enabled: Record<ProviderId, boolean>
  ): Promise<void> {
    const id = adapter.id;
    this.inFlight.add(id);
    let snap: ProviderSnapshot;
    try {
      snap = await adapter.fetch(ctx);
    } catch (err) {
      if (signal.aborted) {
        snap = prevOrError(id, this.state[id], "aborted", this.now());
      } else {
        logError(`${id} adapter threw`, err);
        snap = {
          provider: id,
          windows: [],
          source: defaultSource(id),
          capturedAt: this.now(),
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      if (gen === this.generation) {
        this.inFlight.delete(id);
      }
    }
    if (this.disposed || gen !== this.generation || signal.aborted) {
      return;
    }
    try {
      this.mergeResult(snap, enabled);
    } catch (err) {
      logError("orchestrator: merge failed", err);
    }
    if (this.pendingForce.delete(id)) {
      void this.poll(true, id);
    }
  }

  private mergeResult(snap: ProviderSnapshot, enabled: Record<ProviderId, boolean>): void {
    const next: AppState = { ...this.state };
    for (const id of PROVIDER_IDS) {
      if (!enabled[id]) {
        next[id] = disabledSnap(id, this.now());
      }
    }
    const prev = this.state[snap.provider];
    if (
      snap.status === "error" &&
      !hasData(snap) &&
      prev &&
      (prev.status === "ok" || prev.cached)
    ) {
      // Keep the last good numbers; surface the failure via `error`.
      next[snap.provider] = { ...prev, error: snap.error, refreshing: false };
    } else {
      next[snap.provider] = { ...snap, cached: false, stale: false, refreshing: false };
    }
    this.publish(this.withStaleFlags(next));
  }

  private persist(): void {
    if (!this.persistence) {
      return;
    }
    try {
      this.persistence.saveState(this.state);
      const history = this.persistence.recordHistory(this.state, this.now());
      const lastT = history.points[history.points.length - 1]?.t;
      const prevLastT = this.history.points[this.history.points.length - 1]?.t;
      if (history.points.length !== this.history.points.length || lastT !== prevLastT) {
        this.history = history;
        this.historyEmitter.fire(this.history);
      }
    } catch (err) {
      logError("orchestrator: persist failed", err);
    }
  }

  private publish(next: AppState): void {
    this.state = next;
    this.emitter.fire(next);
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.abort.abort();
    this.inFlight.clear();
    this.pendingForce.clear();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
    this.historyEmitter.dispose();
  }
}

function hasData(snap: ProviderSnapshot): boolean {
  return snap.windows.length > 0 || !!snap.credits || !!snap.monthly || !!snap.codeReview;
}

function defaultSource(provider: ProviderId): ProviderSnapshot["source"] {
  return provider === "claude" ? "cli" : "api";
}

function disabledSnap(provider: ProviderId, now: number): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: defaultSource(provider),
    capturedAt: now,
    status: "disabled",
  };
}

function pollingSnap(provider: ProviderId, now: number): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: defaultSource(provider),
    capturedAt: now,
    status: "polling",
  };
}

/**
 * Snapshot shown while a fetch is in flight. Existing numbers (live or cached)
 * and data-less terminal states (signed_out, cli_missing, …) are kept as-is with
 * `refreshing: true`; only a missing/placeholder snapshot becomes `polling`.
 */
function pendingSnap(
  provider: ProviderId,
  prev: ProviderSnapshot | undefined,
  now: number
): ProviderSnapshot {
  if (!prev || prev.status === "polling") {
    return { ...pollingSnap(provider, now), refreshing: true };
  }
  return { ...prev, refreshing: true };
}

function prevOrError(
  id: ProviderId,
  prev: ProviderSnapshot | undefined,
  error: string,
  now: number
): ProviderSnapshot {
  if (prev && (prev.status === "ok" || prev.cached)) {
    return { ...prev, error };
  }
  return {
    provider: id,
    windows: [],
    source: defaultSource(id),
    capturedAt: now,
    status: "error",
    error,
  };
}
