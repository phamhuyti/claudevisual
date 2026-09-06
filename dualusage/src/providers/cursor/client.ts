import { HttpStatusError } from "../chatgpt/wham-client";

export const CURSOR_API_BASE = "https://api2.cursor.sh";
export const CURSOR_OAUTH_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

const PERIOD_USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_INFO_PATH = "/aiserver.v1.DashboardService/GetPlanInfo";
const OAUTH_TOKEN_URL = `${CURSOR_API_BASE}/oauth/token`;

function connectHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
    Accept: "application/json",
  };
}

function mergeSignals(
  timeoutMs: number,
  outer?: AbortSignal
): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuter = (): void => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) {
      ctrl.abort(outer.reason);
    } else {
      outer.addEventListener("abort", onOuter, { once: true });
    }
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  outer?: AbortSignal
): Promise<unknown> {
  const { signal, dispose } = mergeSignals(timeoutMs, outer);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new HttpStatusError(res.status, `auth failed (${res.status})`);
    }
    if (!res.ok) {
      throw new HttpStatusError(res.status, `HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  } finally {
    dispose();
  }
}

export async function fetchCurrentPeriodUsage(
  accessToken: string,
  timeoutMs = 10_000,
  signal?: AbortSignal
): Promise<unknown> {
  return postJson(
    `${CURSOR_API_BASE}${PERIOD_USAGE_PATH}`,
    connectHeaders(accessToken),
    {},
    timeoutMs,
    signal
  );
}

export async function fetchPlanInfo(
  accessToken: string,
  timeoutMs = 10_000,
  signal?: AbortSignal
): Promise<unknown> {
  return postJson(
    `${CURSOR_API_BASE}${PLAN_INFO_PATH}`,
    connectHeaders(accessToken),
    {},
    timeoutMs,
    signal
  );
}

export interface RefreshResult {
  accessToken?: string;
  /** Present when the server rotated the refresh token; must replace the one used. */
  refreshToken?: string;
  shouldLogout: boolean;
}

/**
 * In-memory OAuth refresh only — does not write credentials back to state.vscdb.
 */
export async function refreshAccessToken(
  refreshToken: string,
  timeoutMs = 10_000,
  outer?: AbortSignal
): Promise<RefreshResult> {
  const { signal, dispose } = mergeSignals(timeoutMs, outer);
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CURSOR_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
      signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { shouldLogout: true };
    }
    if (!res.ok) {
      throw new HttpStatusError(res.status, `refresh HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      shouldLogout?: boolean;
    };
    if (json.shouldLogout) {
      return { shouldLogout: true };
    }
    const accessToken =
      typeof json.access_token === "string" && json.access_token.trim()
        ? json.access_token.trim()
        : undefined;
    const rotated =
      typeof json.refresh_token === "string" && json.refresh_token.trim()
        ? json.refresh_token.trim()
        : undefined;
    return {
      accessToken,
      refreshToken: rotated && rotated !== refreshToken ? rotated : undefined,
      shouldLogout: !accessToken,
    };
  } finally {
    dispose();
  }
}

/** True when JWT `exp` is missing or already expired (with small skew). */
export function isJwtExpired(token: string, skewSeconds = 60): boolean {
  const parts = token.split(".");
  if (parts.length < 2) {
    return true;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { exp?: number };
    if (typeof payload.exp !== "number") {
      return false;
    }
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}
