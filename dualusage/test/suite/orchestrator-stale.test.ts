import * as assert from "assert";
import { AppState } from "../../src/domain/types";
import { UsageOrchestrator } from "../../src/runtime/orchestrator";
import { UsagePersistence } from "../../src/runtime/persistence";

class MemoryMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
    return Promise.resolve();
  }
}

describe("UsageOrchestrator cached hydrate", () => {
  it("exposes cached state from persistence before polling", () => {
    const mem = new MemoryMemento();
    const persistence = new UsagePersistence(mem as never);
    const capturedAt = Date.now() - 60_000;
    persistence.saveState({
      claude: {
        provider: "claude",
        windows: [{ usedPercent: 33, windowSeconds: 18000 }],
        source: "cli",
        capturedAt,
        status: "ok",
      },
    } satisfies AppState);

    const orch = new UsageOrchestrator({ persistence, now: () => Date.now() });
    assert.ok(orch.current.claude);
    assert.strictEqual(orch.current.claude!.windows[0].usedPercent, 33);
    assert.strictEqual(orch.current.claude!.cached, true);
    orch.dispose();
  });
});
