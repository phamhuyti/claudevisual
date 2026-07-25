import { execFile } from "child_process";
import * as vscode from "vscode";
import { logDebug, logError } from "../diagnostics/logger";
import { AccountLimits, parseUsageText } from "./usage-limits";

/** Public snapshot the status bar renders. `status` distinguishes "no data
 *  yet" from "the CLI failed" so the UI can say something useful either way. */
export interface UsageSnapshot {
  limits?: AccountLimits;
  /** ms epoch of the last successful parse, or undefined if none yet. */
  capturedAt?: number;
  status: "disabled" | "idle" | "polling" | "ok" | "error";
  /** Short reason when status === "error" (CLI missing, signed out, reworded). */
  error?: string;
}

const CLI_TIMEOUT_MS = 90_000;
/** `/usage`'s summary comes from a network fetch that flakes ~1 in 3 runs; a
 *  few spaced retries within one poll ride out a single flake instead of
 *  dropping the whole interval. */
const REFRESH_TRIES = 3;
const RETRY_SPACING_MS = 8_000;
const MIN_INTERVAL_MIN = 1;
const DEFAULT_INTERVAL_MIN = 5;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Polls the account-wide 5h/7d rate-limit percentages by running the official
 * `claude -p --no-session-persistence /usage` headlessly on an interval.
 *
 * Deliberately conservative to honor ClaudeVisual's zero-overhead constraint:
 * one short-lived CLI spawn every few minutes, only while the VS Code window is
 * focused, and never on any Claude Code hot path. `--no-session-persistence`
 * keeps each run from dumping a transcript into ~/.claude/projects/.
 */
export class UsageLimitsPoller implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<UsageSnapshot>();
  readonly onDidChange = this.emitter.event;

  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private disposed = false;
  private snapshot: UsageSnapshot = { status: "idle" };
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // React to config changes (enable/disable, interval) live.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("claudevisual.limits")) {
          this.restart();
        }
      })
    );
    // When the window regains focus and the data is stale, refresh promptly
    // instead of waiting out the rest of the interval.
    this.disposables.push(
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.enabled() && this.isStale()) {
          void this.pollNow(false);
        }
      })
    );
  }

  /** Begin polling (or go straight to a disabled snapshot if turned off). */
  start(): void {
    this.restart();
  }

  /** Force a refresh now, regardless of focus/interval (the manual command). */
  refresh(): void {
    if (!this.enabled()) {
      return;
    }
    void this.pollNow(true);
  }

  get current(): UsageSnapshot {
    return this.snapshot;
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("claudevisual.limits");
  }

  private enabled(): boolean {
    return this.cfg().get<boolean>("enabled", true);
  }

  private intervalMs(): number {
    const min = Math.max(MIN_INTERVAL_MIN, this.cfg().get<number>("pollIntervalMinutes", DEFAULT_INTERVAL_MIN));
    return min * 60_000;
  }

  private isStale(): boolean {
    if (this.snapshot.capturedAt === undefined) {
      return true;
    }
    return Date.now() - this.snapshot.capturedAt > this.intervalMs();
  }

  private restart(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.disposed) {
      return;
    }
    if (!this.enabled()) {
      this.publish({ status: "disabled" });
      return;
    }
    // Prime after a short delay so activation isn't blocked by a CLI cold start.
    setTimeout(() => void this.pollNow(false), 4_000);
    this.timer = setInterval(() => {
      // Skip scheduled polls while the window is unfocused — no point spawning
      // the CLI for a HUD the user isn't looking at. A focus regain (above)
      // catches up on stale data.
      if (vscode.window.state.focused) {
        void this.pollNow(false);
      }
    }, this.intervalMs());
  }

  private async pollNow(force: boolean): Promise<void> {
    if (this.disposed || this.inFlight || !this.enabled()) {
      return;
    }
    if (!force && !this.isStale()) {
      return;
    }
    this.inFlight = true;
    if (this.snapshot.status === "idle") {
      this.publish({ ...this.snapshot, status: "polling" });
    }
    try {
      const limits = await this.fetchWithRetries();
      if (limits) {
        this.publish({ limits, capturedAt: Date.now(), status: "ok" });
      } else if (!this.snapshot.limits) {
        // Never parsed successfully yet — surface the failure so the UI isn't
        // stuck on "polling" forever.
        this.publish({ status: "error", error: "no usage data (CLI signed out or output changed)" });
      }
      // If we *did* have prior data, keep showing it (stale) rather than
      // blanking on a transient flake.
    } catch (err) {
      logError("usage poll failed", err);
      if (!this.snapshot.limits) {
        this.publish({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async fetchWithRetries(): Promise<AccountLimits | undefined> {
    for (let attempt = 0; attempt < REFRESH_TRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_SPACING_MS);
        if (this.disposed) {
          return undefined;
        }
      }
      const text = await this.runUsageCommand();
      const limits = parseUsageText(text);
      if (limits) {
        return limits;
      }
      logDebug(`/usage attempt ${attempt + 1}/${REFRESH_TRIES} yielded no parseable window`);
    }
    return undefined;
  }

  /** Run `claude -p --no-session-persistence /usage` and resolve its stdout.
   *  On Windows `claude` is an npm `.cmd` shim, so it must go through the shell
   *  to resolve; the command/args are fixed, nothing user-supplied is
   *  interpolated. A custom binary path can be set via config. */
  private runUsageCommand(): Promise<string> {
    const bin = this.cfg().get<string>("claudePath", "").trim() || "claude";
    const isWin = process.platform === "win32";
    return new Promise<string>((resolve, reject) => {
      execFile(
        bin,
        ["-p", "--no-session-persistence", "/usage"],
        { timeout: CLI_TIMEOUT_MS, windowsHide: true, shell: isWin, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          // `/usage` can exit non-zero yet still have printed the summary; the
          // text is authoritative, so prefer any non-empty stdout over the
          // error. Only reject when there is genuinely nothing to parse.
          if (stdout && stdout.trim().length > 0) {
            resolve(stdout);
          } else if (err) {
            reject(err);
          } else {
            resolve("");
          }
        }
      );
    });
  }

  private publish(next: UsageSnapshot): void {
    this.snapshot = next;
    this.emitter.fire(next);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}
