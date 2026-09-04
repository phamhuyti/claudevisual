import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type AuthKind = "missing" | "api_key_only" | "chatgpt_oauth";

export interface CodexAuth {
  kind: AuthKind;
  accessToken?: string;
  accountId?: string;
  authPath: string;
}

export function resolveCodexHome(override: string): string {
  const trimmed = override.trim();
  if (trimmed) {
    return path.resolve(trimmed);
  }
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim()) {
    return path.resolve(process.env.CODEX_HOME.trim());
  }
  return path.join(os.homedir(), ".codex");
}

/**
 * Read ~/.codex/auth.json. Never logs token values.
 * api_key_only: OPENAI_API_KEY style / tokens without ChatGPT account id.
 */
export function readCodexAuth(codexHome: string): CodexAuth {
  const authPath = path.join(codexHome, "auth.json");
  if (!fs.existsSync(authPath)) {
    return { kind: "missing", authPath };
  }
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    const tokens = (json.tokens && typeof json.tokens === "object" ? json.tokens : json) as Record<
      string,
      unknown
    >;
    const accessToken =
      typeof tokens.access_token === "string"
        ? tokens.access_token
        : typeof tokens.accessToken === "string"
          ? tokens.accessToken
          : undefined;
    const accountId =
      typeof tokens.account_id === "string"
        ? tokens.account_id
        : typeof tokens.accountId === "string"
          ? tokens.accountId
          : typeof json.account_id === "string"
            ? json.account_id
            : undefined;

    const apiKey =
      typeof json.OPENAI_API_KEY === "string"
        ? json.OPENAI_API_KEY
        : typeof json.api_key === "string"
          ? json.api_key
          : undefined;

    if (accessToken && accountId) {
      return { kind: "chatgpt_oauth", accessToken, accountId, authPath };
    }
    if (apiKey || accessToken) {
      return { kind: "api_key_only", accessToken, accountId, authPath };
    }
    return { kind: "missing", authPath };
  } catch {
    return { kind: "missing", authPath };
  }
}
