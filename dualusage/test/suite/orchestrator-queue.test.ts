import * as assert from "assert";
import { ProviderId, ProviderSnapshot } from "../../src/domain/types";
import { FetchContext, ProviderAdapter } from "../../src/providers/types";
import { UsageOrchestrator } from "../../src/runtime/orchestrator";
import { ALL_PROVIDERS_ENABLED, ConfigStubHandle, installConfigStub } from "../helpers/config-stub";

const vscode = require("vscode");

function okSnap(id: ProviderId, used: number): ProviderSnapshot {
  return {
    provider: id,
    windows: [{ usedPercent: used, windowSeconds: 18000 }],
    source: id === "claude" ? "cli" : "api",
    capturedAt: Date.now(),
    status: "ok",
  };
}

/** Adapter whose fetches only settle when the test says so. */
class SlowAdapter implements ProviderAdapter {
  readonly label: string;
  calls = 0;
  private resolvers: Array<{
    resolve: (snap: ProviderSnapshot) => void;
    reject: (err: unknown) => void;
    signal?: AbortSignal;
  }> = [];

  constructor(readonly id: ProviderId) {
    this.label = id;
  }

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    this.calls += 1;
    return new Promise<ProviderSnapshot>((resolve, reject) => {
      this.resolvers.push({ resolve, reject, signal: ctx.signal });
    });
  }

  get pending(): number {
    return this.resolvers.length;
  }

  done(used: number): void {
    const r = this.resolvers.shift();
    if (!r) {
      throw new Error(`${this.id}: no pending fetch`);
    }
    r.resolve(okSnap(this.id, used));
  }

  fail(message: string): void {
    const r = this.resolvers.shift();
    if (!r) {
      throw new Error(`${this.id}: no pending fetch`);
    }
    r.resolve({
      provider: this.id,
      windows: [],
      source: this.id === "claude" ? "cli" : "api",
      capturedAt: Date.now(),
      status: "error",
      error: message,
    });
  }

  throwError(err: unknown): void {
    const r = this.resolvers.shift();
    if (!r) {
      throw new Error(`${this.id}: no pending fetch`);
    }
    r.reject(err);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe("UsageOrchestrator queue + abort", () => {
  let cfg: ConfigStubHandle;

  beforeEach(() => {
    cfg = installConfigStub({ values: { ...ALL_PROVIDERS_ENABLED } });
  });

  afterEach(() => cfg.restore());

  it("queues a forced refresh while a poll is in flight", async () => {
    const slow = new SlowAdapter("claude");
    const orch = new UsageOrchestrator({
      createAdapters: () => [slow],
      now: () => Date.now(),
    });

    // Don't call start() (would schedule timers). Drive poll via refreshAll.
    const updates: number[] = [];
    orch.onDidChange((state) => {
      const pct = state.claude?.windows[0]?.usedPercent;
      if (pct !== undefined && state.claude?.status === "ok") {
        updates.push(pct);
      }
    });

    orch.refreshAll();
    await flush();
    assert.strictEqual(slow.calls, 1);

    orch.refreshAll(); // queue while in-flight
    await flush();
    assert.strictEqual(slow.calls, 1);

    slow.done(11);
    await flush();
    assert.ok(slow.calls >= 2, `expected queued poll, calls=${slow.calls}`);

    slow.done(22);
    await flush();
    assert.ok(updates.includes(22), `updates=${updates.join(",")}`);
    orch.dispose();
  });

  it("marks snapshots stale when older than 2× poll interval", () => {
    const now = 1_000_000;
    const orch = new UsageOrchestrator({
      now: () => now,
      createAdapters: () => [],
    });
    orch.hydrate({
      claude: {
        ...okSnap("claude", 10),
        capturedAt: now - 3 * 60_000,
      },
    });
    assert.strictEqual(orch.current.claude?.stale, true);
    orch.dispose();
  });

  it("publishes a fast provider while a slow one is still in flight", async () => {
    const claude = new SlowAdapter("claude");
    const cursor = new SlowAdapter("cursor");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude, cursor] });

    orch.refreshAll();
    await flush();
    cursor.done(42);
    await flush();
    assert.strictEqual(orch.current.cursor?.status, "ok");
    assert.strictEqual(orch.current.cursor?.windows[0].usedPercent, 42);
    assert.strictEqual(orch.current.cursor?.refreshing, false);
    assert.strictEqual(orch.current.claude?.refreshing, true, "claude still refreshing");

    // A forced refresh of the settled provider starts immediately, independent of claude.
    orch.refreshProvider("cursor");
    await flush();
    assert.strictEqual(cursor.calls, 2);
    assert.strictEqual(claude.calls, 1);
    claude.done(7);
    cursor.done(43);
    await flush();
    assert.strictEqual(orch.current.claude?.windows[0].usedPercent, 7);
    assert.strictEqual(orch.current.cursor?.windows[0].usedPercent, 43);
    orch.dispose();
  });

  it("does not lose refreshAll when a later refreshProvider is queued", async () => {
    const claude = new SlowAdapter("claude");
    const cursor = new SlowAdapter("cursor");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude, cursor] });

    orch.refreshAll();
    await flush();
    orch.refreshAll(); // queued for both
    orch.refreshProvider("claude"); // must not narrow the queued set
    await flush();
    claude.done(1);
    cursor.done(2);
    await flush();
    assert.strictEqual(claude.calls, 2, "claude re-polled");
    assert.strictEqual(cursor.calls, 2, "cursor re-polled");
    claude.done(3);
    cursor.done(4);
    await flush();
    orch.dispose();
  });

  it("keeps data-less terminal statuses instead of flickering to polling", async () => {
    const claude = new SlowAdapter("claude");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
    orch.hydrate({
      claude: {
        provider: "claude",
        windows: [],
        source: "cli",
        capturedAt: Date.now(),
        status: "signed_out",
        error: "sign in",
      },
    });
    const statuses: string[] = [];
    orch.onDidChange((s) => statuses.push(String(s.claude?.status)));
    orch.refreshAll();
    await flush();
    assert.deepStrictEqual(statuses, ["signed_out"]);
    assert.strictEqual(orch.current.claude?.refreshing, true);
    claude.done(5);
    await flush();
    assert.strictEqual(orch.current.claude?.status, "ok");
    orch.dispose();
  });

  it("keeps the previous good numbers and surfaces the error when a refresh fails", async () => {
    const claude = new SlowAdapter("claude");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
    orch.refreshAll();
    await flush();
    claude.done(33);
    await flush();
    orch.refreshAll();
    await flush();
    claude.fail("boom");
    await flush();
    assert.strictEqual(orch.current.claude?.status, "ok");
    assert.strictEqual(orch.current.claude?.windows[0].usedPercent, 33);
    assert.strictEqual(orch.current.claude?.error, "boom");
    assert.strictEqual(orch.current.claude?.refreshing, false);

    orch.refreshAll();
    await flush();
    claude.done(34);
    await flush();
    assert.strictEqual(orch.current.claude?.error, undefined, "error cleared on success");
    orch.dispose();
  });

  it("recovers when an adapter throws instead of resolving", async () => {
    const claude = new SlowAdapter("claude");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
    orch.refreshAll();
    await flush();
    claude.throwError(new Error("kaboom"));
    await flush();
    assert.strictEqual(orch.current.claude?.status, "error");
    assert.strictEqual(orch.current.claude?.error, "kaboom");
    orch.refreshAll();
    await flush();
    assert.strictEqual(claude.calls, 2, "not stuck in-flight after a throw");
    claude.done(1);
    await flush();
    orch.dispose();
  });

  it("does not get stuck when a change listener throws", async () => {
    const claude = new SlowAdapter("claude");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
    orch.onDidChange(() => {
      throw new Error("listener exploded");
    });
    orch.refreshAll();
    await flush();
    claude.done(1);
    await flush();
    orch.refreshAll();
    await flush();
    assert.strictEqual(claude.calls, 2);
    claude.done(2);
    await flush();
    orch.dispose();
    vscode.__listenerErrors = [];
  });

  it("discards results from a superseded generation after a settings restart", async () => {
    const claude = new SlowAdapter("claude");
    let onConfigChange: ((e: unknown) => void) | undefined;
    const prev = vscode.workspace.onDidChangeConfiguration;
    vscode.workspace.onDidChangeConfiguration = (cb: (e: unknown) => void) => {
      onConfigChange = cb;
      return { dispose: () => undefined };
    };
    try {
      const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
      orch.refreshAll();
      await flush();
      assert.strictEqual(claude.calls, 1);

      onConfigChange!({
        affectsConfiguration: (k: string) => k === "dualusage.pollIntervalSeconds",
      });
      await flush();
      // restart() polls immediately and the new fetch is not blocked by the aborted one.
      assert.strictEqual(claude.calls, 2);
      assert.strictEqual(claude.pending, 2);

      claude.done(99); // settles the *old* fetch → must be ignored
      await flush();
      assert.notStrictEqual(orch.current.claude?.windows[0]?.usedPercent, 99);

      claude.done(5);
      await flush();
      assert.strictEqual(orch.current.claude?.windows[0]?.usedPercent, 5);
      orch.dispose();
    } finally {
      vscode.workspace.onDidChangeConfiguration = prev;
    }
  });

  it("ignores non-polling settings changes", async () => {
    const claude = new SlowAdapter("claude");
    let onConfigChange: ((e: unknown) => void) | undefined;
    const prev = vscode.workspace.onDidChangeConfiguration;
    vscode.workspace.onDidChangeConfiguration = (cb: (e: unknown) => void) => {
      onConfigChange = cb;
      return { dispose: () => undefined };
    };
    try {
      const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
      orch.refreshAll();
      await flush();
      onConfigChange!({ affectsConfiguration: (k: string) => k === "dualusage.statusBar.style" });
      await flush();
      assert.strictEqual(claude.calls, 1, "no restart for a status-bar style change");
      claude.done(1);
      await flush();
      orch.dispose();
    } finally {
      vscode.workspace.onDidChangeConfiguration = prev;
    }
  });

  it("ignores results that arrive after dispose", async () => {
    const claude = new SlowAdapter("claude");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude] });
    let fired = 0;
    orch.onDidChange(() => fired++);
    orch.refreshAll();
    await flush();
    const before = fired;
    orch.dispose();
    claude.done(1);
    await flush();
    assert.strictEqual(fired, before);
  });

  it("skips disabled providers and marks them disabled", async () => {
    cfg.values["providers.chatgpt.enabled"] = false;
    const claude = new SlowAdapter("claude");
    const chatgpt = new SlowAdapter("chatgpt");
    const orch = new UsageOrchestrator({ createAdapters: () => [claude, chatgpt] });
    orch.refreshAll();
    await flush();
    assert.strictEqual(chatgpt.calls, 0);
    assert.strictEqual(orch.current.chatgpt?.status, "disabled");
    claude.done(1);
    await flush();
    orch.dispose();
  });
});
