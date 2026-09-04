import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readRolloutUsage } from "../../src/providers/chatgpt/rollout-fallback";

describe("readRolloutUsage", () => {
  it("reads rate_limits from a rollout jsonl file", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dualusage-rollout-"));
    try {
      const dir = path.join(home, "sessions", "2026", "09", "04");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "rollout-test.jsonl");
      const line = JSON.stringify({
        type: "event_msg",
        payload: {
          rate_limits: {
            primary: {
              used_percent: 22,
              window_minutes: 300,
              resets_at: 1700000000,
            },
            secondary: {
              used_percent: 8,
              window_minutes: 10080,
              resets_at: 1700500000,
            },
          },
          credits: { has_credits: true, unlimited: false, balance: "3.00" },
        },
      });
      fs.writeFileSync(file, line + "\n");
      const snap = readRolloutUsage(home);
      assert.ok(snap);
      assert.strictEqual(snap!.windows.length, 2);
      assert.strictEqual(snap!.windows[0].usedPercent, 22);
      assert.strictEqual(snap!.credits?.balance, "3.00");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
