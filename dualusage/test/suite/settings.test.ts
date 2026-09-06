import * as assert from "assert";
import {
  affectsPolling,
  migrateLegacySettings,
  MIN_POLL_SECONDS,
  pollIntervalSecondsFor,
  readSettings,
  warnPercentFor,
} from "../../src/runtime/settings";
import { ConfigStubHandle, installConfigStub } from "../helpers/config-stub";

const vscode = require("vscode");

describe("settings", () => {
  let cfg: ConfigStubHandle | undefined;

  afterEach(() => {
    cfg?.restore();
    cfg = undefined;
  });

  it("uses defaults when nothing is set", () => {
    cfg = installConfigStub();
    const s = readSettings();
    assert.strictEqual(s.pollIntervalSeconds, 60);
    assert.strictEqual(s.claudePollIntervalSeconds, 0);
    assert.strictEqual(s.warnPercent, 90);
    assert.strictEqual(s.claudeEnabled, false);
    assert.deepStrictEqual(s.providersOrder, ["claude", "chatgpt", "cursor"]);
    assert.strictEqual(pollIntervalSecondsFor("claude", s), 60);
  });

  it("prefers pollIntervalSeconds over a lingering legacy pollIntervalMinutes", () => {
    cfg = installConfigStub({ values: { pollIntervalSeconds: 30, pollIntervalMinutes: 5 } });
    assert.strictEqual(readSettings().pollIntervalSeconds, 30);
  });

  it("falls back to legacy minutes ×60 when seconds is unset", () => {
    cfg = installConfigStub({
      values: { pollIntervalMinutes: 2, "providers.cursor.pollIntervalMinutes": 0.05 },
    });
    const s = readSettings();
    assert.strictEqual(s.pollIntervalSeconds, 120);
    // 0.05 min = 3 s → clamped to the minimum.
    assert.strictEqual(s.cursorPollIntervalSeconds, MIN_POLL_SECONDS);
  });

  it("clamps global and per-provider seconds to the minimum, keeping 0 = inherit", () => {
    cfg = installConfigStub({
      values: {
        pollIntervalSeconds: 1,
        "providers.claude.pollIntervalSeconds": 2,
        "providers.chatgpt.pollIntervalSeconds": 0,
        "providers.cursor.pollIntervalSeconds": 600,
      },
    });
    const s = readSettings();
    assert.strictEqual(s.pollIntervalSeconds, MIN_POLL_SECONDS);
    assert.strictEqual(s.claudePollIntervalSeconds, MIN_POLL_SECONDS);
    assert.strictEqual(s.chatgptPollIntervalSeconds, 0);
    assert.strictEqual(pollIntervalSecondsFor("chatgpt", s), MIN_POLL_SECONDS);
    assert.strictEqual(pollIntervalSecondsFor("cursor", s), 600);
  });

  it("sanitizes non-numeric and out-of-range values", () => {
    cfg = installConfigStub({
      values: {
        pollIntervalSeconds: "abc",
        warnPercent: "75",
        "providers.claude.warnPercent": -10,
        creditsWarnBalance: Number.NaN,
        "notifications.percent": 250,
        "statusBar.style": "bogus",
        "providers.order": "cursor",
      },
    });
    const s = readSettings();
    assert.strictEqual(s.pollIntervalSeconds, 60);
    assert.strictEqual(s.warnPercent, 75);
    assert.strictEqual(s.claudeWarnPercent, 0);
    assert.strictEqual(s.creditsWarnBalance, 1);
    assert.strictEqual(s.notificationsPercent, 100);
    assert.strictEqual(s.statusBarStyle, "split");
    assert.deepStrictEqual(s.providersOrder, ["claude", "chatgpt", "cursor"]);
    assert.strictEqual(warnPercentFor("claude", s), 75);
  });

  it("only treats polling-relevant keys as restart triggers", () => {
    const ev = (key: string) => ({
      affectsConfiguration: (section: string) => key === section || key.startsWith(`${section}.`),
    });
    assert.strictEqual(affectsPolling(ev("dualusage.pollIntervalSeconds")), true);
    assert.strictEqual(affectsPolling(ev("dualusage.providers.cursor.enabled")), true);
    assert.strictEqual(affectsPolling(ev("dualusage.claudePath")), true);
    assert.strictEqual(affectsPolling(ev("dualusage.chatgpt.source")), true);
    assert.strictEqual(affectsPolling(ev("dualusage.statusBar.style")), false);
    assert.strictEqual(affectsPolling(ev("dualusage.warnPercent")), false);
    assert.strictEqual(affectsPolling(ev("dualusage.providers.order")), false);
    assert.strictEqual(affectsPolling(ev("dualusage.debug")), false);
  });

  describe("migrateLegacySettings", () => {
    it("writes seconds to the owning scope and removes the legacy key", async () => {
      cfg = installConfigStub({
        values: { pollIntervalMinutes: 3, "providers.claude.pollIntervalMinutes": 1 },
        scopes: { "providers.claude.pollIntervalMinutes": "workspace" },
      });
      const migrated = await migrateLegacySettings();
      assert.strictEqual(migrated.length, 2);
      assert.deepStrictEqual(cfg.updates, [
        { key: "pollIntervalSeconds", value: 180, target: vscode.ConfigurationTarget.Global },
        { key: "pollIntervalMinutes", value: undefined, target: vscode.ConfigurationTarget.Global },
        {
          key: "providers.claude.pollIntervalSeconds",
          value: 60,
          target: vscode.ConfigurationTarget.Workspace,
        },
        {
          key: "providers.claude.pollIntervalMinutes",
          value: undefined,
          target: vscode.ConfigurationTarget.Workspace,
        },
      ]);
      assert.strictEqual(readSettings().pollIntervalSeconds, 180);
      assert.strictEqual(readSettings().claudePollIntervalSeconds, 60);
    });

    it("does not overwrite an existing seconds value in the same scope", async () => {
      cfg = installConfigStub({ values: { pollIntervalMinutes: 3, pollIntervalSeconds: 45 } });
      await migrateLegacySettings();
      assert.deepStrictEqual(cfg.updates, [
        { key: "pollIntervalMinutes", value: undefined, target: vscode.ConfigurationTarget.Global },
      ]);
      assert.strictEqual(readSettings().pollIntervalSeconds, 45);
    });

    it("is a no-op without legacy values", async () => {
      cfg = installConfigStub({ values: { pollIntervalSeconds: 45 } });
      const migrated = await migrateLegacySettings();
      assert.deepStrictEqual(migrated, []);
      assert.deepStrictEqual(cfg.updates, []);
    });
  });
});
