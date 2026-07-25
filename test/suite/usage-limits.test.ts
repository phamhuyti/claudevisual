import { strict as assert } from "assert";
import { parseUsageText } from "../../src/core/usage-limits";

const FULL_REPORT = [
  "Claude Code usage",
  "",
  "Current session: 32% used · resets Jul 13, 3:29pm (Asia/Saigon)",
  "Current week (all models): 39% used · resets Jul 16, 9:59am (Asia/Saigon)",
  "Current week (Fable): 54% used · resets Jul 16, 9:59am (Asia/Saigon)",
].join("\n");

describe("parseUsageText", () => {
  it("parses the three windows from a full report", () => {
    const limits = parseUsageText(FULL_REPORT);
    assert.ok(limits);
    assert.equal(limits!.fiveHour?.percent, 32);
    assert.equal(limits!.fiveHour?.resetsLabel, "Jul 13, 3:29pm (Asia/Saigon)");
    assert.equal(limits!.sevenDay?.percent, 39);
    assert.equal(limits!.sevenDay?.resetsLabel, "Jul 16, 9:59am (Asia/Saigon)");
    assert.equal(limits!.fableWeek?.percent, 54);
  });

  it("accepts a report with only the two account-wide windows (no Fable line)", () => {
    const text = [
      "Current session: 5% used · resets Jul 13, 3:29pm (Asia/Saigon)",
      "Current week (all models): 12% used · resets Jul 16, 9:59am (Asia/Saigon)",
    ].join("\n");
    const limits = parseUsageText(text);
    assert.ok(limits);
    assert.equal(limits!.fiveHour?.percent, 5);
    assert.equal(limits!.sevenDay?.percent, 12);
    assert.equal(limits!.fableWeek, undefined);
  });

  it("accepts a session-only report (week fetch flaked)", () => {
    const limits = parseUsageText("Current session: 88% used · resets Jul 13, 3:29pm (Asia/Saigon)");
    assert.ok(limits);
    assert.equal(limits!.fiveHour?.percent, 88);
    assert.equal(limits!.sevenDay, undefined);
  });

  it("strips ANSI color codes before parsing", () => {
    const colored = "[1mCurrent session:[0m [33m47%[0m used · resets Jul 13, 3:29pm";
    const limits = parseUsageText(colored);
    assert.ok(limits);
    assert.equal(limits!.fiveHour?.percent, 47);
    assert.equal(limits!.fiveHour?.resetsLabel, "Jul 13, 3:29pm");
  });

  it("tolerates a missing reset label", () => {
    const limits = parseUsageText("Current session: 20% used");
    assert.ok(limits);
    assert.equal(limits!.fiveHour?.percent, 20);
    assert.equal(limits!.fiveHour?.resetsLabel, undefined);
  });

  it("clamps an out-of-range percent to 0–100", () => {
    const limits = parseUsageText("Current session: 250% used");
    assert.equal(limits!.fiveHour?.percent, 100);
  });

  it("returns undefined when no account-wide window is present", () => {
    assert.equal(parseUsageText(""), undefined);
    assert.equal(parseUsageText("some unrelated CLI output\nnothing to see"), undefined);
    // Fable line alone is not enough to accept a report.
    assert.equal(parseUsageText("Current week (Fable): 54% used · resets Jul 16"), undefined);
  });
});
