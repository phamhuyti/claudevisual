import { ProviderSnapshot } from "../../domain/types";
import { logDebug, logError } from "../../log";
import { HttpStatusError } from "../chatgpt/wham-client";
import { FetchContext, ProviderAdapter } from "../types";
import { readCursorAuth, resolveCursorStateDb } from "./auth";
import { fetchCurrentPeriodUsage, fetchPlanInfo, isJwtExpired, refreshAccessToken } from "./client";
import { parseCursorPeriodUsage, parseCursorPlanInfo } from "./parse";
import {
  cachedAccessToken,
  effectiveRefreshToken,
  forgetRefreshedToken,
  rememberRefreshedToken,
} from "./token-cache";

export class CursorAdapter implements ProviderAdapter {
  readonly id = "cursor" as const;
  readonly label = "Cursor";

  async fetch(ctx: FetchContext): Promise<ProviderSnapshot> {
    const dbPath = resolveCursorStateDb(ctx.cursorDataPath);
    const base: ProviderSnapshot = {
      provider: "cursor",
      windows: [],
      source: "api",
      capturedAt: Date.now(),
      status: "error",
    };

    const auth = await readCursorAuth(dbPath, ctx.signal);
    if (auth.kind === "unreadable") {
      // Not a sign-in problem: keep the last good numbers and explain the failure.
      return {
        ...base,
        status: "error",
        error: `Cannot read Cursor state.vscdb — ${auth.reason ?? "unknown error"}`,
      };
    }
    if (auth.kind === "missing") {
      return {
        ...base,
        status: "signed_out",
        error: "Sign in to Cursor (no local state.vscdb auth found)",
      };
    }

    // Prefer Cursor's own (unexpired) access token, then one we minted earlier from
    // the same refresh token; only hit the OAuth endpoint when both are unusable.
    let accessToken =
      auth.accessToken && !isJwtExpired(auth.accessToken) ? auth.accessToken : undefined;
    if (!accessToken && auth.refreshToken) {
      accessToken = cachedAccessToken(auth.refreshToken);
    }
    if (!accessToken && auth.refreshToken) {
      try {
        logDebug("cursor: refreshing access token in-memory");
        const refreshed = await refreshAccessToken(
          effectiveRefreshToken(auth.refreshToken),
          10_000,
          ctx.signal
        );
        if (refreshed.shouldLogout || !refreshed.accessToken) {
          forgetRefreshedToken();
          return {
            ...base,
            status: "signed_out",
            email: auth.email,
            planType: auth.membershipType,
            error: "Cursor session expired — sign in again in Cursor",
          };
        }
        rememberRefreshedToken(auth.refreshToken, refreshed.accessToken, refreshed.refreshToken);
        accessToken = refreshed.accessToken;
      } catch (err) {
        logDebug(`cursor refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        if (ctx.signal?.aborted) {
          throw err;
        }
        // Fall back to the possibly-expired DB token; the API will tell us if it's dead.
        accessToken = auth.accessToken;
        if (!accessToken) {
          return {
            ...base,
            status: "error",
            email: auth.email,
            planType: auth.membershipType,
            error: `Cursor token refresh failed — ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    if (!accessToken) {
      return {
        ...base,
        status: "signed_out",
        email: auth.email,
        planType: auth.membershipType,
        error: "Sign in to Cursor (missing access token)",
      };
    }

    try {
      logDebug("cursor: fetching GetCurrentPeriodUsage");
      const payload = await fetchCurrentPeriodUsage(accessToken, 10_000, ctx.signal);
      let planName: string | undefined;
      try {
        const planPayload = await fetchPlanInfo(accessToken, 10_000, ctx.signal);
        planName = parseCursorPlanInfo(planPayload);
      } catch (err) {
        logDebug(`cursor GetPlanInfo failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const parsed = parseCursorPeriodUsage(payload, {
        planName,
        email: auth.email,
        membershipType: auth.membershipType,
      });

      const hasData =
        parsed.windows.length > 0 || parsed.credits !== undefined || parsed.monthly !== undefined;
      if (!hasData) {
        return {
          ...base,
          ...parsed,
          status: "error",
          error: "Cursor usage payload had no plan spend or limits",
        };
      }

      return {
        ...base,
        ...parsed,
        source: "api",
        status: "ok",
        capturedAt: Date.now(),
      };
    } catch (err) {
      if (err instanceof HttpStatusError && (err.status === 401 || err.status === 403)) {
        forgetRefreshedToken();
        return {
          ...base,
          status: "signed_out",
          email: auth.email,
          planType: auth.membershipType,
          error: "Cursor session expired — sign in again in Cursor",
        };
      }
      logError("cursor usage API failed", err);
      return {
        ...base,
        email: auth.email,
        planType: auth.membershipType,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
