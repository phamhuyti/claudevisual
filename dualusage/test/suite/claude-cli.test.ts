import * as assert from "assert";
import * as path from "path";
import { escapeForCmd, resolveWindowsExecutable } from "../../src/providers/claude/cli-usage";

describe("claude cli launcher (Windows resolution)", () => {
  const files = new Set<string>();
  const exists = (p: string): boolean => files.has(p);
  const env = {
    PATH: ["C:\\Tools", "C:\\Users\\me\\AppData\\Roaming\\npm"].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
  };

  beforeEach(() => files.clear());

  it("resolves a bare name through PATH × PATHEXT in PATHEXT order", () => {
    files.add(path.join("C:\\Users\\me\\AppData\\Roaming\\npm", "claude.CMD"));
    files.add(path.join("C:\\Users\\me\\AppData\\Roaming\\npm", "claude")); // bash shim, not runnable
    assert.strictEqual(
      resolveWindowsExecutable("claude", env, exists),
      path.join("C:\\Users\\me\\AppData\\Roaming\\npm", "claude.CMD")
    );
    files.add(path.join("C:\\Tools", "claude.EXE"));
    assert.strictEqual(
      resolveWindowsExecutable("claude", env, exists),
      path.join("C:\\Tools", "claude.EXE"),
      "earlier PATH entry wins"
    );
  });

  it("uses an explicit path as-is when it has an extension, else tries PATHEXT", () => {
    const explicit = "D:\\bin\\claude.exe";
    files.add(explicit);
    assert.strictEqual(resolveWindowsExecutable(explicit, env, exists), explicit);
    files.add("D:\\bin\\other.CMD");
    assert.strictEqual(
      resolveWindowsExecutable("D:\\bin\\other", env, exists),
      "D:\\bin\\other.CMD"
    );
    assert.strictEqual(resolveWindowsExecutable("D:\\bin\\missing", env, exists), undefined);
  });

  it("returns undefined when nothing matches", () => {
    assert.strictEqual(resolveWindowsExecutable("claude", env, exists), undefined);
  });

  it("escapes every cmd.exe metacharacter so a hostile path cannot chain commands", () => {
    const hostile = 'C:\\x\\claude.cmd" & calc.exe & "';
    const escaped = escapeForCmd(hostile);
    assert.ok(!/[^^]&/.test(escaped), `ampersands escaped: ${escaped}`);
    assert.ok(!/[^^]"/.test(escaped), `quotes escaped: ${escaped}`);
    assert.strictEqual(
      escapeForCmd("C:\\Program Files\\claude.cmd"),
      "C:\\Program^ Files\\claude.cmd"
    );
    assert.strictEqual(escapeForCmd("a|b%c!d^e<f>g"), "a^|b^%c^!d^^e^<f^>g");
  });
});
