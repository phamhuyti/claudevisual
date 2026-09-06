import * as vscode from "vscode";
import { parseBalanceNumber } from "../domain/format";
import { AppState, PROVIDER_IDS, ProviderSnapshot, RateWindow } from "../domain/types";
import { readSettings, warnPercentFor } from "./settings";

/** A key clears only once usage drops this far below the threshold. */
export const HYSTERESIS_PERCENT = 5;

/**
 * Fires a VS Code toast the first time a provider crosses a warn threshold,
 * and not again until that key clears (with hysteresis) — so a 90% warning
 * toasts once per crossing, never once per poll tick or on 89.9 ↔ 90.1 jitter.
 *
 * Snapshots hydrated from globalState (`cached`) seed the active set silently:
 * they were already announced in the session that captured them.
 */
export class ThresholdNotifier implements vscode.Disposable {
  private readonly active = new Set<string>();

  update(state: AppState): void {
    const settings = readSettings();
    if (!settings.notificationsEnabled) {
      this.active.clear();
      return;
    }
    const still = new Set<string>();

    for (const id of PROVIDER_IDS) {
      const snap = state[id];
      if (!snap || snap.status === "disabled") {
        continue;
      }
      const threshold =
        settings.notificationsPercent > 0
          ? settings.notificationsPercent
          : warnPercentFor(id, settings);

      // Keys currently above the (lower, hysteresis) bound keep an existing toast "armed".
      for (const key of thresholdKeys(
        snap,
        Math.max(0, threshold - HYSTERESIS_PERCENT),
        settings.creditsWarnBalance
      )) {
        if (this.active.has(key)) {
          still.add(key);
        }
      }
      for (const key of thresholdKeys(snap, threshold, settings.creditsWarnBalance)) {
        still.add(key);
        if (this.active.has(key)) {
          continue;
        }
        this.active.add(key);
        if (!snap.cached) {
          void vscode.window.showWarningMessage(messageFor(key, snap));
        }
      }
    }

    for (const key of [...this.active]) {
      if (!still.has(key)) {
        this.active.delete(key);
      }
    }
  }

  dispose(): void {
    this.active.clear();
  }
}

function windowKey(w: RateWindow, index: number): string {
  return w.windowSeconds !== undefined ? `window:${w.windowSeconds}` : `window:#${index}`;
}

export function thresholdKeys(
  snap: ProviderSnapshot,
  warnPercent: number,
  creditsWarnBalance: number
): string[] {
  const keys: string[] = [];
  if (snap.limitReached) {
    keys.push(`${snap.provider}|limitReached`);
  }
  if (snap.spendControlReached) {
    keys.push(`${snap.provider}|spendControl`);
  }
  if (snap.credits?.overageLimitReached) {
    keys.push(`${snap.provider}|overage`);
  }
  snap.windows.forEach((w, i) => {
    if (w.usedPercent >= warnPercent) {
      keys.push(`${snap.provider}|${windowKey(w, i)}`);
    }
  });
  if (snap.codeReview && snap.codeReview.usedPercent >= warnPercent) {
    keys.push(`${snap.provider}|codeReview`);
  }
  if (snap.monthly && snap.monthly.usedPercent >= warnPercent) {
    keys.push(`${snap.provider}|monthly`);
  }
  if (snap.credits?.hasCredits && !snap.credits.unlimited) {
    const n = parseBalanceNumber(snap.credits.balance);
    if (n !== undefined && n < creditsWarnBalance) {
      keys.push(`${snap.provider}|creditsLow`);
    }
  }
  return keys;
}

function messageFor(key: string, snap: ProviderSnapshot): string {
  const name =
    snap.provider === "claude" ? "Claude" : snap.provider === "chatgpt" ? "ChatGPT" : "Cursor";
  if (key.endsWith("|limitReached")) {
    return `${name}: rate limit reached.`;
  }
  if (key.endsWith("|spendControl")) {
    return `${name}: spend control reached.`;
  }
  if (key.endsWith("|overage")) {
    return `${name}: overage limit reached.`;
  }
  if (key.endsWith("|creditsLow")) {
    return `${name}: credits/on-demand balance is low.`;
  }
  if (key.endsWith("|monthly")) {
    return `${name}: monthly spend is ${Math.round(snap.monthly?.usedPercent ?? 0)}%.`;
  }
  if (key.endsWith("|codeReview")) {
    return `${name}: code review usage is ${Math.round(snap.codeReview?.usedPercent ?? 0)}%.`;
  }
  const worst = snap.windows.reduce((m, w) => Math.max(m, w.usedPercent), 0);
  return `${name}: usage is ${Math.round(worst)}%.`;
}
