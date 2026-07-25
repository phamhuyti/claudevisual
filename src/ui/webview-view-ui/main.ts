// Sidebar WebviewView entry point — bundled by esbuild's browser-target
// `sidebarViewConfig` (esbuild.js) into dist/webview-view/main.js, referenced
// by sidebar-view-provider.ts's HTML. Renders the session view-model the host
// pushes on every store change.
import type { SessionViewModel, SidebarViewModel } from "../webview-view/sidebar-messages";
import { esc } from "./dom-utils";
import { onHostMessage, postToHost } from "./sidebar-vscode-api";
import { renderActivity } from "./render-activity";
import { handleAdvisorAction, renderAdvisor } from "./render-advisor";
import { renderAgents } from "./render-agents";
import { renderEconomics } from "./render-economics";
import { renderLimits } from "./render-limits";
import { renderVitals } from "./render-vitals";

const IDLE_HTML = `<div class="cv-idle">No active Claude Code session in this workspace.</div>`;

// Agent drill-down open/closed state, kept across re-renders (the sidebar
// re-renders on every store change; without this, an expanded agent would
// collapse each tick).
const openAgents = new Set<string>();
// Same idea for the merged Activity section's detail panel, keyed by
// sessionId (one Activity section per session) — collapsed by default, so a
// sessionId only ever appears here once the user has explicitly opened it.
const openActivity = new Set<string>();
// Explicit user overrides of a session's collapsed/expanded body, keyed by
// sessionId. Every session starts collapsed to its vitals row — live/running
// doesn't auto-expand it — so the list stays scannable and a session's detail
// only ever opens on an explicit click. Unlike `openAgents`/`openActivity`,
// this is consulted directly in `renderSession` while building the HTML
// string, not patched onto the DOM afterward — simpler, since the
// collapsed/expanded class is session-specific from the start rather than a
// uniform "closed by default" template.
const sessionOverrides = new Map<string, boolean>();

function renderSession(s: SessionViewModel): string {
  const collapsed = sessionOverrides.get(s.sessionId) ?? true;
  return `<section class="cv-session${collapsed ? " collapsed" : ""}" data-session="${esc(s.sessionId)}">${renderVitals(
    s,
    !collapsed
  )}<div class="cv-body">${renderAdvisor(s)}${renderAgents(s)}${renderEconomics(s)}${renderActivity(s)}</div></section>`;
}

function render(root: HTMLElement, vm: SidebarViewModel): void {
  // Account-limits header renders above the session list (and even when idle),
  // since it is account-wide, not tied to any one session.
  const sessionsHtml = vm.sessions.length === 0 ? IDLE_HTML : vm.sessions.map(renderSession).join("");
  root.innerHTML = renderLimits(vm.limits) + sessionsHtml;
  // Prune remembered expansions for agents/sessions that are no longer
  // present, then re-apply the open state to those that are (innerHTML wiped it).
  const present = new Set<string>();
  for (const s of vm.sessions) {
    if (s.mainAgent) {
      present.add(s.mainAgent.agentId);
    }
    for (const a of s.agents) {
      present.add(a.agentId);
    }
  }
  for (const id of [...openAgents]) {
    if (!present.has(id)) {
      openAgents.delete(id);
      continue;
    }
    const agent = root.querySelector(`.agent[data-agent="${CSS.escape(id)}"]`);
    agent?.classList.add("open");
    agent?.querySelector(".agent-row")?.setAttribute("aria-expanded", "true");
  }

  const sessionIds = new Set(vm.sessions.map((s) => s.sessionId));
  for (const id of [...openActivity]) {
    if (!sessionIds.has(id)) {
      openActivity.delete(id);
      continue;
    }
    const activity = root.querySelector(`.activity[data-session="${CSS.escape(id)}"]`);
    activity?.classList.add("open");
    activity?.querySelector(".act-toggle")?.setAttribute("aria-expanded", "true");
  }

  for (const id of [...sessionOverrides.keys()]) {
    if (!sessionIds.has(id)) {
      sessionOverrides.delete(id);
    }
  }
}

/** Flips one agent row's drill-down open/closed, from either a click or a
 *  keyboard activation — shared so both input paths stay in sync with
 *  `openAgents` and the row's `aria-expanded` state. No-op on a row with
 *  nothing to expand (no `has-detail` class, so no `role="button"` either). */
function toggleAgentRow(row: HTMLElement): void {
  const agent = row.parentElement;
  if (!agent || !agent.classList.contains("has-detail")) {
    return;
  }
  const id = agent.getAttribute("data-agent");
  if (!id) {
    return;
  }
  const nowOpen = !openAgents.has(id);
  if (nowOpen) {
    openAgents.add(id);
  } else {
    openAgents.delete(id);
  }
  agent.classList.toggle("open", nowOpen);
  row.setAttribute("aria-expanded", String(nowOpen));
}

/** Flips the merged Activity section's detail panel (Recent activity + Files
 *  touched) open/closed, mirroring `toggleAgentRow` — same shared-click/keydown
 *  pattern, own `openActivity` set keyed by sessionId instead of agentId. */
function toggleActivity(header: HTMLElement): void {
  const section = header.closest(".activity");
  if (!section || !section.classList.contains("has-detail")) {
    return;
  }
  const id = section.getAttribute("data-session");
  if (!id) {
    return;
  }
  const nowOpen = !openActivity.has(id);
  if (nowOpen) {
    openActivity.add(id);
  } else {
    openActivity.delete(id);
  }
  section.classList.toggle("open", nowOpen);
  header.setAttribute("aria-expanded", String(nowOpen));
}

/** Flips a session's collapsed/expanded body (Orchestration/Token Economics/
 *  Activity) and remembers the choice in `sessionOverrides`, overriding the
 *  collapsed-by-default state until the session disappears from the
 *  view-model. Every session's `.v-top` is a valid toggle target (unlike an
 *  agent row, the body always has at least the "no sub-agents spawned yet"
 *  placeholder). */
function toggleSession(header: HTMLElement): void {
  const section = header.closest(".cv-session");
  if (!section) {
    return;
  }
  const id = section.getAttribute("data-session");
  if (!id) {
    return;
  }
  // Source of truth is the override map once one exists for this id (matching
  // `toggleAgentRow`/`toggleActivity`, which read their own Set rather than the
  // DOM); the classList is only consulted as the collapsed-by-default stand-in
  // the first time a session is toggled, before any override has been recorded.
  const currentlyCollapsed = sessionOverrides.get(id) ?? section.classList.contains("collapsed");
  const nowCollapsed = !currentlyCollapsed;
  sessionOverrides.set(id, nowCollapsed);
  section.classList.toggle("collapsed", nowCollapsed);
  header.setAttribute("aria-expanded", String(!nowCollapsed));
  // The label's text is baked in at render time (see renderVitals); on an idle
  // session nothing re-renders after a click, so it has to be patched here too
  // or it'd contradict the aria-expanded state it sits right next to.
  const label = header.querySelector<HTMLElement>(".v-toggle");
  if (label) {
    label.textContent = nowCollapsed ? "View detail" : "Hide detail";
  }
}

function mount(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  onHostMessage((message) => {
    if (message.type === "state") {
      render(root, message.vm);
    }
  });
  // Delegated toggles — clicking (or pressing Enter/Space on, for keyboard
  // users tabbing through `role="button"` elements) an agent row or the
  // Activity header flips its panel and remembers the choice so the next
  // state push keeps it open.
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const advisorAct = target.closest(".adv-rec-copy");
    if (advisorAct) {
      handleAdvisorAction(advisorAct as HTMLElement);
      return;
    }
    const vtop = target.closest(".v-top");
    if (vtop) {
      toggleSession(vtop as HTMLElement);
      return;
    }
    const row = target.closest(".agent-row");
    if (row) {
      toggleAgentRow(row as HTMLElement);
      return;
    }
    const header = target.closest(".act-toggle");
    if (header) {
      toggleActivity(header as HTMLElement);
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const target = event.target as HTMLElement;
    const advisorAct = target.closest(".adv-rec-copy");
    if (advisorAct) {
      event.preventDefault();
      handleAdvisorAction(advisorAct as HTMLElement);
      return;
    }
    const vtop = target.closest(".v-top");
    if (vtop) {
      event.preventDefault();
      toggleSession(vtop as HTMLElement);
      return;
    }
    const row = target.closest(".agent-row");
    if (row) {
      event.preventDefault(); // stop Space from scrolling the sidebar
      toggleAgentRow(row as HTMLElement);
      return;
    }
    const header = target.closest(".act-toggle");
    if (header) {
      event.preventDefault();
      toggleActivity(header as HTMLElement);
    }
  });
  // Tell the host we're mounted so it replays the latest state (the first
  // store change may have fired before this webview existed).
  postToHost({ type: "ready" });
}

mount();
