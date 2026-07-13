import { strict as assert } from "assert";
import { ConfigFormController } from "../../src/ui/webview/config-form";
import type { WriteResultMessage } from "../../src/ui/webview/messages";

/**
 * Covers only the host-side input gate on `write-field` messages — every case
 * here must be rejected BEFORE the controller touches the filesystem, so no
 * temp settings.json is needed (mirrors installer.test.ts's rationale: the
 * accepting path hardcodes `~/.claude/settings.json` and would mutate a real
 * user's global Claude Code config if exercised).
 */
describe("config-form write-field validation", () => {
  const globalState = { get: () => undefined, update: async () => undefined };

  function controller(): ConfigFormController {
    return new ConfigFormController("/ext", globalState, undefined);
  }

  async function writeField(fieldId: string, scope: unknown, value: unknown): Promise<WriteResultMessage> {
    const result = await controller().handleMessage({
      type: "write-field",
      fieldId,
      scope: scope as never,
      value,
    });
    return result as WriteResultMessage;
  }

  it("rejects an unknown fieldId", async () => {
    const result = await writeField("no-such-field", "global", "x");
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown field");
  });

  it("rejects a scope outside global/project", async () => {
    const result = await writeField("model", "managed", "claude-sonnet-5");
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown scope");
  });

  it("rejects a non-string value", async () => {
    const result = await writeField("model", "global", { $ref: "pwn" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "value must be a string");
  });

  it("rejects a select value outside the schema's options", async () => {
    const result = await writeField("effortLevel", "global", "ludicrous");
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not an allowed value/);
  });
});
