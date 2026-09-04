import { ProviderSnapshot } from "../../domain/types";
import { logDebug, logError } from "../../log";
import { HttpStatusError } from "../chatgpt/wham-client";
import { FetchContext, ProviderAdapter } from "../types";
import { readCursorAuth, resolveCursorStateDb } from "./auth";
import {
  fetchCurrentPeriodUsage,
  fetchPlanInfo,
  isJwtExpired,
  refreshAccessToken,
} from "./client";
import { parseCursorPeriodUsage, parseCursorPlanInfo } from "./parse";

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

    const auth = readCursorAuth(dbPath);
    if (auth.kind === "missing") {
      return {
        ...base,
        status: "signed_out",
        error: "Sign in to Cursor (no local state.vscdb auth found)",
      };
    }

    let accessToken = auth.accessToken;
    if ((!accessToken || isJwtExpired(accessToken)) && auth.refreshToken) {
      try {
        logDebug("cursor: refreshing access token in-memory");
        const refreshed = await refreshAccessToken(auth.refreshToken);
        if (refreshed.shouldLogout || !refreshed.accessToken) {
          return {
            ...base,
            status: "signed_out",
            email: auth.email,
            planType: auth.membershipType,
            error: "Cursor session expired — sign in again in Cursor",
          };
        }
        accessToken = refreshed.accessToken;
      } catch (err) {
        logDebug(`cursor refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!accessToken) {
          return {
            ...base,
            status: "signed_out",
            email: auth.email,
            planType: auth.membershipType,
            error: "Cursor token refresh failed — open Cursor and sign in",
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
      const payload = await fetchCurrentPeriodUsage(accessToken);
      let planName: string | undefined;
      try {
        const planPayload = await fetchPlanInfo(accessToken);
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
