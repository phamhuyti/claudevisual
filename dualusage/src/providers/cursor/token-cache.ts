import { isJwtExpired } from "./client";

/**
 * In-memory cache for an access token minted from Cursor's refresh token.
 *
 * Adapters are re-created on every poll, so this lives at module level. It is
 * keyed by the refresh token read from state.vscdb: when Cursor itself rotates
 * its session the cache is invalidated automatically. Nothing is persisted.
 */
interface Entry {
  /** Refresh token as read from state.vscdb when the access token was minted. */
  sourceRefreshToken: string;
  accessToken: string;
  /** Rotated refresh token returned by the server (if any) — use it, not the stale DB one. */
  rotatedRefreshToken?: string;
}

let entry: Entry | undefined;

export function cachedAccessToken(sourceRefreshToken: string): string | undefined {
  if (!entry || entry.sourceRefreshToken !== sourceRefreshToken) {
    return undefined;
  }
  return isJwtExpired(entry.accessToken) ? undefined : entry.accessToken;
}

/** The refresh token that should be used for the next refresh. */
export function effectiveRefreshToken(sourceRefreshToken: string): string {
  if (entry && entry.sourceRefreshToken === sourceRefreshToken && entry.rotatedRefreshToken) {
    return entry.rotatedRefreshToken;
  }
  return sourceRefreshToken;
}

export function rememberRefreshedToken(
  sourceRefreshToken: string,
  accessToken: string,
  rotatedRefreshToken?: string
): void {
  entry = {
    sourceRefreshToken,
    accessToken,
    rotatedRefreshToken:
      rotatedRefreshToken ??
      (entry?.sourceRefreshToken === sourceRefreshToken ? entry.rotatedRefreshToken : undefined),
  };
}

export function forgetRefreshedToken(): void {
  entry = undefined;
}
