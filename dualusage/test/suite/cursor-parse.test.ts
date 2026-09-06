import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { formatProviderLine, shouldWarn } from "../../src/domain/format";
import { ProviderSnapshot } from "../../src/domain/types";
import { readCursorAuth, resolveCursorStateDb } from "../../src/providers/cursor/auth";
import { isJwtExpired } from "../../src/providers/cursor/client";
import { parseCursorPeriodUsage, parseCursorPlanInfo } from "../../src/providers/cursor/parse";

const fixtures = path.join(__dirname, "..", "fixtures");

function loadJson(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));
}

describe("parseCursorPeriodUsage", () => {
  it("parses ultra plan spend + on-demand remaining", () => {
    const p = parseCursorPeriodUsage(loadJson("cursor-period-ultra.json"), {
      planName: "Ultra",
      email: "user@example.com",
    });
    assert.strictEqual(p.planType, "Ultra");
    assert.strictEqual(p.email, "user@example.com");
    assert.ok(p.monthly);
    assert.strictEqual(p.monthly?.source, "cursor_plan");
    assert.strictEqual(p.monthly?.limit, 400);
    assert.strictEqual(p.monthly?.used, 232.22);
    assert.ok((p.monthly?.usedPercent ?? 0) > 58 && (p.monthly?.usedPercent ?? 0) < 59);
    assert.strictEqual(p.credits?.hasCredits, true);
    assert.strictEqual(p.credits?.balance, "85.00");
    assert.strictEqual(p.windows.length, 0);
    assert.ok(p.promoMessage?.includes("58%"));
  });

  it("marks exhausted plan as limitReached", () => {
    const p = parseCursorPeriodUsage(loadJson("cursor-period-exhausted.json"), {
      membershipType: "pro",
    });
    assert.strictEqual(p.planType, "pro");
    assert.strictEqual(p.limitReached, true);
    assert.strictEqual(p.monthly?.usedPercent, 100);
    assert.strictEqual(p.monthly?.limit, 20);
    assert.strictEqual(p.monthly?.used, 20);
  });

  it("falls back to percent-only when cents limit missing", () => {
    const p = parseCursorPeriodUsage(loadJson("cursor-period-percent-only.json"));
    assert.strictEqual(p.monthly, undefined);
    assert.strictEqual(p.windows.length, 1);
    assert.strictEqual(p.windows[0].usedPercent, 12.5);
  });

  it("returns empty-ish for empty body", () => {
    const p = parseCursorPeriodUsage({});
    assert.strictEqual(p.windows.length, 0);
    assert.strictEqual(p.monthly, undefined);
    assert.strictEqual(p.credits, undefined);
  });

  it("parses plan info name", () => {
    assert.strictEqual(parseCursorPlanInfo({ planInfo: { planName: "Pro" } }), "Pro");
    assert.strictEqual(parseCursorPlanInfo({}), undefined);
  });
});

describe("cursor format + warn", () => {
  it("formats cursor plan spend line", () => {
    const snap: ProviderSnapshot = {
      provider: "cursor",
      planType: "Ultra",
      windows: [],
      monthly: {
        limit: 400,
        used: 232.22,
        remaining: 167.78,
        usedPercent: 58.055,
        source: "cursor_plan",
      },
      credits: { hasCredits: true, unlimited: false, balance: "85.00" },
      source: "api",
      capturedAt: Date.now(),
      status: "ok",
    };
    const line = formatProviderLine(snap);
    assert.ok(line.startsWith("Cursor "));
    assert.ok(line.includes("$168 left"));
    assert.ok(!line.includes("$232/$400"));
    assert.ok(line.includes("58%"));
    assert.ok(line.includes("$85.00"));
  });

  it("warns when plan spend high or on-demand low", () => {
    const high: ProviderSnapshot = {
      provider: "cursor",
      windows: [],
      monthly: { limit: 20, used: 19, usedPercent: 95, source: "cursor_plan" },
      source: "api",
      capturedAt: Date.now(),
      status: "ok",
    };
    assert.strictEqual(shouldWarn(high, 90, 1), true);

    const lowCredits: ProviderSnapshot = {
      provider: "cursor",
      windows: [],
      monthly: { limit: 20, used: 5, usedPercent: 25, source: "cursor_plan" },
      credits: { hasCredits: true, unlimited: false, balance: "0.50" },
      source: "api",
      capturedAt: Date.now(),
      status: "ok",
    };
    assert.strictEqual(shouldWarn(lowCredits, 90, 1), true);
  });
});

describe("cursor auth helpers", () => {
  it("resolves override file path", () => {
    const p = resolveCursorStateDb("/tmp/custom-state.vscdb");
    assert.strictEqual(p, path.resolve("/tmp/custom-state.vscdb"));
  });

  it("reads auth keys from a temp sqlite db", async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dualusage-cursor-"));
    const dbPath = path.join(dir, "state.vscdb");
    const sql = [
      "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);",
      "INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', 'tok-access');",
      "INSERT INTO ItemTable VALUES ('cursorAuth/refreshToken', 'tok-refresh');",
      "INSERT INTO ItemTable VALUES ('cursorAuth/cachedEmail', 'a@b.c');",
      "INSERT INTO ItemTable VALUES ('cursorAuth/stripeMembershipType', 'pro');",
    ].join("");
    const r = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
    if (r.status !== 0) {
      this.skip();
      return;
    }
    try {
      const auth = await readCursorAuth(dbPath);
      assert.strictEqual(auth.kind, "signed_in");
      assert.strictEqual(auth.accessToken, "tok-access");
      assert.strictEqual(auth.refreshToken, "tok-refresh");
      assert.strictEqual(auth.email, "a@b.c");
      assert.strictEqual(auth.membershipType, "pro");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a db without auth rows as missing, and a corrupt db as unreadable", async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dualusage-cursor-"));
    try {
      const emptyDb = path.join(dir, "empty.vscdb");
      const r = spawnSync(
        "sqlite3",
        [emptyDb, "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);"],
        { encoding: "utf8" }
      );
      if (r.status !== 0) {
        this.skip();
        return;
      }
      const empty = await readCursorAuth(emptyDb);
      assert.strictEqual(empty.kind, "missing");

      const corrupt = path.join(dir, "corrupt.vscdb");
      fs.writeFileSync(corrupt, "definitely not a sqlite file");
      const bad = await readCursorAuth(corrupt);
      assert.strictEqual(bad.kind, "unreadable");
      assert.ok(bad.reason && bad.reason.length > 0, "unreadable carries a reason");

      const absent = await readCursorAuth(path.join(dir, "nope.vscdb"));
      assert.strictEqual(absent.kind, "missing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects expired jwt", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url");
    assert.strictEqual(isJwtExpired(`${header}.${payload}.x`), true);
    const future = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64url");
    assert.strictEqual(isJwtExpired(`${header}.${future}.x`), false);
  });
});
