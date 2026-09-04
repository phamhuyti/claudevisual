import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseClaudeUsageText } from "../../src/providers/claude/parse-cli-text";

const fixtures = path.join(__dirname, "..", "fixtures");

describe("parseClaudeUsageText", () => {
  it("parses full 5h + 7d report", () => {
    const text = fs.readFileSync(path.join(fixtures, "claude-usage-full.txt"), "utf8");
    const windows = parseClaudeUsageText(text);
    assert.strictEqual(windows.length, 2);
    assert.strictEqual(windows[0].usedPercent, 32);
    assert.strictEqual(windows[0].windowSeconds, 5 * 3600);
    assert.ok(windows[0].resetsLabel?.includes("Jul 13"));
    assert.strictEqual(windows[1].usedPercent, 39);
    assert.strictEqual(windows[1].windowSeconds, 7 * 86400);
  });

  it("parses session-only report", () => {
    const text = fs.readFileSync(path.join(fixtures, "claude-usage-session-only.txt"), "utf8");
    const windows = parseClaudeUsageText(text);
    assert.strictEqual(windows.length, 1);
    assert.strictEqual(windows[0].usedPercent, 12);
  });

  it("strips ANSI colors", () => {
    const text = fs.readFileSync(path.join(fixtures, "claude-usage-ansi.txt"), "utf8");
    const windows = parseClaudeUsageText(text);
    assert.strictEqual(windows.length, 2);
    assert.strictEqual(windows[0].usedPercent, 45);
    assert.strictEqual(windows[1].usedPercent, 20);
  });

  it("returns empty for unrelated text", () => {
    assert.deepStrictEqual(parseClaudeUsageText("hello world"), []);
    assert.deepStrictEqual(parseClaudeUsageText(""), []);
  });
});
