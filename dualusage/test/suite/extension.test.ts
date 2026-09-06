import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { USAGE_PAGE_URLS } from "../../src/domain/usage-links";
import { activate, providerIdFromCommandArg } from "../../src/extension";
import { ConfigStubHandle, installConfigStub } from "../helpers/config-stub";

const vscode = require("vscode");

class MemoryMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
    return Promise.resolve();
  }
}

describe("extension activation", () => {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const opened: string[] = [];
  const subscriptions: Array<{ dispose(): unknown }> = [];
  let cfg: ConfigStubHandle;
  let prevRegister: unknown;
  let prevOpen: unknown;

  before(() => {
    cfg = installConfigStub();
    prevRegister = vscode.commands.registerCommand;
    prevOpen = vscode.env.openExternal;
    vscode.commands.registerCommand = (id: string, cb: (...args: unknown[]) => unknown) => {
      registered.set(id, cb);
      return { dispose: () => registered.delete(id) };
    };
    vscode.env.openExternal = async (uri: { toString(): string }) => {
      opened.push(uri.toString());
      return true;
    };
    activate({
      subscriptions,
      globalState: new MemoryMemento(),
      extensionPath: path.resolve(__dirname, "..", ".."),
    } as never);
  });

  after(() => {
    // Disposes the orchestrator timer too — otherwise mocha would never exit.
    subscriptions.forEach((d) => d.dispose());
    vscode.commands.registerCommand = prevRegister;
    vscode.env.openExternal = prevOpen;
    cfg.restore();
  });

  it("registers every command declared in package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8")
    ) as { contributes: { commands: Array<{ command: string }> } };
    const declared = pkg.contributes.commands.map((c) => c.command).sort();
    assert.deepStrictEqual([...registered.keys()].sort(), declared);
  });

  it("opens the usage page for the provider in a webview context-menu argument", async () => {
    opened.length = 0;
    const handler = registered.get("dualusage.openUsagePage")!;
    await handler({
      webviewSection: "providerCard",
      provider: "cursor",
      preventDefaultContextMenuItems: true,
      webview: "dualusage.sidebar",
    });
    assert.deepStrictEqual(opened, [USAGE_PAGE_URLS.cursor]);
  });

  it("accepts a plain provider id and falls back to the picker otherwise", async () => {
    opened.length = 0;
    const handler = registered.get("dualusage.openUsagePage")!;
    await handler("claude");
    assert.deepStrictEqual(opened, [USAGE_PAGE_URLS.claude]);

    opened.length = 0;
    await handler({ webviewSection: "providerCard" }); // no provider → QuickPick (stub: cancelled)
    await handler("not-a-provider");
    assert.deepStrictEqual(opened, []);
  });

  it("providerIdFromCommandArg validates shapes", () => {
    assert.strictEqual(providerIdFromCommandArg("chatgpt"), "chatgpt");
    assert.strictEqual(providerIdFromCommandArg({ provider: "claude" }), "claude");
    assert.strictEqual(providerIdFromCommandArg({ provider: "nope" }), undefined);
    assert.strictEqual(providerIdFromCommandArg(undefined), undefined);
    assert.strictEqual(providerIdFromCommandArg(42), undefined);
  });
});
