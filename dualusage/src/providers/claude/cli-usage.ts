import { ChildProcess, execFile, ExecFileException, ExecFileOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI_TIMEOUT_MS = 90_000;
/** Claude `/usage` flakes ~1/3 of the time; a few spaced retries ride that out. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 8_000;

export class ClaudeCliMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCliMissingError";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const USAGE_ARGS = ["-p", "--no-session-persistence", "/usage"];

const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Resolve `bin` to an executable file on Windows the way cmd.exe would (PATH ×
 * PATHEXT), without ever handing the string to a shell. Returns undefined when
 * nothing matches.
 */
export function resolveWindowsExecutable(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = isFile
): string | undefined {
  const hasDir = /[\\/]/.test(bin);
  const exts = (env.PATHEXT || WINDOWS_DEFAULT_PATHEXT)
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
  const dirs = hasDir ? [""] : (env.PATH || env.Path || "").split(";").filter(Boolean);
  for (const dir of dirs) {
    const base = hasDir ? bin : path.join(dir, bin);
    const candidates = path.extname(base) ? [base] : exts.map((e) => base + e);
    for (const candidate of candidates) {
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Escape a path for use as the command inside `cmd.exe /d /s /c "<cmd> <args>"`.
 * Every cmd metacharacter is `^`-escaped so a hostile path cannot chain commands.
 */
export function escapeForCmd(p: string): string {
  return p.replace(/([()[\]%!^"`<>&|;, *?])/g, "^$1");
}

function spawnClaude(
  bin: string,
  opts: ExecFileOptions,
  cb: (err: ExecFileException | null, stdout: string, stderr: string) => void
): ChildProcess {
  if (process.platform !== "win32") {
    return execFile(bin, USAGE_ARGS, { ...opts, encoding: "utf8" }, cb);
  }
  if (/[\r\n]/.test(bin)) {
    throw new ClaudeCliMissingError("claude path contains a newline");
  }
  const resolved = resolveWindowsExecutable(bin);
  if (!resolved) {
    throw new ClaudeCliMissingError(`claude executable not found (${bin})`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    // npm installs `claude` as a .cmd shim; batch files must go through cmd.exe.
    const commandLine = [escapeForCmd(resolved), ...USAGE_ARGS].join(" ");
    return execFile(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `"${commandLine}"`],
      { ...opts, encoding: "utf8", windowsVerbatimArguments: true },
      cb
    );
  }
  return execFile(resolved, USAGE_ARGS, { ...opts, encoding: "utf8" }, cb);
}

function runOnce(claudePath: string, signal?: AbortSignal): Promise<string> {
  const bin = claudePath.trim() || "claude";
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    let child: ChildProcess | undefined;
    const onAbort = (): void => {
      child?.kill();
      reject(signal?.reason ?? new Error("aborted"));
    };
    try {
      child = spawnClaude(
        bin,
        { timeout: CLI_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          signal?.removeEventListener("abort", onAbort);
          if (stdout && stdout.trim().length > 0) {
            resolve(stdout);
            return;
          }
          if (err) {
            const msg = err.message || String(err);
            if (err.code === "ENOENT" || /not found|ENOENT/i.test(msg)) {
              reject(new ClaudeCliMissingError(`claude executable not found (${bin})`));
              return;
            }
            reject(new Error(stderr?.trim() || msg));
            return;
          }
          resolve("");
        }
      );
    } catch (err) {
      reject(err);
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run `claude -p --no-session-persistence /usage` with retries; return stdout. */
export async function runClaudeUsageCommand(
  claudePath: string,
  signal?: AbortSignal
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("aborted");
    }
    try {
      const text = await runOnce(claudePath, signal);
      if (text.trim().length > 0 || attempt === MAX_ATTEMPTS) {
        return text;
      }
      // Empty stdout without error — treat as flake and retry.
    } catch (err) {
      if (err instanceof ClaudeCliMissingError) {
        throw err;
      }
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) {
        throw err;
      }
    }
    await sleep(RETRY_DELAY_MS, signal);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "claude /usage failed"));
}
