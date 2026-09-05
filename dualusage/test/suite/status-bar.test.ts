import * as assert from "assert";
import { AppState, ProviderSnapshot } from "../../src/domain/types";

const items: Array<{
  text: string;
  tooltip: unknown;
  backgroundColor: { id: string } | undefined;
  command: unknown;
  showCalls: number;
  hideCalls: number;
  show(): void;
  hide(): void;
  dispose(): void;
}> = [];

const vscode = require("vscode");
vscode.window.createStatusBarItem = () => {
  const item = {
    text: "",
    tooltip: undefined as unknown,
    backgroundColor: undefined as { id: string } | undefined,
    command: undefined as unknown,
    name: "",
    showCalls: 0,
    hideCalls: 0,
    show() {
      this.showCalls += 1;
    },
    hide() {
      this.hideCalls += 1;
    },
    dispose() {},
  };
  items.push(item);
  return item;
};
vscode.StatusBarAlignment = { Left: 1, Right: 2 };
vscode.ThemeColor = class ThemeColor {
  constructor(public id: string) {}
};
vscode.MarkdownString = class MarkdownString {
  value: string;
  isTrusted: unknown;
  supportThemeIcons = false;
  constructor(value = "") {
    this.value = value;
  }
};

// Import after stub patches so the controller picks them up.
const { StatusBarController } = require("../../src/ui/status-bar") as {
  StatusBarController: new () => {
    render(state: AppState): void;
    dispose(): void;
  };
};

function snap(provider: "claude" | "chatgpt" | "cursor", used: number): ProviderSnapshot {
  return {
    provider,
    windows: [
      {
        usedPercent: used,
        windowSeconds: 18000,
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
    source: provider === "claude" ? "cli" : "api",
    capturedAt: Date.now(),
    status: "ok",
  };
}

describe("StatusBarController", () => {
  beforeEach(() => {
    items.length = 0;
  });

  it("renders split items with provider icons and warn background", () => {
    const bar = new StatusBarController();
    const state: AppState = {
      claude: snap("claude", 95),
      chatgpt: { ...snap("chatgpt", 10), status: "disabled" },
      cursor: { ...snap("cursor", 10), status: "disabled" },
    };
    bar.render(state);
    const shown = items.filter((i) => i.showCalls > 0);
    assert.ok(shown.length >= 1);
    const claude = items.find(
      (i) => String(i.text).includes("Claude") || String(i.text).includes("comment")
    );
    assert.ok(claude, `texts=${items.map((i) => i.text).join(" | ")}`);
    assert.match(String(claude!.text), /\$\(comment/);
    assert.ok(claude!.backgroundColor);
    bar.dispose();
  });

  it("uses error background when limit reached", () => {
    const bar = new StatusBarController();
    bar.render({
      claude: { ...snap("claude", 50), limitReached: true },
    });
    const shown = items.find((i) => i.showCalls > 0);
    assert.ok(shown);
    assert.strictEqual(shown!.backgroundColor?.id, "statusBarItem.errorBackground");
    bar.dispose();
  });
});
