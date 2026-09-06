import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface CursorAuth {
  /**
   * - `signed_in`: tokens found.
   * - `missing`: no database, or the database has no Cursor auth entries.
   * - `unreadable`: the database exists but could not be queried (no reader
   *   available, locked, corrupt…). `reason` says why.
   */
  kind: "missing" | "signed_in" | "unreadable";
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  membershipType?: string;
  dbPath: string;
  reason?: string;
}

const AUTH_KEYS = [
  "cursorAuth/accessToken",
  "cursorAuth/refreshToken",
  "cursorAuth/cachedEmail",
  "cursorAuth/stripeMembershipType",
] as const;

const READER_TIMEOUT_MS = 8_000;

type KeyValues = Record<string, string | undefined>;

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
 * Never logs token values. Does not write the database. Never blocks the
 * extension host: external readers are spawned asynchronously.
 */
export async function readCursorAuth(dbPath: string, signal?: AbortSignal): Promise<CursorAuth> {
  if (!fs.existsSync(dbPath)) {
    return { kind: "missing", dbPath, reason: "state.vscdb not found" };
  }
  let values: KeyValues;
  try {
    values = await readItemTableKeys(dbPath, AUTH_KEYS, signal);
  } catch (err) {
    return {
      kind: "unreadable",
      dbPath,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  const accessToken = cleanToken(values["cursorAuth/accessToken"]);
  const refreshToken = cleanToken(values["cursorAuth/refreshToken"]);
  const email = cleanToken(values["cursorAuth/cachedEmail"]);
  const membershipType = cleanToken(values["cursorAuth/stripeMembershipType"]);
  if (!accessToken && !refreshToken) {
    return { kind: "missing", dbPath, reason: "no cursorAuth entries in state.vscdb" };
  }
  return {
    kind: "signed_in",
    accessToken,
    refreshToken,
    email,
    membershipType,
    dbPath,
  };
}

function cleanToken(v: string | undefined): string | undefined {
  if (!v) {
    return undefined;
  }
  const t = v.trim();
  // SQLite / storage sometimes wraps strings in quotes.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim() || undefined;
  }
  return t || undefined;
}

async function readItemTableKeys(
  dbPath: string,
  keys: readonly string[],
  signal?: AbortSignal
): Promise<KeyValues> {
  const reasons: string[] = [];

  const builtin = tryNodeSqlite(dbPath, keys);
  if (builtin.ok) {
    return builtin.values;
  }
  reasons.push(builtin.reason);

  const viaCli = await trySqlite3(dbPath, keys, signal);
  if (viaCli.ok) {
    return viaCli.values;
  }
  reasons.push(viaCli.reason);

  const viaPy = await tryPythonSqlite(dbPath, keys, signal);
  if (viaPy.ok) {
    return viaPy.values;
  }
  reasons.push(viaPy.reason);

  throw new Error(`cannot read state.vscdb (${reasons.join("; ")})`);
}

type ReaderResult = { ok: true; values: KeyValues } | { ok: false; reason: string };

interface NodeSqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean }
  ) => {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
    close(): void;
  };
}

/** Node ≥ 22.13 ships `node:sqlite`; VS Code's Electron picks it up from 1.102 on. */
function loadNodeSqlite(): NodeSqliteModule | undefined {
  const getBuiltin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltin !== "function") {
    return undefined;
  }
  try {
    const mod = getBuiltin.call(process, "node:sqlite") as NodeSqliteModule | undefined;
    return mod && typeof mod.DatabaseSync === "function" ? mod : undefined;
  } catch {
    return undefined;
  }
}

function tryNodeSqlite(dbPath: string, keys: readonly string[]): ReaderResult {
  const sqlite = loadNodeSqlite();
  if (!sqlite) {
    return { ok: false, reason: "node:sqlite unavailable" };
  }
  let db: InstanceType<NodeSqliteModule["DatabaseSync"]> | undefined;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const placeholders = keys.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT key, value FROM ItemTable WHERE key IN (${placeholders})`)
      .all(...keys) as Array<{ key?: unknown; value?: unknown }>;
    const out: KeyValues = {};
    for (const row of rows) {
      if (typeof row.key !== "string") {
        continue;
      }
      out[row.key] = blobToString(row.value);
    }
    return { ok: true, values: out };
  } catch (err) {
    return {
      ok: false,
      reason: `node:sqlite: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function blobToString(v: unknown): string | undefined {
  if (typeof v === "string") {
    return v;
  }
  if (v instanceof Uint8Array) {
    return Buffer.from(v).toString("utf8");
  }
  return v === null || v === undefined ? undefined : String(v);
}

function run(
  file: string,
  args: string[],
  signal?: AbortSignal
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        timeout: READER_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        signal,
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const reason =
            code === "ENOENT"
              ? `${file} not found`
              : (stderr || err.message || String(err)).trim().split(/\r?\n/)[0];
          resolve({ ok: false, reason: `${file}: ${reason}` });
          return;
        }
        resolve({ ok: true, stdout });
      }
    );
  });
}

async function trySqlite3(
  dbPath: string,
  keys: readonly string[],
  signal?: AbortSignal
): Promise<ReaderResult> {
  const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
  const sql = `SELECT key, value FROM ItemTable WHERE key IN (${inList});`;
  const r = await run("sqlite3", ["-readonly", "-separator", "\t", dbPath, sql], signal);
  if (!r.ok) {
    return r;
  }
  return { ok: true, values: parseTsvKeyValues(r.stdout) };
}

async function tryPythonSqlite(
  dbPath: string,
  keys: readonly string[],
  signal?: AbortSignal
): Promise<ReaderResult> {
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
  const python = process.platform === "win32" ? "python" : "python3";
  const r = await run(python, ["-c", script, dbPath, JSON.stringify(keys)], signal);
  if (!r.ok) {
    return r;
  }
  try {
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, string | null>;
    const out: KeyValues = {};
    for (const k of keys) {
      out[k] = parsed[k] ?? undefined;
    }
    return { ok: true, values: out };
  } catch {
    return { ok: false, reason: `${python}: unexpected output` };
  }
}

function parseTsvKeyValues(stdout: string): KeyValues {
  const out: KeyValues = {};
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
