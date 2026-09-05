import * as vscode from "vscode";
import { AppState, HistoryState, ProviderId, ProviderSnapshot } from "../domain/types";
import { logDebug, logError } from "../log";
import { createAdapters } from "../providers/registry";
import { FetchContext, ProviderAdapter } from "../providers/types";
import { DualUsageSettings } from "../domain/types";
import { UsagePersistence } from "./persistence";
import { pollIntervalSecondsFor, readSettings } from "./settings";

const PROVIDER_IDS: ProviderId[] = ["claude", "chatgpt", "cursor"];

export type AdapterFactory = (settings: DualUsageSettings) => ProviderAdapter[];

export interface OrchestratorOptions {
  persistence?: UsagePersistence;
  /** Injectable clock for tests (ms). */
  now?: () => number;
  /** Override adapter creation (tests). */
  createAdapters?: AdapterFactory;
}

export class UsageOrchestrator implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AppState>();
  readonly onDidChange = this.emitter.event;

  private readonly historyEmitter = new vscode.EventEmitter<HistoryState>();
  readonly onDidChangeHistory = this.historyEmitter.event;

  private state: AppState = {};
  private history: HistoryState = { points: [] };
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private pendingForce: { only?: ProviderId } | undefined;
  private abort: AbortController | undefined;
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
      this.history = this.persistence.loadHistory();
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("dualusage")) {
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
    ].filter((s) => s > 0);
    const smallest = Math.min(...seconds);
    return Math.max(5_000, smallest * 1000);
  }

  private enabledMap(): Record<ProviderId, boolean> {
    const s = readSettings();
    return {
      claude: s.claudeEnabled,
      chatgpt: s.chatgptEnabled,
      cursor: s.cursorEnabled,
    };
  }

  private withStaleFlags(state: AppState): AppState {
    const next: AppState = {};
    const now = this.now();
    for (const id of PROVIDER_IDS) {
      const snap = state[id];
      if (!snap) {
        continue;
      }
      const intervalMs = pollIntervalSecondsFor(id) * 1000;
      const age = now - (snap.capturedAt || 0);
      next[id] = {
        ...snap,
        stale: snap.status !== "disabled" && age > intervalMs * 2,
      };
    }
    return next;
  }

  private dueProviders(force: boolean, only?: ProviderId): ProviderId[] {
    const enabled = this.enabledMap();
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
      const intervalMs = pollIntervalSecondsFor(id) * 1000;
      return now - snap.capturedAt >= intervalMs;
    });
  }

  private restart(): void {
    this.abort?.abort();
    this.abort = undefined;
    this.pendingForce = undefined;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.disposed) {
      return;
    }
    const enabled = this.enabledMap();
    const next: AppState = {};
    for (const id of PROVIDER_IDS) {
      if (!enabled[id]) {
        next[id] = disabledSnap(id);
      } else if (this.state[id]?.status !== "disabled" && this.state[id]) {
        next[id] = { ...this.state[id]!, cached: this.state[id]!.cached };
      } else {
        next[id] = pollingSnap(id);
      }
    }
    this.publish(this.withStaleFlags(next));

    void this.poll(true);
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) {
        void this.poll(false);
      }
    }, this.tickMs());
  }

  private async poll(force: boolean, only?: ProviderId): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.inFlight) {
      if (force) {
        this.pendingForce = { only };
      }
      return;
    }

    const due = this.dueProviders(force, only);
    if (due.length === 0) {
      this.publish(this.withStaleFlags(this.state));
      return;
    }

    this.inFlight = true;
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;

    const settings = readSettings();
    const enabled = this.enabledMap();
    const ctx: FetchContext = {
      claudePath: settings.claudePath,
      codexHome: settings.codexHome,
      cursorDataPath: settings.cursorDataPath,
      chatgptSource: settings.chatgptSource,
      signal,
    };

    const adapters = this.createAdapters(settings).filter((a) => due.includes(a.id));
    logDebug(`orchestrator: polling ${adapters.map((a) => a.id).join(",") || "(none)"}`);

    const pending: AppState = { ...this.state };
    for (const a of adapters) {
      const prev = pending[a.id];
      pending[a.id] = {
        ...(prev ?? pollingSnap(a.id)),
        status:
          prev?.status === "ok" || prev?.cached
            ? prev.status === "ok"
              ? "ok"
              : prev.status
            : "polling",
        provider: a.id,
        windows: prev?.windows ?? [],
        source: prev?.source ?? defaultSource(a.id),
        capturedAt: prev?.capturedAt ?? this.now(),
        cached: prev?.cached,
      };
      // Keep showing cached/ok numbers while refreshing; only mark polling when empty.
      if (
        !prev ||
        (prev.status !== "ok" && !prev.windows.length && !prev.credits && !prev.monthly)
      ) {
        pending[a.id]!.status = "polling";
      }
    }
    for (const id of PROVIDER_IDS) {
      if (!enabled[id]) {
        pending[id] = disabledSnap(id);
      }
    }
    this.publish(this.withStaleFlags(pending));

    try {
      const results = await Promise.all(
        adapters.map(async (adapter) => {
          try {
            return await adapter.fetch(ctx);
          } catch (err) {
            if (signal.aborted) {
              return prevOrError(adapter.id, this.state[adapter.id], "aborted");
            }
            logError(`${adapter.id} adapter threw`, err);
            return {
              provider: adapter.id,
              windows: [],
              source: defaultSource(adapter.id),
              capturedAt: this.now(),
              status: "error" as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      if (this.disposed || signal.aborted) {
        return;
      }

      const next: AppState = { ...this.state };
      for (const id of PROVIDER_IDS) {
        if (!enabled[id]) {
          next[id] = disabledSnap(id);
        }
      }
      for (const snap of results) {
        const prev = this.state[snap.provider];
        if (
          snap.status === "error" &&
          snap.windows.length === 0 &&
          !snap.credits &&
          !snap.monthly &&
          prev &&
          (prev.status === "ok" || prev.cached)
        ) {
          next[snap.provider] = { ...prev, error: snap.error, cached: prev.cached };
        } else {
          next[snap.provider] = { ...snap, cached: false, stale: false };
        }
      }
      this.publish(this.withStaleFlags(next));
      if (this.persistence) {
        this.persistence.saveState(next);
        this.history = this.persistence.recordHistory(next, this.now());
        this.historyEmitter.fire(this.history);
      }
    } finally {
      this.inFlight = false;
      const queued = this.pendingForce;
      this.pendingForce = undefined;
      if (!this.disposed && queued) {
        void this.poll(true, queued.only);
      }
    }
  }

  private publish(next: AppState): void {
    this.state = next;
    this.emitter.fire(next);
  }

  dispose(): void {
    this.disposed = true;
    this.abort?.abort();
    this.abort = undefined;
    this.pendingForce = undefined;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
    this.historyEmitter.dispose();
  }
}

function defaultSource(provider: ProviderId): ProviderSnapshot["source"] {
  return provider === "claude" ? "cli" : "api";
}

function disabledSnap(provider: ProviderId): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: defaultSource(provider),
    capturedAt: Date.now(),
    status: "disabled",
  };
}

function pollingSnap(provider: ProviderId): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: defaultSource(provider),
    capturedAt: Date.now(),
    status: "polling",
  };
}

function prevOrError(
  id: ProviderId,
  prev: ProviderSnapshot | undefined,
  error: string
): ProviderSnapshot {
  if (prev && (prev.status === "ok" || prev.cached)) {
    return { ...prev, error };
  }
  return {
    provider: id,
    windows: [],
    source: defaultSource(id),
    capturedAt: Date.now(),
    status: "error",
    error,
  };
}
