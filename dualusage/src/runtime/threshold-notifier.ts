import * as vscode from "vscode";
import { AppState, ProviderId, ProviderSnapshot } from "../domain/types";
import { readSettings } from "./settings";

/**
 * Fires a VS Code toast the first time a provider crosses a warn threshold,
 * and not again until that exact key clears — so a 90% warning toasts once
 * per crossing, never once per poll tick.
 */
export class ThresholdNotifier implements vscode.Disposable {
  private readonly active = new Set<string>();

  update(state: AppState): void {
    const settings = readSettings();
    if (!settings.notificationsEnabled) {
      this.active.clear();
      return;
    }
    const threshold =
      settings.notificationsPercent > 0 ? settings.notificationsPercent : settings.warnPercent;
    const still = new Set<string>();

    for (const id of ["claude", "chatgpt", "cursor"] as ProviderId[]) {
      const snap = state[id];
      if (!snap || snap.status === "disabled") {
        continue;
      }
      for (const key of thresholdKeys(snap, threshold, settings.creditsWarnBalance)) {
        still.add(key);
        if (this.active.has(key)) {
          continue;
        }
        this.active.add(key);
        void vscode.window.showWarningMessage(messageFor(key, snap));
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

function thresholdKeys(
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
      keys.push(`${snap.provider}|window:${i}`);
    }
  });
  if (snap.monthly && snap.monthly.usedPercent >= warnPercent) {
    keys.push(`${snap.provider}|monthly`);
  }
  if (snap.credits?.hasCredits && !snap.credits.unlimited && snap.credits.balance) {
    const n = Number(String(snap.credits.balance).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n < creditsWarnBalance) {
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
  const worst = snap.windows.reduce((m, w) => Math.max(m, w.usedPercent), 0);
  return `${name}: usage is ${Math.round(worst)}%.`;
}
