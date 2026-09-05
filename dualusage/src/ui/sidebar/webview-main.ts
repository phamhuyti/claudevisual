import {
  formatCountdown,
  formatResets,
  pacePercent,
  severityForPercent,
  soonestResetsAt,
  windowLabel,
  worstUsedPercent,
  type Severity,
} from "../../domain/format";
import {
  AppState,
  HistoryState,
  ProviderId,
  ProviderSnapshot,
  RateWindow,
  SnapshotStatus,
} from "../../domain/types";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): Persisted | undefined;
  setState(state: Persisted): void;
};

interface WebviewSettings {
  warnPercent: number;
  creditsWarnBalance: number;
  warnPercentByProvider: Record<ProviderId, number>;
  providersOrder: ProviderId[];
  pollIntervalMinutes: number;
  pollIntervalByProvider: Record<ProviderId, number>;
}

interface Persisted {
  collapsed?: Partial<Record<ProviderId, boolean>>;
}

const vscode = acquireVsCodeApi();
const root = document.getElementById("root")!;
const DEFAULT_ORDER: ProviderId[] = ["claude", "chatgpt", "cursor"];

let settings: WebviewSettings = {
  warnPercent: 90,
  creditsWarnBalance: 1,
  warnPercentByProvider: { claude: 90, chatgpt: 90, cursor: 90 },
  providersOrder: [...DEFAULT_ORDER],
  pollIntervalMinutes: 1,
  pollIntervalByProvider: { claude: 1, chatgpt: 1, cursor: 1 },
};
let state: AppState = {};
let history: HistoryState = { points: [] };
let persisted: Persisted = vscode.getState() ?? { collapsed: {} };
let tick: number | undefined;

window.addEventListener(
  "message",
  (
    ev: MessageEvent<{
      type: string;
      state?: AppState;
      settings?: WebviewSettings;
      history?: HistoryState;
    }>
  ) => {
    if (ev.data?.settings) {
      settings = ev.data.settings;
    }
    if (ev.data?.history) {
      history = ev.data.history;
    }
    if (ev.data?.type === "state" && ev.data.state) {
      state = ev.data.state;
      render();
      startTick();
    } else if (ev.data?.type === "settings" || ev.data?.type === "history") {
      render();
    }
  }
);

vscode.postMessage({ type: "ready" });

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sevClass(sev: Severity): string {
  return sev === "crit" ? "sev-crit" : sev === "warn" ? "sev-warn" : "sev-ok";
}

function nameOf(id: ProviderId): string {
  return id === "claude" ? "Claude" : id === "chatgpt" ? "ChatGPT" : "Cursor";
}

function markOf(id: ProviderId): string {
  return id === "claude" ? "C" : id === "chatgpt" ? "G" : "Cu";
}

function providerOrder(): ProviderId[] {
  const raw = settings.providersOrder?.length ? settings.providersOrder : DEFAULT_ORDER;
  const seen = new Set<ProviderId>();
  const out: ProviderId[] = [];
  for (const id of raw) {
    if ((id === "claude" || id === "chatgpt" || id === "cursor") && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) {
      out.push(id);
    }
  }
  return out;
}

function warnAt(id: ProviderId): number {
  return settings.warnPercentByProvider?.[id] ?? settings.warnPercent;
}

function statusInfo(status: SnapshotStatus): { label: string; cls: string } {
  switch (status) {
    case "ok":
      return { label: "ok", cls: "ok" };
    case "polling":
      return { label: "polling", cls: "polling" };
    case "signed_out":
      return { label: "signed out", cls: "err" };
    case "cli_missing":
      return { label: "cli missing", cls: "err" };
    case "api_key_only":
      return { label: "api key", cls: "warn" };
    case "error":
      return { label: "error", cls: "err" };
    case "disabled":
      return { label: "off", cls: "" };
    default:
      return { label: String(status), cls: "warn" };
  }
}

function collapsed(id: ProviderId): boolean {
  return persisted.collapsed?.[id] === true;
}

function toggle(id: ProviderId): void {
  const next = { ...(persisted.collapsed ?? {}) };
  next[id] = !collapsed(id);
  persisted = { collapsed: next };
  vscode.setState(persisted);
  render();
}

function cta(snap: ProviderSnapshot): { message: string; settings?: boolean } {
  if (snap.status === "cli_missing") {
    return {
      message: "Claude Code CLI not found. Install it or set dualusage.claudePath.",
      settings: true,
    };
  }
  if (snap.status === "signed_out") {
    if (snap.provider === "chatgpt") {
      return { message: "Sign in to the ChatGPT / Codex extension (ChatGPT login, not API key)." };
    }
    if (snap.provider === "cursor") {
      return { message: "Sign in to the Cursor desktop app so DualUsage can read local auth." };
    }
    return { message: "Sign in with the Claude Code CLI (`claude auth login`)." };
  }
  if (snap.status === "api_key_only") {
    return { message: "API-key auth cannot query plan usage — sign in with ChatGPT." };
  }
  return { message: snap.error || "Failed to load usage.", settings: true };
}

function sparkline(id: ProviderId): string {
  const vals = history.points.map((p) => p[id]).filter((v): v is number => typeof v === "number");
  if (vals.length < 2) {
    return "";
  }
  const w = 72;
  const h = 20;
  const step = w / (vals.length - 1);
  const pts = vals
    .map((v, i) => {
      const x = i * step;
      const y = h - (Math.min(100, Math.max(0, v)) / 100) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<div class="spark-wrap" title="Usage history (worst %)">
    <svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"></polyline>
    </svg>
  </div>`;
}

function ring(pct: number, sev: Severity): string {
  const r = 30;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c * (1 - clamped / 100);
  return `<div class="ring" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamped)}" aria-label="${Math.round(clamped)} percent used">
    <svg viewBox="0 0 72 72" aria-hidden="true">
      <circle class="track" cx="36" cy="36" r="${r}"></circle>
      <circle class="fill ${sevClass(sev)}" cx="36" cy="36" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
    </svg>
    <div class="ring-center"><span class="pct">${Math.round(clamped)}%</span><span class="lbl">used</span></div>
  </div>`;
}

function meter(pct: number, warn: number, pace?: number, label = "Usage"): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const sev = severityForPercent(clamped, warn);
  const paceEl =
    pace !== undefined
      ? `<span class="pace" style="left:${Math.min(100, Math.max(0, pace))}%" title="Even-pace marker"></span>`
      : "";
  return `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(clamped)}" aria-label="${esc(label)}">
    <span class="fill ${sevClass(sev)}" style="width:${clamped}%"></span>${paceEl}
  </div>`;
}

function windowBlock(w: RateWindow, warn: number, primary: boolean): string {
  const label = windowLabel(w.windowSeconds);
  const sev = severityForPercent(w.usedPercent, warn);
  const cd = formatCountdown(w.resetsAt);
  const abs = formatResets(w);
  const pace = pacePercent(w.windowSeconds, w.resetsAt);
  if (primary) {
    return `<div class="ring-wrap">
      ${ring(w.usedPercent, sev)}
      <div class="ring-meta">
        <div class="title">${esc(label)} window</div>
        <div class="sub" data-reset-at="${w.resetsAt ?? ""}" title="${esc(abs)}">resets in ${esc(cd)}</div>
      </div>
    </div>`;
  }
  return `<div class="meter-row">
    <div class="meter-label">
      <span class="left">${esc(label)}</span>
      <span class="right">${Math.round(w.usedPercent)}% · <span data-reset-at="${w.resetsAt ?? ""}" title="${esc(abs)}">${esc(cd)}</span></span>
    </div>
    ${meter(w.usedPercent, warn, pace, `${label} usage`)}
  </div>`;
}

function card(snap: ProviderSnapshot | undefined): string {
  if (!snap || snap.status === "disabled") {
    return "";
  }
  const id = snap.provider;
  const isCollapsed = collapsed(id);
  const chip = statusInfo(snap.status);
  const warn = warnAt(id);
  const worst = worstUsedPercent(snap);
  const soonest = soonestResetsAt(snap);
  const glanceSev = worst !== undefined ? severityForPercent(worst, warn) : "ok";
  const plan = snap.planType ? `<span class="plan-badge">${esc(snap.planType)}</span>` : "";
  const email = snap.email
    ? `<div class="email" title="${esc(snap.email)}">${esc(snap.email)}</div>`
    : "";
  const ctx = esc(
    JSON.stringify({
      webviewSection: "providerCard",
      provider: id,
      preventDefaultContextMenuItems: true,
    })
  );

  const hasData = snap.windows.length > 0 || !!snap.credits || !!snap.monthly || !!snap.codeReview;
  let body = "";

  if (snap.status !== "ok" && !hasData) {
    const action = cta(snap);
    body = `<div class="cta-block">
      <div class="msg">${esc(action.message)}</div>
      <div class="cta-actions">
        ${action.settings ? `<button type="button" class="btn primary" data-action="settings">Open Settings</button>` : ""}
        <button type="button" class="btn" data-action="usage" data-provider="${id}">Open usage page</button>
      </div>
    </div>`;
  } else {
    if (snap.limitReached || snap.spendControlReached || snap.credits?.overageLimitReached) {
      const bits: string[] = [];
      if (snap.limitReached) {
        bits.push("Rate limit reached");
      }
      if (snap.spendControlReached) {
        bits.push("Spend control reached");
      }
      if (snap.credits?.overageLimitReached) {
        bits.push("Overage limit reached");
      }
      body += `<div class="banner" role="alert">${esc(bits.join(" · "))}</div>`;
    }

    snap.windows.forEach((w, i) => {
      body += windowBlock(w, warn, i === 0);
    });
    if (snap.codeReview) {
      body += windowBlock(snap.codeReview, warn, snap.windows.length === 0);
    }

    if (snap.credits) {
      let text = snap.provider === "cursor" ? "On-demand: none" : "Credits: none";
      let creditWarn = false;
      if (snap.credits.unlimited) {
        text = snap.provider === "cursor" ? "On-demand: unlimited" : "Credits: unlimited";
      } else if (snap.credits.hasCredits && snap.credits.balance) {
        const bal = String(snap.credits.balance).replace(/^\$/, "");
        text = snap.provider === "cursor" ? `On-demand: $${bal} left` : `Credits: $${bal} left`;
        const n = Number(bal.replace(/[^0-9.]/g, ""));
        if (Number.isFinite(n) && n < settings.creditsWarnBalance) {
          creditWarn = true;
        }
      }
      body += `<div class="stat-row"><span class="stat-chip${creditWarn ? " warn" : ""}">${esc(text)}</span>`;
      if (snap.resetCreditsAvailable !== undefined && snap.resetCreditsAvailable > 0) {
        body += `<span class="stat-chip">${snap.resetCreditsAvailable} reset credit${
          snap.resetCreditsAvailable === 1 ? "" : "s"
        }</span>`;
      }
      body += `</div>`;
      if (snap.provider === "chatgpt" && snap.credits.hasCredits && !snap.credits.unlimited) {
        body += `<div class="card-foot">Included plan usage is consumed first; credits apply after limits.</div>`;
      }
    }

    if (snap.monthly) {
      const label = snap.provider === "cursor" ? "Plan spend" : "Monthly spend";
      body += `<div class="meter-row">
        <div class="meter-label">
          <span class="left">${label}</span>
          <span class="right">$${snap.monthly.used.toFixed(2)} / $${snap.monthly.limit.toFixed(2)} · <span data-reset-at="${snap.monthly.resetsAt ?? ""}">${esc(formatCountdown(snap.monthly.resetsAt))}</span></span>
        </div>
        ${meter(snap.monthly.usedPercent, warn, undefined, label)}
      </div>`;
    }

    body += sparkline(id);

    if (snap.promoMessage) {
      body += `<div class="card-foot">${esc(snap.promoMessage)}</div>`;
    }

    const ageSec = Math.round((Date.now() - snap.capturedAt) / 1000);
    const ageLabel = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
    const badges: string[] = [`<span class="badge">${esc(snap.source)}</span>`];
    if (snap.cached) {
      badges.push(`<span class="badge cached">cached</span>`);
    }
    if (snap.stale) {
      badges.push(`<span class="badge stale">stale</span>`);
    }
    body += `<div class="card-foot">
      ${badges.join("")}
      <span data-captured-at="${snap.capturedAt}">${esc(ageLabel)}</span>
      <button type="button" class="linkish" data-action="usage" data-provider="${id}">Usage page</button>
    </div>`;
  }

  const glancePct =
    worst !== undefined
      ? `<span class="pct ${sevClass(glanceSev)}">${Math.round(worst)}%</span>`
      : `<span class="pct">—</span>`;
  const glanceReset =
    soonest !== undefined
      ? `<span class="reset" data-reset-at="${soonest}">reset ${esc(formatCountdown(soonest))}</span>`
      : "";

  return `<section class="card${isCollapsed ? " collapsed" : ""}" data-provider="${id}" data-vscode-context="${ctx}">
    <button type="button" class="card-head" aria-expanded="${isCollapsed ? "false" : "true"}" data-toggle="${id}">
      <span class="mono-mark" aria-hidden="true">${markOf(id)}</span>
      <span class="card-title">
        <span class="name">${nameOf(id)}</span>${plan}
        ${email}
      </span>
      <span class="glance">${glancePct}${glanceReset}</span>
      <span class="status-chip ${chip.cls}">${chip.label}</span>
      <span class="chev" aria-hidden="true">▸</span>
    </button>
    <div class="card-body">${body}</div>
  </section>`;
}

function newestCaptured(): number | undefined {
  let newest: number | undefined;
  for (const id of providerOrder()) {
    const snap = state[id];
    if (snap?.capturedAt && (newest === undefined || snap.capturedAt > newest)) {
      newest = snap.capturedAt;
    }
  }
  return newest;
}

function render(): void {
  const order = providerOrder();
  const cards = order.map((id) => card(state[id])).filter(Boolean);
  const enabled = order.filter((id) => state[id] && state[id]!.status !== "disabled").length;
  const polling = order.some((id) => state[id]?.status === "polling");
  const captured = newestCaptured();
  const ageSec = captured !== undefined ? Math.round((Date.now() - captured) / 1000) : undefined;
  const ageLabel =
    ageSec === undefined
      ? "waiting…"
      : ageSec < 60
        ? `updated ${ageSec}s ago`
        : `updated ${Math.round(ageSec / 60)}m ago`;

  let body: string;
  if (enabled === 0) {
    body = `<div class="empty">
      <div class="icon" aria-hidden="true">◐</div>
      <p>No providers enabled. Turn on Claude, ChatGPT, and/or Cursor in DualUsage settings.</p>
      <div class="cta-actions">
        <button type="button" class="btn primary" data-action="settings">Open Settings</button>
        <button type="button" class="btn" data-action="toggle">Toggle providers</button>
      </div>
    </div>`;
  } else if (cards.length === 0) {
    body = `<div class="card skel"><div class="skel-bar" style="width:40%"></div><div class="skel-bar"></div><div class="skel-bar" style="width:70%"></div></div>
      <div class="card skel"><div class="skel-bar" style="width:35%"></div><div class="skel-bar"></div></div>`;
  } else {
    body = cards.join("");
  }

  root.innerHTML = `
    <header class="header">
      <div class="header-text">
        <h1>Account usage</h1>
        <div class="header-meta" aria-live="polite">
          ${polling ? `<span class="polling"><span class="spinner"></span>polling</span> · ` : ""}
          <span data-captured-at="${captured ?? ""}">${esc(ageLabel)}</span>
        </div>
      </div>
    </header>
    <div aria-live="polite">${body}</div>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggle(btn.getAttribute("data-toggle") as ProviderId));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="settings"]').forEach((btn) => {
    btn.addEventListener("click", () => vscode.postMessage({ type: "openSettings" }));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", () => vscode.postMessage({ type: "toggleProvider" }));
  });
  root.querySelectorAll<HTMLElement>('[data-action="usage"]').forEach((el) => {
    el.addEventListener("click", () =>
      vscode.postMessage({
        type: "openUsagePage",
        provider: el.getAttribute("data-provider"),
      })
    );
  });
}

function refreshRelativeTimes(): void {
  const now = Date.now();
  root.querySelectorAll<HTMLElement>("[data-reset-at]").forEach((el) => {
    const raw = el.getAttribute("data-reset-at");
    if (!raw) {
      return;
    }
    const resetsAt = Number(raw);
    if (!Number.isFinite(resetsAt)) {
      return;
    }
    const text = formatCountdown(resetsAt, now);
    if (el.classList.contains("reset")) {
      el.textContent = `reset ${text}`;
    } else if (el.classList.contains("sub")) {
      el.textContent = `resets in ${text}`;
    } else {
      el.textContent = text;
    }
  });
  root.querySelectorAll<HTMLElement>("[data-captured-at]").forEach((el) => {
    const raw = el.getAttribute("data-captured-at");
    if (!raw) {
      return;
    }
    const captured = Number(raw);
    if (!Number.isFinite(captured) || captured <= 0) {
      return;
    }
    const ageSec = Math.round((now - captured) / 1000);
    if (el.closest(".header-meta")) {
      el.textContent =
        ageSec < 60 ? `updated ${ageSec}s ago` : `updated ${Math.round(ageSec / 60)}m ago`;
    } else {
      el.textContent = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
    }
  });
}

function startTick(): void {
  if (tick !== undefined) {
    return;
  }
  tick = window.setInterval(refreshRelativeTimes, 30_000);
}
