import * as vscode from "vscode";
import { AppState, ProviderId, ProviderSnapshot } from "../domain/types";
import { logDebug, logError } from "../log";
import { createAdapters } from "../providers/registry";
import { FetchContext } from "../providers/types";
import { readSettings } from "./settings";

export class UsageOrchestrator implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AppState>();
  readonly onDidChange = this.emitter.event;

  private state: AppState = {};
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
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
    const snaps = [this.state.claude, this.state.chatgpt].filter(Boolean) as ProviderSnapshot[];
    if (snaps.length === 0) {
      return true;
    }
    const newest = Math.max(...snaps.map((s) => s.capturedAt || 0));
    return Date.now() - newest > this.intervalMs();
  }

  private restart(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.disposed) {
      return;
    }
    const settings = readSettings();
    // Publish disabled placeholders immediately so UI can hide items.
    const next: AppState = {};
    if (!settings.claudeEnabled) {
      next.claude = disabledSnap("claude");
    } else if (this.state.claude?.status !== "disabled") {
      next.claude = this.state.claude ?? pollingSnap("claude");
    } else {
      next.claude = pollingSnap("claude");
    }
    if (!settings.chatgptEnabled) {
      next.chatgpt = disabledSnap("chatgpt");
    } else if (this.state.chatgpt?.status !== "disabled") {
      next.chatgpt = this.state.chatgpt ?? pollingSnap("chatgpt");
    } else {
      next.chatgpt = pollingSnap("chatgpt");
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
    if (this.disposed || this.inFlight) {
      return;
    }
    if (!force && !this.isStale() && !only) {
      return;
    }
    this.inFlight = true;
    const settings = readSettings();
    const ctx: FetchContext = {
      claudePath: settings.claudePath,
      codexHome: settings.codexHome,
      chatgptSource: settings.chatgptSource,
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
        source: prev?.source ?? (a.id === "claude" ? "cli" : "api"),
        capturedAt: prev?.capturedAt ?? Date.now(),
      };
    }
    if (!settings.claudeEnabled) {
      pending.claude = disabledSnap("claude");
    }
    if (!settings.chatgptEnabled) {
      pending.chatgpt = disabledSnap("chatgpt");
    }
    this.publish(pending);

    try {
      const results = await Promise.all(
        adapters.map(async (adapter) => {
          try {
            return await adapter.fetch(ctx);
          } catch (err) {
            logError(`${adapter.id} adapter threw`, err);
            return {
              provider: adapter.id,
              windows: [],
              source: adapter.id === "claude" ? ("cli" as const) : ("api" as const),
              capturedAt: Date.now(),
              status: "error" as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      const next: AppState = { ...this.state };
      if (!settings.claudeEnabled) {
        next.claude = disabledSnap("claude");
      }
      if (!settings.chatgptEnabled) {
        next.chatgpt = disabledSnap("chatgpt");
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
    }
  }

  private publish(next: AppState): void {
    this.state = next;
    this.emitter.fire(next);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
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

function pollingSnap(provider: ProviderId): ProviderSnapshot {
  return {
    provider,
    windows: [],
    source: provider === "claude" ? "cli" : "api",
    capturedAt: Date.now(),
    status: "polling",
  };
}
