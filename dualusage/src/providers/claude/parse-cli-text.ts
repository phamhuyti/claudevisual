import { RateWindow } from "../../domain/types";

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b?\[[0-9;]*m/g;

function stripAnsi(line: string): string {
  return line.replace(ANSI_ESCAPE, "");
}

function matchWindow(text: string, label: RegExp, windowSeconds: number): RateWindow | undefined {
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
    return {
      usedPercent: percent,
      windowSeconds,
      resetsLabel: reset ? reset[1] : undefined,
    };
  }
  return undefined;
}

/**
 * Parse Claude Code `claude /usage` plain-text report into rate windows.
 * Expected lines (CLI v2.x):
 *   Current session: 32% used · resets …
 *   Current week (all models): 39% used · resets …
 */
export function parseClaudeUsageText(text: string): RateWindow[] {
  const windows: RateWindow[] = [];
  const session = matchWindow(text, /current session\b/i, 5 * 3600);
  if (session) {
    windows.push(session);
  }
  const week = matchWindow(text, /current week\s*\(all models\)/i, 7 * 86400);
  if (week) {
    windows.push(week);
  }
  // Optional model-specific week lines are ignored for the shared status model in v0.1.
  return windows;
}
