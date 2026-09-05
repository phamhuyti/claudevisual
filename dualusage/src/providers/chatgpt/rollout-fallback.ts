import * as fs from "fs";
import * as path from "path";
import { FlexibleCredits, RateWindow } from "../../domain/types";

interface RolloutSnapshot {
  windows: RateWindow[];
  credits?: FlexibleCredits;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return undefined;
}

function windowFromRateLimits(
  rl: Record<string, unknown>,
  which: "primary" | "secondary"
): RateWindow | undefined {
  const node = asRecord(rl[which]) ?? asRecord(rl[`${which}_window`]);
  if (!node) {
    return undefined;
  }
  const ratio = asNumber(node.ratio);
  const used =
    asNumber(node.used_percent) ??
    asNumber(node.usedPercent) ??
    (ratio !== undefined ? ratio * 100 : undefined);
  if (used === undefined) {
    return undefined;
  }
  const minutes =
    asNumber(node.window_minutes) ??
    asNumber(node.windowMinutes) ??
    (asNumber(node.limit_window_seconds) !== undefined
      ? Math.ceil(asNumber(node.limit_window_seconds)! / 60)
      : undefined);
  const resetsAt = asNumber(node.resets_at) ?? asNumber(node.reset_at) ?? asNumber(node.resetsAt);
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    windowSeconds: minutes !== undefined ? minutes * 60 : asNumber(node.limit_window_seconds),
    resetsAt: resetsAt !== undefined ? Math.floor(resetsAt) : undefined,
  };
}

function parseLine(line: string): RolloutSnapshot | undefined {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined;
  }
  const root = asRecord(json);
  if (!root) {
    return undefined;
  }

  // Common shapes: { type, payload: { rate_limits } } or nested token_count events
  const payload = asRecord(root.payload) ?? root;
  const rateLimits =
    asRecord(payload.rate_limits) ??
    asRecord(payload.rateLimits) ??
    asRecord(asRecord(payload.info)?.rate_limits);

  const windows: RateWindow[] = [];
  if (rateLimits) {
    const p = windowFromRateLimits(rateLimits, "primary");
    const s = windowFromRateLimits(rateLimits, "secondary");
    if (p) {
      windows.push(p);
    }
    if (s) {
      windows.push(s);
    }
  }

  let credits: FlexibleCredits | undefined;
  const cred = asRecord(payload.credits) ?? asRecord(rateLimits?.credits);
  if (cred && cred.has_credits !== undefined) {
    const hasCredits = Boolean(cred.has_credits);
    credits = {
      hasCredits,
      unlimited: Boolean(cred.unlimited),
      balance:
        hasCredits && cred.balance != null && String(cred.balance).trim() !== ""
          ? String(cred.balance)
          : undefined,
    };
  }

  if (windows.length === 0 && !credits) {
    return undefined;
  }
  windows.sort((a, b) => (a.windowSeconds ?? 0) - (b.windowSeconds ?? 0));
  return { windows, credits };
}

function listRecentJsonl(sessionsRoot: string, maxFiles: number): string[] {
  if (!fs.existsSync(sessionsRoot)) {
    return [];
  }
  const files: { path: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 5) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const st = fs.statSync(full);
          files.push({ path: full, mtime: st.mtimeMs });
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(sessionsRoot, 0);
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, maxFiles).map((f) => f.path);
}

/**
 * Scan recent Codex rollout JSONL files for the newest rate_limits / credits snapshot.
 */
export function readRolloutUsage(codexHome: string): RolloutSnapshot | undefined {
  const sessionsRoot = path.join(codexHome, "sessions");
  const files = listRecentJsonl(sessionsRoot, 20);

  let best: RolloutSnapshot | undefined;
  for (const file of files) {
    let content: string;
    try {
      // Read only the last ~256KB to stay O(1)-ish on huge transcripts.
      const st = fs.statSync(file);
      const start = Math.max(0, st.size - 256_000);
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(st.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        content = buf.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) {
        continue;
      }
      const snap = parseLine(line);
      if (snap) {
        best = snap;
        break;
      }
    }
    if (best) {
      break;
    }
  }
  return best;
}
