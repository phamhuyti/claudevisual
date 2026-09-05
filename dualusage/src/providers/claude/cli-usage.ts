import { execFile, ExecFileException } from "child_process";

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

function runOnce(claudePath: string, signal?: AbortSignal): Promise<string> {
  const bin = claudePath.trim() || "claude";
  const isWin = process.platform === "win32";
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const child = execFile(
      bin,
      ["-p", "--no-session-persistence", "/usage"],
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, shell: isWin, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        signal?.removeEventListener("abort", onAbort);
        if (stdout && stdout.trim().length > 0) {
          resolve(stdout);
          return;
        }
        if (err) {
          const msg = err.message || String(err);
          const code = (err as ExecFileException).code;
          if (code === "ENOENT" || /not found|ENOENT/i.test(msg)) {
            reject(new ClaudeCliMissingError(`claude executable not found (${bin})`));
            return;
          }
          reject(new Error(stderr?.trim() || msg));
          return;
        }
        resolve("");
      }
    );
    const onAbort = (): void => {
      child.kill();
      reject(signal?.reason ?? new Error("aborted"));
    };
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
