import type { LimitsViewModel } from "../webview-view/sidebar-messages";
import { esc } from "./dom-utils";

/**
 * Account-wide limits header pinned above the session list: `5h X% · 7d Y%`.
 * Account-wide, so it renders even with no active session. Non-interactive —
 * refreshing is the status-bar item's / command's job; this is a readout.
 */
export function renderLimits(limits: LimitsViewModel | undefined): string {
  // Feature off, or no snapshot has reached the sidebar yet — render nothing so
  // the header doesn't flicker in/out.
  if (!limits || limits.status === "disabled") {
    return "";
  }

  if (limits.status === "error" && limits.fiveHourPercent === undefined && limits.sevenDayPercent === undefined) {
    return `<div class="cv-limits cv-limits-err" title="${esc(limits.error ?? "usage unavailable")}">` +
      `<span class="lim-label">account limits</span><span class="lim-val">unavailable</span></div>`;
  }

  const cells: string[] = [];
  if (limits.fiveHourPercent !== undefined) {
    cells.push(cell("5h", limits.fiveHourPercent, limits.fiveHourResets, limits.warnPercent));
  }
  if (limits.sevenDayPercent !== undefined) {
    cells.push(cell("7d", limits.sevenDayPercent, limits.sevenDayResets, limits.warnPercent));
  }

  if (cells.length === 0) {
    // status "polling"/"idle" with no numbers yet.
    return `<div class="cv-limits cv-limits-wait"><span class="lim-label">account limits</span>` +
      `<span class="lim-val">…</span></div>`;
  }

  return `<div class="cv-limits"><span class="lim-label">account</span>${cells.join("")}</div>`;
}

function cell(name: string, percent: number, resets: string | undefined, warnPercent: number): string {
  const sev = percent >= warnPercent ? " over" : percent >= warnPercent - 15 ? " near" : "";
  const width = Math.min(100, Math.max(0, percent));
  const title = resets ? `${name}: ${percent}% used · resets ${resets}` : `${name}: ${percent}% used`;
  return (
    `<span class="lim-cell${sev}" title="${esc(title)}">` +
    `<span class="lim-name">${name}</span>` +
    `<span class="lim-bar"><span class="lim-fill" style="width:${width}%"></span></span>` +
    `<span class="lim-pct">${percent}%</span>` +
    `</span>`
  );
}
