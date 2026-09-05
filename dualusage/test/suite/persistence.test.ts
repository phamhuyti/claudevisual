import * as assert from "assert";
import { AppState, ProviderSnapshot } from "../../src/domain/types";
import { HISTORY_SAMPLE_MS, UsagePersistence } from "../../src/runtime/persistence";

class MemoryMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
    return Promise.resolve();
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
});
