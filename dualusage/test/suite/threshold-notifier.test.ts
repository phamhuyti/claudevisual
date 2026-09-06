import * as assert from "assert";
import { AppState, ProviderSnapshot } from "../../src/domain/types";
import { ThresholdNotifier } from "../../src/runtime/threshold-notifier";
import { ConfigStubHandle, installConfigStub } from "../helpers/config-stub";

const vscode = require("vscode");

function snap(used: number, extra: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    provider: "claude",
    windows: [{ usedPercent: used, windowSeconds: 18000 }],
    source: "cli",
    capturedAt: Date.now(),
    status: "ok",
    ...extra,
  };
}

describe("ThresholdNotifier", () => {
  const warnings: string[] = [];
  let prevShowWarning: unknown;
  let cfg: ConfigStubHandle;

  before(() => {
    prevShowWarning = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };
  });

  after(() => {
    vscode.window.showWarningMessage = prevShowWarning;
  });

  beforeEach(() => {
    warnings.length = 0;
    cfg = installConfigStub({
      values: {
        "notifications.enabled": true,
        "notifications.percent": 0,
        warnPercent: 90,
        creditsWarnBalance: 1,
      },
    });
  });

  afterEach(() => cfg.restore());

  it("toasts once per threshold crossing", () => {
    const n = new ThresholdNotifier();
    const state: AppState = { claude: snap(95) };
    n.update(state);
    n.update(state);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Claude/i);

    n.update({ claude: snap(50) });
    n.update({ claude: snap(91) });
    assert.strictEqual(warnings.length, 2);
    n.dispose();
  });

  it("toasts for limitReached", () => {
    const n = new ThresholdNotifier();
    n.update({ claude: snap(10, { limitReached: true }) });
    n.update({ claude: snap(10, { limitReached: true }) });
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /limit reached/i);
    n.dispose();
  });

  it("applies hysteresis so 89.9 ↔ 90.1 jitter does not re-toast", () => {
    const n = new ThresholdNotifier();
    n.update({ claude: snap(90.1) });
    n.update({ claude: snap(89.9) });
    n.update({ claude: snap(90.1) });
    assert.strictEqual(warnings.length, 1);
    // Dropping below threshold - 5 clears the key; the next crossing toasts again.
    n.update({ claude: snap(84) });
    n.update({ claude: snap(92) });
    assert.strictEqual(warnings.length, 2);
    n.dispose();
  });

  it("uses the per-provider warnPercent when set", () => {
    cfg.values["providers.cursor.warnPercent"] = 50;
    const n = new ThresholdNotifier();
    n.update({
      cursor: { ...snap(55), provider: "cursor", source: "api" },
      claude: snap(55),
    });
    assert.strictEqual(warnings.length, 1, warnings.join(" | "));
    assert.match(warnings[0], /Cursor/);
    n.dispose();
  });

  it("seeds from cached snapshots silently and does not re-toast on the first live poll", () => {
    const n = new ThresholdNotifier();
    n.update({ claude: snap(97, { cached: true }) });
    assert.strictEqual(warnings.length, 0);
    n.update({ claude: snap(97) });
    assert.strictEqual(warnings.length, 0);
    n.update({ claude: snap(10) });
    n.update({ claude: snap(97) });
    assert.strictEqual(warnings.length, 1);
    n.dispose();
  });

  it("keys windows by duration so reordering does not re-toast", () => {
    const n = new ThresholdNotifier();
    const a = { usedPercent: 95, windowSeconds: 18000 };
    const b = { usedPercent: 10, windowSeconds: 604800 };
    n.update({ claude: snap(0, { windows: [a, b] }) });
    n.update({ claude: snap(0, { windows: [b, a] }) });
    assert.strictEqual(warnings.length, 1);
    n.dispose();
  });

  it("ignores disabled providers and clears when notifications are turned off", () => {
    const n = new ThresholdNotifier();
    n.update({ claude: snap(95, { status: "disabled" }) });
    assert.strictEqual(warnings.length, 0);
    n.update({ claude: snap(95) });
    assert.strictEqual(warnings.length, 1);
    cfg.values["notifications.enabled"] = false;
    n.update({ claude: snap(95) });
    cfg.values["notifications.enabled"] = true;
    n.update({ claude: snap(95) });
    assert.strictEqual(warnings.length, 2, "re-armed after notifications were toggled");
    n.dispose();
  });

  it("does not treat a bare '$' balance as zero credits", () => {
    const n = new ThresholdNotifier();
    n.update({
      chatgpt: {
        ...snap(10),
        provider: "chatgpt",
        source: "api",
        credits: { hasCredits: true, unlimited: false, balance: "$" },
      },
    });
    assert.strictEqual(warnings.length, 0);
    n.update({
      chatgpt: {
        ...snap(10),
        provider: "chatgpt",
        source: "api",
        credits: { hasCredits: true, unlimited: false, balance: "$0.40" },
      },
    });
    assert.strictEqual(warnings.length, 1);
    n.dispose();
  });
});
