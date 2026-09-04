import { ProviderSnapshot } from "../../domain/types";
import { logDebug, logError } from "../../log";
import { FetchContext, ProviderAdapter } from "../types";
import { readCodexAuth, resolveCodexHome } from "./auth";
import { needsMonthlyFallback, parseMonthlyUsageApi, parseWhamUsagePayload } from "./parse-wham";
import { readRolloutUsage } from "./rollout-fallback";
import { fetchMonthlyUsage, fetchWhamUsage, HttpStatusError } from "./wham-client";

export class ChatgptAdapter implements ProviderAdapter {
  readonly id = "chatgpt" as const;
  readonly label = "ChatGPT";

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    const codexHome = resolveCodexHome(ctx.codexHome);
    const base: ProviderSnapshot = {
      provider: "chatgpt",
      windows: [],
      source: "api",
      capturedAt: Date.now(),
      status: "error",
    };

    const sourceMode = ctx.chatgptSource;

    if (sourceMode === "rollout") {
      return this.fromRollout(codexHome, base);
    }

    const auth = readCodexAuth(codexHome);
    if (auth.kind === "missing") {
      if (sourceMode === "auto") {
        const rolled = this.fromRollout(codexHome, base);
        if (rolled.status === "ok") {
          return rolled;
        }
      }
      return {
        ...base,
        status: "signed_out",
        error: "Sign in to the ChatGPT extension (no ~/.codex/auth.json)",
      };
    }
    if (auth.kind === "api_key_only") {
      return {
        ...base,
        status: "api_key_only",
        error: "Sign in with ChatGPT (API key auth cannot query plan usage)",
      };
    }

    try {
      logDebug("chatgpt: fetching wham/usage");
      const payload = await fetchWhamUsage(auth.accessToken!, auth.accountId!);
      const parsed = parseWhamUsagePayload(payload);
      let monthly = parsed.monthly;

      if (needsMonthlyFallback(parsed.planType, monthly, parsed.credits)) {
        try {
          logDebug("chatgpt: fetching monthly-usage fallback");
          const monthlyPayload = await fetchMonthlyUsage(auth.accessToken!, auth.accountId!);
          monthly = parseMonthlyUsageApi(monthlyPayload) ?? monthly;
        } catch (err) {
          logDebug(`chatgpt monthly-usage failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const hasData =
        parsed.windows.length > 0 || parsed.credits !== undefined || monthly !== undefined;
      if (!hasData) {
        if (sourceMode === "auto") {
          const rolled = this.fromRollout(codexHome, base);
          if (rolled.status === "ok") {
            return rolled;
          }
        }
        return {
          ...base,
          ...parsed,
          monthly,
          status: "error",
          error: "usage payload had no windows or credits",
        };
      }

      return {
        ...base,
        ...parsed,
        monthly,
        source: "api",
        status: "ok",
        capturedAt: Date.now(),
      };
    } catch (err) {
      if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) {
        return {
          ...base,
          status: "signed_out",
          error: "ChatGPT session expired — sign in again in the ChatGPT extension",
        };
      }
      logError("chatgpt usage API failed", err);
      if (sourceMode === "auto") {
        const rolled = this.fromRollout(codexHome, base);
        if (rolled.status === "ok") {
          return {
            ...rolled,
            error: `api failed, using rollout (${err instanceof Error ? err.message : String(err)})`,
          };
        }
      }
      return {
        ...base,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private fromRollout(codexHome: string, base: ProviderSnapshot): ProviderSnapshot {
    const rolled = readRolloutUsage(codexHome);
    if (!rolled) {
      return {
        ...base,
        source: "rollout",
        status: "error",
        error: "no rate_limits found in local Codex sessions",
      };
    }
    return {
      ...base,
      windows: rolled.windows,
      credits: rolled.credits,
      source: "rollout",
      status: "ok",
      capturedAt: Date.now(),
    };
  }
}
