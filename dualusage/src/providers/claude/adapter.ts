import { ProviderSnapshot } from "../../domain/types";
import { logDebug, logError } from "../../log";
import { FetchContext, ProviderAdapter } from "../types";
import { ClaudeCliMissingError, runClaudeUsageCommand } from "./cli-usage";
import { parseClaudeUsageText } from "./parse-cli-text";

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = "claude" as const;
  readonly label = "Claude";

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    const base: ProviderSnapshot = {
      provider: "claude",
      windows: [],
      source: "cli",
      capturedAt: Date.now(),
      status: "error",
    };

    try {
      logDebug("claude: running /usage");
      const text = await runClaudeUsageCommand(ctx.claudePath);
      const windows = parseClaudeUsageText(text);
      if (windows.length === 0) {
        return {
          ...base,
          status: "signed_out",
          error: "no usage data (CLI signed out or output changed)",
        };
      }
      return {
        ...base,
        windows,
        status: "ok",
        capturedAt: Date.now(),
      };
    } catch (err) {
      if (err instanceof ClaudeCliMissingError) {
        return { ...base, status: "cli_missing", error: err.message };
      }
      logError("claude usage failed", err);
      return {
        ...base,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
