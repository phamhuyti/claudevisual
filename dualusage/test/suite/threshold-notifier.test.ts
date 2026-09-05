import * as assert from "assert";
import { AppState, ProviderSnapshot } from "../../src/domain/types";
import { ThresholdNotifier } from "../../src/runtime/threshold-notifier";

const warnings: string[] = [];
const vscode = require("vscode");

vscode.window.showWarningMessage = (msg: string) => {
  warnings.push(msg);
  return Promise.resolve(undefined);
};
vscode.workspace.getConfiguration = () => ({
  get: (key: string, def: unknown) => {
    if (key === "notifications.enabled") return true;
    if (key === "notifications.percent") return 0;
    if (key === "warnPercent") return 90;
    if (key === "creditsWarnBalance") return 1;
    return def;
  },
});

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
  beforeEach(() => {
    warnings.length = 0;
  });

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
});
