import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface CursorAuth {
  kind: "missing" | "signed_in";
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  membershipType?: string;
  dbPath: string;
}

const AUTH_KEYS = [
  "cursorAuth/accessToken",
  "cursorAuth/refreshToken",
  "cursorAuth/cachedEmail",
  "cursorAuth/stripeMembershipType",
] as const;

/** Resolve Cursor `state.vscdb` path (override, then OS default). */
export function resolveCursorStateDb(override: string): string {
  const trimmed = override.trim();
  if (trimmed) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, "User", "globalStorage", "state.vscdb");
    }
    return resolved;
  }
  return defaultStateDbPath();
}

export function defaultStateDbPath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      );
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(home, "AppData", "Roaming"),
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      );
    default:
      return path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
  }
}

/**
 * Read Cursor auth material from local state.vscdb.
 * Never logs token values. Does not write the database.
 */
export function readCursorAuth(dbPath: string): CursorAuth {
  if (!fs.existsSync(dbPath)) {
    return { kind: "missing", dbPath };
  }
  try {
    const values = readItemTableKeys(dbPath, AUTH_KEYS);
    const accessToken = cleanToken(values["cursorAuth/accessToken"]);
    const refreshToken = cleanToken(values["cursorAuth/refreshToken"]);
    const email = cleanToken(values["cursorAuth/cachedEmail"]);
    const membershipType = cleanToken(values["cursorAuth/stripeMembershipType"]);
    if (!accessToken && !refreshToken) {
      return { kind: "missing", dbPath };
    }
    return {
      kind: "signed_in",
      accessToken,
      refreshToken,
      email,
      membershipType,
      dbPath,
    };
  } catch {
    return { kind: "missing", dbPath };
  }
}

function cleanToken(v: string | undefined): string | undefined {
  if (!v) {
    return undefined;
  }
  const t = v.trim();
  // SQLite / storage sometimes wraps strings in quotes.
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim() || undefined;
  }
  return t || undefined;
}

function readItemTableKeys(
  dbPath: string,
  keys: readonly string[]
): Record<string, string | undefined> {
  const viaCli = trySqlite3(dbPath, keys);
  if (viaCli) {
    return viaCli;
  }
  const viaPy = tryPythonSqlite(dbPath, keys);
  if (viaPy) {
    return viaPy;
  }
  throw new Error("sqlite reader unavailable (need sqlite3 CLI or python3)");
}

function trySqlite3(
  dbPath: string,
  keys: readonly string[]
): Record<string, string | undefined> | undefined {
  // One query returning key|value pairs.
  const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
  const sql = `SELECT key, value FROM ItemTable WHERE key IN (${inList});`;
  const r = spawnSync("sqlite3", ["-separator", "\t", dbPath, sql], {
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    return undefined;
  }
  return parseTsvKeyValues(r.stdout || "");
}

function tryPythonSqlite(
  dbPath: string,
  keys: readonly string[]
): Record<string, string | undefined> | undefined {
  const script = `
import json, sqlite3, sys
db, keys = sys.argv[1], json.loads(sys.argv[2])
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = con.cursor()
q = "SELECT key, value FROM ItemTable WHERE key IN (%s)" % (",".join("?" for _ in keys),)
cur.execute(q, keys)
print(json.dumps({k: (v if isinstance(v, str) else (v.decode("utf-8", "replace") if isinstance(v, (bytes, bytearray)) else None)) for k, v in cur.fetchall()}))
con.close()
`.trim();
  const r = spawnSync("python3", ["-c", script, dbPath, JSON.stringify(keys)], {
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse((r.stdout || "").trim()) as Record<string, string | null>;
    const out: Record<string, string | undefined> = {};
    for (const k of keys) {
      out[k] = parsed[k] ?? undefined;
    }
    return out;
  } catch {
    return undefined;
  }
}

function parseTsvKeyValues(stdout: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab < 0) {
      continue;
    }
    out[line.slice(0, tab)] = line.slice(tab + 1);
  }
  return out;
}
