import * as assert from "assert";
import { ProviderSnapshot } from "../../src/domain/types";
import { FetchContext, ProviderAdapter } from "../../src/providers/types";
import { UsageOrchestrator } from "../../src/runtime/orchestrator";

function okSnap(id: "claude" | "chatgpt" | "cursor", used: number): ProviderSnapshot {
  return {
    provider: id,
    windows: [{ usedPercent: used, windowSeconds: 18000 }],
    source: id === "claude" ? "cli" : "api",
    capturedAt: Date.now(),
    status: "ok",
  };
}

class SlowAdapter implements ProviderAdapter {
  readonly id = "claude" as const;
  readonly label = "Claude";
  calls = 0;
  private resolvers: Array<(snap: ProviderSnapshot) => void> = [];

  async fetch(_ctx: FetchContext): Promise<ProviderSnapshot> {
    this.calls += 1;
    return new Promise<ProviderSnapshot>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  done(used: number): void {
    const resolve = this.resolvers.shift();
    if (!resolve) {
      throw new Error("no pending fetch");
    }
    resolve(okSnap("claude", used));
  }
}

describe("UsageOrchestrator queue + abort", () => {
  it("queues a forced refresh while a poll is in flight", async () => {
    const slow = new SlowAdapter();
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
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(slow.calls, 1);

    orch.refreshAll(); // queue while in-flight
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(slow.calls, 1);

    slow.done(11);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(slow.calls >= 2, `expected queued poll, calls=${slow.calls}`);

    slow.done(22);
    await new Promise((r) => setTimeout(r, 30));
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
});
