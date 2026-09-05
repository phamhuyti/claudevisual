import * as assert from "assert";
import {
  formatCountdown,
  isLimitHit,
  severityForPercent,
  shouldWarn,
  unicodeBar,
} from "../../src/domain/format";
import { ProviderSnapshot } from "../../src/domain/types";

function snap(partial: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    provider: "claude",
    windows: [{ usedPercent: 40, windowSeconds: 18000 }],
    source: "cli",
    capturedAt: Date.now(),
    status: "ok",
    ...partial,
  };
}

describe("format helpers (status-bar / render)", () => {
  it("maps severity bands against warnPercent", () => {
    assert.strictEqual(severityForPercent(10, 90), "ok");
    assert.strictEqual(severityForPercent(80, 90), "warn");
    assert.strictEqual(severityForPercent(90, 90), "crit");
    assert.strictEqual(severityForPercent(100, 90), "crit");
  });

  it("builds unicode bars", () => {
    assert.strictEqual(unicodeBar(0, 10), "▱▱▱▱▱▱▱▱▱▱ 0%");
    assert.strictEqual(unicodeBar(50, 10), "▰▰▰▰▰▱▱▱▱▱ 50%");
    assert.strictEqual(unicodeBar(100, 10), "▰▰▰▰▰▰▰▰▰▰ 100%");
  });

  it("formats countdowns", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    assert.strictEqual(formatCountdown(undefined, now), "—");
    assert.strictEqual(formatCountdown(now / 1000 - 10, now), "now");
    assert.strictEqual(formatCountdown(now / 1000 + 45 * 60, now), "45m");
    assert.strictEqual(formatCountdown(now / 1000 + 2 * 3600 + 5 * 60, now), "2h 5m");
  });

  it("detects limit hits and warn thresholds", () => {
    assert.strictEqual(isLimitHit(snap()), false);
    assert.strictEqual(isLimitHit(snap({ limitReached: true })), true);
    assert.strictEqual(isLimitHit(snap({ windows: [{ usedPercent: 100 }] })), true);
    assert.strictEqual(shouldWarn(snap({ windows: [{ usedPercent: 95 }] }), 90, 1), true);
    assert.strictEqual(shouldWarn(snap({ windows: [{ usedPercent: 50 }] }), 90, 1), false);
  });
});
