export const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export function monthlyUsageUrl(accountId: string): string {
  return `https://chatgpt.com/backend-api/accounts/${encodeURIComponent(accountId)}/spend-controls/current-user/monthly-usage`;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
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

async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  outer?: AbortSignal
): Promise<unknown> {
  const { signal, dispose } = mergeSignals(timeoutMs, outer);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
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

export function buildChatgptHeaders(
  accessToken: string,
  accountId: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "ChatGPT-Account-Id": accountId,
    Accept: "application/json",
  };
}

export async function fetchWhamUsage(
  accessToken: string,
  accountId: string,
  timeoutMs = 10_000,
  signal?: AbortSignal
): Promise<unknown> {
  return getJson(WHAM_USAGE_URL, buildChatgptHeaders(accessToken, accountId), timeoutMs, signal);
}

export async function fetchMonthlyUsage(
  accessToken: string,
  accountId: string,
  timeoutMs = 10_000,
  signal?: AbortSignal
): Promise<unknown> {
  return getJson(
    monthlyUsageUrl(accountId),
    buildChatgptHeaders(accessToken, accountId),
    timeoutMs,
    signal
  );
}
