import { formatResets, windowLabel } from "../../domain/format";
import { AppState, ProviderSnapshot } from "../../domain/types";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById("root")!;

window.addEventListener("message", (ev: MessageEvent<{ type: string; state?: AppState }>) => {
  if (ev.data?.type === "state" && ev.data.state) {
    render(ev.data.state);
  }
});

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function meter(pct: number, warnAt = 90): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const warn = clamped >= warnAt ? " warn" : "";
  return `<div class="meter${warn}"><span style="width:${clamped}%"></span></div>`;
}

function renderSection(snap: ProviderSnapshot | undefined): string {
  if (!snap || snap.status === "disabled") {
    return "";
  }
  const name = snap.provider === "claude" ? "Claude" : "ChatGPT";
  const plan = snap.planType ? `<span class="plan">${esc(snap.planType)}</span>` : "";
  let body = "";

  if (snap.status !== "ok" && snap.windows.length === 0 && !snap.credits && !snap.monthly) {
    body += `<div class="status-msg">${esc(snap.error || snap.status)}</div>`;
  }

  for (const w of snap.windows) {
    const label = windowLabel(w.windowSeconds);
    body += `<div class="row">
      <div class="row-label"><span>${esc(label)}</span><span>${Math.round(w.usedPercent)}% · resets ${esc(formatResets(w))}</span></div>
      ${meter(w.usedPercent)}
    </div>`;
  }

  if (snap.provider === "chatgpt") {
    if (snap.credits) {
      let creditText = "No usage credits";
      if (snap.credits.unlimited) {
        creditText = "Unlimited";
      } else if (snap.credits.hasCredits && snap.credits.balance) {
        creditText = `$${esc(String(snap.credits.balance).replace(/^\$/, ""))}`;
      }
      body += `<div class="row">
        <div class="row-label"><span>Usage credits</span><span>${creditText}</span></div>
      </div>`;
      if (snap.credits.hasCredits && !snap.credits.unlimited) {
        body += `<div class="footer">Included plan usage is consumed first; credits apply after limits.</div>`;
      }
    }
    if (snap.monthly) {
      body += `<div class="row">
        <div class="row-label"><span>Monthly spend</span><span>${Math.round(snap.monthly.usedPercent)}% · $${snap.monthly.used.toFixed(2)} / $${snap.monthly.limit.toFixed(2)}</span></div>
        ${meter(snap.monthly.usedPercent)}
      </div>`;
    }
  }

  if (snap.codeReview) {
    body += `<div class="row">
      <div class="row-label"><span>Code review</span><span>${Math.round(snap.codeReview.usedPercent)}%</span></div>
      ${meter(snap.codeReview.usedPercent)}
    </div>`;
  }

  const age = snap.capturedAt ? Math.round((Date.now() - snap.capturedAt) / 1000) : 0;
  const ageLabel = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
  body += `<div class="footer">source: ${esc(snap.source)} · ${esc(ageLabel)}</div>`;

  return `<section class="section">
    <div class="section-title"><span class="name">${name}</span>${plan}</div>
    ${body}
  </section>`;
}

function render(state: AppState): void {
  const sections = [renderSection(state.claude), renderSection(state.chatgpt)].filter(Boolean);
  root.innerHTML = `
    <div class="header">
      <h1>Account usage</h1>
      <button class="refresh" id="refresh">Refresh</button>
    </div>
    ${sections.length ? sections.join("") : `<div class="muted">Enable Claude and/or ChatGPT in DualUsage settings.</div>`}
  `;
  document.getElementById("refresh")?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });
}
