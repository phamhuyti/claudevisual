import * as vscode from "vscode";
import { AppState, ProviderId, ProviderSnapshot } from "../domain/types";
import { logDebug, logError } from "../log";
import { createAdapters } from "../providers/registry";
import { FetchContext } from "../providers/types";
import { readSettings } from "./settings";

const PROVIDER_IDS: ProviderId[] = ["claude", "chatgpt", "cursor"];

export class UsageOrchestrator implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AppState>();
  readonly onDidChange = this.emitter.event;

  private state: AppState = {};
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private pendingForce: { only?: ProviderId } | undefined;
  private abort: AbortController | undefined;
  private disposed = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("dualusage")) {
          this.restart();
        }
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.isStale()) {
          void this.poll(false);
        }
      })
    );
  }

  get current(): AppState {
    return this.state;
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

  private intervalMs(): number {
    return readSettings().pollIntervalMinutes * 60_000;
  }

  private isStale(): boolean {
    const snaps = PROVIDER_IDS.map((id) => this.state[id]).filter(Boolean) as ProviderSnapshot[];
    if (snaps.length === 0) {
      return true;
    }
    const newest = Math.max(...snaps.map((s) => s.capturedAt || 0));
    return Date.now() - newest > this.intervalMs();
  }

  private enabledMap(): Record<ProviderId, boolean> {
    const s = readSettings();
    return {
      claude: s.claudeEnabled,
      chatgpt: s.chatgptEnabled,
      cursor: s.cursorEnabled,
    };
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
      } else if (this.state[id]?.status !== "disabled") {
        next[id] = this.state[id] ?? pollingSnap(id);
      } else {
        next[id] = pollingSnap(id);
      }
    }
    this.publish(next);

    // Load usage immediately on activate / settings change — do not wait.
    void this.poll(true);
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) {
        void this.poll(false);
      }
    }, this.intervalMs());
  }

  private async poll(force: boolean, only?: ProviderId): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.inFlight) {
      // Never drop a manual refresh — queue it for after the current poll.
      if (force) {
        this.pendingForce = { only };
      }
      return;
    }
    if (!force && !this.isStale() && !only) {
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

    const adapters = createAdapters(settings).filter((a) => !only || a.id === only);
    logDebug(`orchestrator: polling ${adapters.map((a) => a.id).join(",") || "(none)"}`);

    // Mark targeted providers as polling without wiping prior data.
    const pending: AppState = { ...this.state };
    for (const a of adapters) {
      const prev = pending[a.id];
      pending[a.id] = {
        ...(prev ?? pollingSnap(a.id)),
        status: prev?.status === "ok" ? "ok" : "polling",
        provider: a.id,
        windows: prev?.windows ?? [],
        source: prev?.source ?? defaultSource(a.id),
        capturedAt: prev?.capturedAt ?? Date.now(),
      };
    }
    for (const id of PROVIDER_IDS) {
      if (!enabled[id]) {
        pending[id] = disabledSnap(id);
      }
    }
    this.publish(pending);

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
              capturedAt: Date.now(),
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
        // Keep prior ok data on transient error with empty payload.
        if (
          snap.status === "error" &&
          snap.windows.length === 0 &&
          !snap.credits &&
          !snap.monthly &&
          prev &&
          prev.status === "ok"
        ) {
          next[snap.provider] = { ...prev, error: snap.error };
        } else {
          next[snap.provider] = snap;
        }
      }
      this.publish(next);
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
  if (prev && prev.status === "ok") {
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
