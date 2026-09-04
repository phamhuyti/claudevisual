import { execFile } from "child_process";

const CLI_TIMEOUT_MS = 90_000;

export class ClaudeCliMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCliMissingError";
  }
}

/** Run `claude -p --no-session-persistence /usage` and return stdout. */
export function runClaudeUsageCommand(claudePath: string): Promise<string> {
  const bin = claudePath.trim() || "claude";
  const isWin = process.platform === "win32";
  return new Promise<string>((resolve, reject) => {
    execFile(
      bin,
      ["-p", "--no-session-persistence", "/usage"],
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, shell: isWin, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stdout && stdout.trim().length > 0) {
          resolve(stdout);
          return;
        }
        if (err) {
          const msg = err.message || String(err);
          const code = (err as NodeJS.ErrnoException).code;
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
  });
}
