import * as assert from "assert";
import { AppState, ProviderSnapshot } from "../../src/domain/types";
import {
  HISTORY_RETENTION_MS,
  HISTORY_SAMPLE_MS,
  UsagePersistence,
} from "../../src/runtime/persistence";

class MemoryMemento {
  writes = 0;
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Thenable<void> {
    this.writes += 1;
    if (value === undefined) {
      this.store.delete(key);
    } else {
      // Round-trip through JSON like the real globalState does.
      this.store.set(key, JSON.parse(JSON.stringify(value)));
    }
    return Promise.resolve();
  }
  raw(key: string): unknown {
    return this.store.get(key);
  }
  seed(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

function okSnap(provider: "claude" | "chatgpt" | "cursor", used: number): ProviderSnapshot {
  return {
    provider,
    windows: [
      {
        usedPercent: used,
        windowSeconds: 5 * 3600,
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
    source: provider === "claude" ? "cli" : "api",
    capturedAt: Date.now(),
    status: "ok",
  };
}

describe("UsagePersistence", () => {
  it("saves and reloads state with cached flag", () => {
    const mem = new MemoryMemento();
    const p = new UsagePersistence(mem as never);
    const state: AppState = { claude: okSnap("claude", 42) };
    p.saveState(state);
    const loaded = p.loadState();
    assert.ok(loaded?.claude);
    assert.strictEqual(loaded!.claude!.windows[0].usedPercent, 42);
    assert.strictEqual(loaded!.claude!.cached, true);
  });

  it("records history at most once per sample window", () => {
    const mem = new MemoryMemento();
    const p = new UsagePersistence(mem as never);
    const t0 = Date.now() - 60_000;
    const state: AppState = {
      claude: okSnap("claude", 10),
      chatgpt: okSnap("chatgpt", 55),
    };
    const h1 = p.recordHistory(state, t0);
    assert.strictEqual(h1.points.length, 1);
    assert.strictEqual(h1.points[0].claude, 10);
    assert.strictEqual(h1.points[0].chatgpt, 55);

    const h2 = p.recordHistory(state, t0 + HISTORY_SAMPLE_MS - 1);
    assert.strictEqual(h2.points.length, 1);

    const h3 = p.recordHistory({ claude: okSnap("claude", 20) }, t0 + HISTORY_SAMPLE_MS);
    assert.strictEqual(h3.points.length, 2);
    assert.strictEqual(h3.points[1].claude, 20);
  });

  it("skips polling placeholders when saving", () => {
    const mem = new MemoryMemento();
    const p = new UsagePersistence(mem as never);
    p.saveState({
      claude: {
        provider: "claude",
        windows: [],
        source: "cli",
        capturedAt: Date.now(),
        status: "polling",
      },
    });
    const loaded = p.loadState();
    assert.ok(!loaded?.claude);
  });

  it("writes a versioned envelope, strips transient flags and email, and skips unchanged writes", () => {
    const mem = new MemoryMemento();
    const p = new UsagePersistence(mem as never);
    const snap: ProviderSnapshot = {
      ...okSnap("cursor", 12),
      email: "me@example.com",
      cached: true,
      stale: true,
      refreshing: true,
    };
    p.saveState({ cursor: snap });
    p.saveState({ cursor: { ...snap, stale: false } }); // transient-only change
    assert.strictEqual(mem.writes, 1, "second identical save skipped");

    const raw = mem.raw("dualusage.lastAppState") as { v: number; state: AppState };
    assert.strictEqual(raw.v, 1);
    assert.strictEqual(raw.state.cursor?.email, undefined);
    assert.strictEqual(raw.state.cursor?.cached, undefined);
    assert.strictEqual(raw.state.cursor?.refreshing, undefined);

    p.saveState({ cursor: { ...snap, windows: [{ usedPercent: 13 }] } });
    assert.strictEqual(mem.writes, 2);
  });

  it("loads the pre-versioned shape and rejects unknown versions", () => {
    const mem = new MemoryMemento();
    mem.seed("dualusage.lastAppState", { claude: okSnap("claude", 5) });
    const p = new UsagePersistence(mem as never);
    assert.strictEqual(p.loadState()?.claude?.windows[0].usedPercent, 5);

    mem.seed("dualusage.lastAppState", { v: 99, state: { claude: okSnap("claude", 5) } });
    assert.strictEqual(p.loadState(), undefined);
  });

  it("sanitizes corrupt snapshots", () => {
    const mem = new MemoryMemento();
    mem.seed("dualusage.lastAppState", {
      v: 1,
      state: {
        claude: { provider: "claude", windows: "nope", source: "cli", status: "ok" },
        chatgpt: {
          provider: "chatgpt",
          windows: [{ usedPercent: "high" }, { usedPercent: 250 }, null],
          source: "weird",
          status: "unknown-status",
          capturedAt: 1,
        },
        cursor: {
          provider: "cursor",
          windows: [{ usedPercent: 40, windowSeconds: "x" }],
          source: "api",
          status: "ok",
          capturedAt: "yesterday",
        },
      },
    });
    const p = new UsagePersistence(mem as never);
    const loaded = p.loadState()!;
    assert.strictEqual(loaded.claude, undefined, "non-array windows dropped");
    assert.strictEqual(loaded.chatgpt, undefined, "unknown status dropped");
    assert.ok(loaded.cursor);
    assert.deepStrictEqual(loaded.cursor!.windows, [{ usedPercent: 40 }]);
    assert.strictEqual(loaded.cursor!.capturedAt, 0, "unknown capture time is ancient, not now");
    assert.strictEqual(loaded.cursor!.cached, true);
  });

  it("uses the injected clock for history retention", () => {
    const mem = new MemoryMemento();
    const p = new UsagePersistence(mem as never);
    const t0 = 10 * HISTORY_RETENTION_MS;
    const snap = { ...okSnap("claude", 10), capturedAt: t0 };
    p.recordHistory({ claude: snap }, t0);
    assert.strictEqual(p.loadHistory(t0).points.length, 1);
    assert.strictEqual(p.loadHistory(t0 + HISTORY_RETENTION_MS + 1).points.length, 0);
    // Real clock: t0 is decades in the past, so the point would be dropped.
    assert.strictEqual(p.loadHistory().points.length, 0);
  });

  it("does not re-sample a snapshot that has not been refreshed since the last point", () => {
    const mem = new MemoryMemento();
    const p = new UsagePersistence(mem as never);
    const t0 = 10 * HISTORY_RETENTION_MS;
    const stale = { ...okSnap("claude", 10), capturedAt: t0 - 1000 };
    const h1 = p.recordHistory({ claude: stale }, t0);
    assert.strictEqual(h1.points.length, 1);
    const h2 = p.recordHistory({ claude: stale }, t0 + HISTORY_SAMPLE_MS);
    assert.strictEqual(h2.points.length, 1, "kept-previous snapshot not flat-lined");
    const fresh = { ...okSnap("claude", 11), capturedAt: t0 + HISTORY_SAMPLE_MS - 1 };
    const h3 = p.recordHistory({ claude: fresh }, t0 + HISTORY_SAMPLE_MS);
    assert.strictEqual(h3.points.length, 2);
  });
});
