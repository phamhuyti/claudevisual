#!/usr/bin/env node
"use strict";

/**
 * Bundled Claude Code hook script — zero npm dependencies (Node.js builtins
 * only) so it runs standalone via `runner.sh`, copied into `dist/` unbundled
 * by esbuild rather than pulled into the extension's own bundle.
 *
 * Reads one hook-invocation JSON payload from stdin, appends exactly ONE
 * normalized NDJSON line to this session's event log, and exits. That log is
 * tailed by `../../core/event-log-reader.ts` to drive a low-latency
 * "is it running right now" overlay ahead of the JSONL transcript landing.
 *
 * MUST fail open: Claude Code invokes this synchronously as part of its own
 * hook lifecycle (including PreToolUse, which can gate the tool call). Any
 * uncaught exception or non-zero exit here would risk slowing down or
 * blocking the user's session — every failure path below is swallowed and
 * this always exits 0.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

/** Reads the full hook payload from stdin. Mirrors the async stdin-read
 *  pattern used by this machine's other Claude Code hook scripts. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Maps the raw Claude Code hook payload (snake_case, API-native) to the
 *  normalized record shape `event-log-reader.ts` parses. Unknown/absent
 *  fields are simply omitted rather than written as `null`/`undefined`. */
function buildRecord(payload) {
  const record = { ts: Date.now() };
  if (typeof payload.session_id === "string") {
    record.sessionId = payload.session_id;
  }
  if (typeof payload.hook_event_name === "string") {
    record.hookEvent = payload.hook_event_name;
  }
  if (typeof payload.tool_name === "string") {
    record.toolName = payload.tool_name;
  }
  if (typeof payload.agent_id === "string") {
    record.agentId = payload.agent_id;
  }
  if (typeof payload.agent_type === "string") {
    record.agentType = payload.agent_type;
  }
  if (typeof payload.permission_mode === "string") {
    record.permissionMode = payload.permission_mode;
  }
  if (typeof payload.source === "string") {
    record.source = payload.source;
  }
  return record;
}

function eventLogFilePath(sessionId) {
  const dir = path.join(os.homedir(), ".claude", "claudevisual");
  // The session id comes from an external stdin payload — sanitize it before
  // it becomes part of a filename so a crafted value (e.g. `../../x`) can
  // never escape `dir`. Real Claude Code session ids are UUIDs, which pass
  // through unchanged. The reader side keys sessions off the `sessionId`
  // field inside each NDJSON line, not the filename, so this is safe.
  const key = (sessionId || `pid-${process.pid}`).replace(/[^a-zA-Z0-9-]/g, "-");
  return { dir, filePath: path.join(dir, `events-${key}.ndjson`) };
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    return;
  }
  const payload = JSON.parse(raw);
  const record = buildRecord(payload);
  const { dir, filePath } = eventLogFilePath(record.sessionId);

  fs.mkdirSync(dir, { recursive: true });
  // O(1) append only — never reads the file back, never rewrites it.
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

main()
  .catch(() => {
    // Fail open — a malformed payload, a full disk, or any other error must
    // never surface as a Claude Code hook failure.
  })
  .finally(() => {
    process.exit(0);
  });
