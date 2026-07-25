/**
 * Account-wide usage limits, parsed from the official `claude -p /usage`
 * plain-text report. These are the same 5-hour / 7-day rate-limit percentages
 * Claude Code shows for `/usage`, and — unlike everything else ClaudeVisual
 * surfaces — they are account-wide, not derived from any one session's JSONL.
 *
 * ClaudeVisual never touches credentials to get these: the numbers come from
 * the official Claude Code CLI's own sign-in, exactly as if the user had typed
 * `/usage`. This module only parses the text that headless mode prints.
 */

/** One rate-limit window (session=5h, week=7d) from the `/usage` report. */
export interface LimitWindow {
  /** Percent of the window consumed, 0–100 (1% granularity, same as `/usage`). */
  percent: number;
  /** Human-readable reset label as printed by the CLI, e.g.
   *  `Jul 16, 9:59am (Asia/Saigon)`. Absent if the CLI omitted it. */
  resetsLabel?: string;
}

/** The account-wide windows from one `/usage` run. At least one of `fiveHour`
 *  / `sevenDay` is present whenever this object exists (see `parseUsageText`). */
export interface AccountLimits {
  /** "Current session" line — the 5-hour window. */
  fiveHour?: LimitWindow;
  /** "Current week (all models)" line — the 7-day window. */
  sevenDay?: LimitWindow;
  /** "Current week (Fable)" line — only present once Fable has been used. */
  fableWeek?: LimitWindow;
}

// SGR color sequences: `ESC[…m`, with the ESC optional so a report that reaches
// us already partly de-escaped still gets cleaned.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b?\[[0-9;]*m/g;

/** Strip SGR color codes so a colorized `/usage` report still parses. */
function stripAnsi(line: string): string {
  return line.replace(ANSI_ESCAPE, "");
}

/** Find the first line matching `label` and pull `NN% used` + `resets …` out of
 *  it. Returns undefined when no line matches or the percent is missing. */
function matchWindow(text: string, label: RegExp): LimitWindow | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = stripAnsi(raw).trim();
    if (!label.test(line)) {
      continue;
    }
    const pct = line.match(/(\d{1,3})\s*%\s*used/i);
    if (!pct) {
      continue;
    }
    const percent = Math.min(100, Math.max(0, Number(pct[1])));
    const reset = line.match(/resets\s+(.+?)\s*$/i);
    return { percent, resetsLabel: reset ? reset[1] : undefined };
  }
  return undefined;
}

/**
 * Parse the `/usage` plain-text report. Expected lines (CLI v2.1, 2026-07):
 *
 *   Current session: 32% used · resets Jul 13, 3:29pm (Asia/Saigon)
 *   Current week (all models): 39% used · resets Jul 16, 9:59am (Asia/Saigon)
 *   Current week (Fable): 54% used · resets Jul 16, 9:59am (Asia/Saigon)
 *
 * "Current session" maps to the 5-hour window, "Current week (all models)" to
 * the 7-day window, and the optional Fable line to `fableWeek`.
 *
 * Returns undefined when *neither* account-wide window parsed — that happens
 * when the CLI reworded its output, or (common: ~1 in 3 runs) the network
 * fetch behind `/usage` flaked and the summary lines were omitted entirely.
 * The caller keeps the previous snapshot in that case. A Fable line alone is
 * never enough to accept a report.
 */
export function parseUsageText(text: string): AccountLimits | undefined {
  const fiveHour = matchWindow(text, /current session\b/i);
  const sevenDay = matchWindow(text, /current week\s*\(all models\)/i);
  const fableWeek = matchWindow(text, /current week\s*\(fable\)/i);

  if (!fiveHour && !sevenDay) {
    return undefined;
  }
  return { fiveHour, sevenDay, fableWeek };
}
