import * as assert from "assert";
import {
  formatCountdown,
  formatCursorPlanRemaining,
  isLimitHit,
  parseBalanceNumber,
  severityForPercent,
  shouldWarn,
  unicodeBar,
  windowLabel,
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
    assert.strictEqual(severityForPercent(0, 10), "ok", "0% is never warn");
  });

  it("builds unicode bars that are only full at 100%", () => {
    assert.strictEqual(unicodeBar(0, 10), "▱▱▱▱▱▱▱▱▱▱ 0%");
    assert.strictEqual(unicodeBar(50, 10), "▰▰▰▰▰▱▱▱▱▱ 50%");
    assert.strictEqual(unicodeBar(100, 10), "▰▰▰▰▰▰▰▰▰▰ 100%");
    assert.strictEqual(unicodeBar(95, 10), "▰▰▰▰▰▰▰▰▰▱ 95%");
    assert.strictEqual(unicodeBar(99.9, 10), "▰▰▰▰▰▰▰▰▰▱ 100%");
    assert.strictEqual(unicodeBar(5, 10), "▱▱▱▱▱▱▱▱▱▱ 5%");
  });

  it("formats countdowns", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    assert.strictEqual(formatCountdown(undefined, now), "—");
    assert.strictEqual(formatCountdown(now / 1000 - 10, now), "now");
    assert.strictEqual(formatCountdown(now / 1000 - 3600, now), "passed");
    assert.strictEqual(formatCountdown(now / 1000 + 20, now), "<1m");
    assert.strictEqual(formatCountdown(now / 1000 + 45 * 60, now), "45m");
    assert.strictEqual(formatCountdown(now / 1000 + 2 * 3600 + 5 * 60, now), "2h 5m");
    assert.strictEqual(formatCountdown(now / 1000 + 3 * 86400 + 4 * 3600, now), "3d 4h");
  });

  it("labels windows including sub-hour durations", () => {
    assert.strictEqual(windowLabel(18000), "5h");
    assert.strictEqual(windowLabel(604800), "7d");
    assert.strictEqual(windowLabel(900), "15m");
    assert.strictEqual(windowLabel(undefined), "?");
  });

  it("parses balances without treating '$' as zero", () => {
    assert.strictEqual(parseBalanceNumber("$12.50"), 12.5);
    assert.strictEqual(parseBalanceNumber("$"), undefined);
    assert.strictEqual(parseBalanceNumber("—"), undefined);
    assert.strictEqual(parseBalanceNumber(undefined), undefined);
  });

  it("formats Cursor plan remaining", () => {
    assert.strictEqual(
      formatCursorPlanRemaining({ limit: 20, used: 19.6, usedPercent: 98, source: "cursor_plan" }),
      "$0.40 left"
    );
    assert.strictEqual(
      formatCursorPlanRemaining(
        { limit: 400, used: 232, remaining: 168, usedPercent: 58, source: "cursor_plan" },
        { withPercent: true }
      ),
      "$168 left (58%)"
    );
    assert.strictEqual(
      formatCursorPlanRemaining({ limit: NaN, used: NaN, usedPercent: 0, source: "cursor_plan" }),
      "—"
    );
  });

  it("detects limit hits and warn thresholds", () => {
    assert.strictEqual(isLimitHit(snap()), false);
    assert.strictEqual(isLimitHit(snap({ limitReached: true })), true);
    assert.strictEqual(isLimitHit(snap({ windows: [{ usedPercent: 100 }] })), true);
    assert.strictEqual(isLimitHit(snap({ codeReview: { usedPercent: 100 } })), true);
    assert.strictEqual(shouldWarn(snap({ windows: [{ usedPercent: 95 }] }), 90, 1), true);
    assert.strictEqual(shouldWarn(snap({ windows: [{ usedPercent: 50 }] }), 90, 1), false);
    assert.strictEqual(shouldWarn(snap({ codeReview: { usedPercent: 95 } }), 90, 1), true);
  });
});
