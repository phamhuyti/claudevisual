import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  needsMonthlyFallback,
  parseMonthlyUsageApi,
  parseWhamUsagePayload,
} from "../../src/providers/chatgpt/parse-wham";
import { formatProviderBody, formatProviderLine, shouldWarn, windowLabel } from "../../src/domain/format";
import { ProviderSnapshot } from "../../src/domain/types";
import { readCodexAuth } from "../../src/providers/chatgpt/auth";
import * as os from "os";
import * as fsp from "fs";

const fixtures = path.join(__dirname, "..", "fixtures");

function loadJson(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));
}

describe("parseWhamUsagePayload", () => {
  it("parses plus plan-only", () => {
    const p = parseWhamUsagePayload(loadJson("chatgpt-wham-plus-plan-only.json"));
    assert.strictEqual(p.planType, "plus");
    assert.strictEqual(p.windows.length, 2);
    assert.strictEqual(windowLabel(p.windows[0].windowSeconds), "5h");
    assert.strictEqual(windowLabel(p.windows[1].windowSeconds), "7d");
    assert.strictEqual(p.credits?.hasCredits, false);
    assert.strictEqual(p.credits?.balance, undefined);
    assert.strictEqual(p.monthly, undefined);
  });

  it("parses pro flexible credits", () => {
    const p = parseWhamUsagePayload(loadJson("chatgpt-wham-pro-credits.json"));
    assert.strictEqual(p.credits?.hasCredits, true);
    assert.strictEqual(p.credits?.balance, "5.39");
  });

  it("parses unlimited credits and null secondary", () => {
    const p = parseWhamUsagePayload(loadJson("chatgpt-wham-unlimited.json"));
    assert.strictEqual(p.windows.length, 1);
    assert.strictEqual(p.credits?.unlimited, true);
  });

  it("parses windows-full with remaining credits", () => {
    const p = parseWhamUsagePayload(loadJson("chatgpt-wham-windows-full-credits.json"));
    assert.strictEqual(p.limitReached, true);
    assert.strictEqual(p.credits?.balance, "12.00");
  });

  it("parses team monthly spend_control", () => {
    const p = parseWhamUsagePayload(loadJson("chatgpt-wham-team-monthly.json"));
    assert.ok(p.monthly);
    assert.strictEqual(p.monthly?.source, "spend_control");
    assert.strictEqual(p.monthly?.limit, 1000);
    assert.strictEqual(p.monthly?.usedPercent, 4);
    assert.strictEqual(windowLabel(p.windows[0].windowSeconds), "7d");
  });

  it("flags edu for monthly fallback when individual_limit null", () => {
    const p = parseWhamUsagePayload(loadJson("chatgpt-wham-edu-no-monthly.json"));
    assert.strictEqual(p.monthly, undefined);
    assert.strictEqual(needsMonthlyFallback(p.planType, p.monthly, p.credits), true);
  });

  it("parses monthly-usage API payload", () => {
    const m = parseMonthlyUsageApi(loadJson("chatgpt-monthly-usage-edu.json"));
    assert.ok(m);
    assert.strictEqual(m?.source, "monthly_usage_api");
    assert.strictEqual(m?.limit, 7000);
    assert.ok((m?.usedPercent ?? 0) > 40 && (m?.usedPercent ?? 0) < 45);
  });

  it("returns empty-ish for empty body", () => {
    const p = parseWhamUsagePayload({});
    assert.strictEqual(p.windows.length, 0);
    assert.strictEqual(p.credits, undefined);
  });
});

describe("readCodexAuth", () => {
  it("detects missing, oauth, and api_key_only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dualusage-auth-"));
    try {
      assert.strictEqual(readCodexAuth(dir).kind, "missing");

      fsp.writeFileSync(
        path.join(dir, "auth.json"),
        JSON.stringify({ tokens: { access_token: "tok", account_id: "acc" } })
      );
      assert.strictEqual(readCodexAuth(dir).kind, "chatgpt_oauth");

      fsp.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }));
      assert.strictEqual(readCodexAuth(dir).kind, "api_key_only");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("format + warn", () => {
  it("formats provider lines with credits and monthly", () => {
    const snap: ProviderSnapshot = {
      provider: "chatgpt",
      windows: [
        { usedPercent: 32, windowSeconds: 18000 },
        { usedPercent: 14, windowSeconds: 604800 },
      ],
      credits: { hasCredits: true, unlimited: false, balance: "5.39" },
      monthly: {
        limit: 1000,
        used: 40,
        usedPercent: 4,
        source: "spend_control",
      },
      source: "api",
      capturedAt: Date.now(),
      status: "ok",
    };
    assert.ok(formatProviderBody(snap).includes("5h 32%"));
    assert.ok(formatProviderBody(snap).includes("$5.39"));
    assert.ok(formatProviderBody(snap).includes("monthly 4%"));
    assert.ok(formatProviderLine(snap).startsWith("GPT "));
  });

  it("warns on high window or low credits", () => {
    const high: ProviderSnapshot = {
      provider: "claude",
      windows: [{ usedPercent: 95, windowSeconds: 18000 }],
      source: "cli",
      capturedAt: Date.now(),
      status: "ok",
    };
    assert.strictEqual(shouldWarn(high, 90, 1), true);

    const lowCredits: ProviderSnapshot = {
      provider: "chatgpt",
      windows: [{ usedPercent: 10, windowSeconds: 18000 }],
      credits: { hasCredits: true, unlimited: false, balance: "0.5" },
      source: "api",
      capturedAt: Date.now(),
      status: "ok",
    };
    assert.strictEqual(shouldWarn(lowCredits, 90, 1), true);
  });
});
