import { strict as assert } from "assert";
import { analyzeSession } from "../../src/core/advisor/advisor-engine";
import { emptySessionState, emptySubAgentState, SessionState, TokenUsage } from "../../src/core/types";

function usage(input: number, output: number, cacheCreate: number, cacheRead: number): TokenUsage {
  return { inputTokens: input, outputTokens: output, cacheCreationInputTokens: cacheCreate, cacheReadInputTokens: cacheRead };
}

function ids(state: SessionState): string[] {
  return analyzeSession(state).recommendations.map((r) => r.id);
}

describe("advisor-engine", () => {
  it("emits no recommendations and a neutral score for an empty session", () => {
    const r = analyzeSession(emptySessionState("s1", "/p"));
    assert.equal(r.recommendations.length, 0);
    assert.equal(r.score.neutral, true);
    assert.equal(r.score.grade, "A");
  });

  it("flags critical context pressure at/above the crit band", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-opus-4-8";
    s.preciseContextPercent = 92;
    s.cumulativeUsage = usage(500_000, 10_000, 0, 400_000);
    const rec = analyzeSession(s).recommendations;
    assert.equal(rec[0].id, "context-critical");
    assert.equal(rec[0].severity, "critical");
  });

  it("warns (not critical) in the warn band", () => {
    const s = emptySessionState("s1", "/p");
    s.preciseContextPercent = 80;
    assert.ok(ids(s).includes("context-warn"));
    assert.ok(!ids(s).includes("context-critical"));
  });

  it("stays silent on context when well below the warn band", () => {
    const s = emptySessionState("s1", "/p");
    s.preciseContextPercent = 40;
    assert.ok(!ids(s).some((id) => id.startsWith("context-")));
  });

  it("detects cache churn when creation dwarfs reads past the floor", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.cumulativeUsage = usage(10_000, 5_000, 300_000, 50_000); // 6× write:read
    assert.ok(ids(s).includes("cache-churn"));
  });

  it("does not flag churn below the creation floor", () => {
    const s = emptySessionState("s1", "/p");
    s.cumulativeUsage = usage(1_000, 500, 10_000, 100); // high ratio but tiny creation
    assert.ok(!ids(s).includes("cache-churn"));
  });

  it("suggests a lighter model for opus with negligible output share", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-opus-4-8";
    s.cumulativeUsage = usage(400_000, 5_000, 0, 200_000); // output ~0.8%
    assert.ok(ids(s).includes("model-rightsize"));
  });

  it("does not suggest right-sizing for a sonnet session", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.cumulativeUsage = usage(400_000, 5_000, 0, 200_000);
    assert.ok(!ids(s).includes("model-rightsize"));
  });

  it("does not suggest right-sizing when a delegated sub-agent (not the main agent) is the one reading heavily", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-opus-4-8";
    s.cumulativeUsage = usage(400_000, 40_000, 0, 200_000); // main fresh output share ~9%, above the bar
    const a = emptySubAgentState("a1", "researcher");
    a.model = "claude-haiku-4-5";
    a.tokens = usage(2_000_000, 20_000, 0, 5_000_000); // huge read-heavy sub-agent, own model
    s.subagents.set("a1", a);
    assert.ok(!ids(s).includes("model-rightsize"));
  });

  it("flags a sub-agent that dominates the session's total spend", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.cumulativeUsage = usage(2_000_000, 50_000, 0, 1_000_000); // main total 3.05M
    const a = emptySubAgentState("a1", "researcher");
    a.model = "claude-sonnet-5";
    a.tokens = usage(600_000, 100_000, 100_000, 200_000); // 1M tokens, ~25% of the 4.05M session
    s.subagents.set("a1", a);
    assert.ok(ids(s).some((id) => id.startsWith("subagent-expensive:")));
  });

  it("does not flag a sub-agent that's large in absolute tokens but a small share of a much larger session", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.cumulativeUsage = usage(50_000_000, 500_000, 0, 100_000_000); // 150.5M main total
    const a = emptySubAgentState("a1", "researcher");
    a.model = "claude-haiku-4-5";
    a.tokens = usage(600_000, 100_000, 100_000, 200_000); // 1M tokens, <1% of the session
    s.subagents.set("a1", a);
    assert.ok(!ids(s).some((id) => id.startsWith("subagent-expensive:")));
  });

  it("warns on repeated compaction", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.compactionCount = 2;
    s.cumulativeUsage = usage(100_000, 5_000, 0, 50_000);
    assert.ok(ids(s).includes("frequent-compaction"));
  });

  it("does not warn on a single compaction", () => {
    const s = emptySessionState("s1", "/p");
    s.compactionCount = 1;
    assert.ok(!ids(s).includes("frequent-compaction"));
  });

  it("flags a max_tokens truncation", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-sonnet-5";
    s.lastStopReason = "max_tokens";
    assert.ok(ids(s).includes("max-tokens-stop"));
  });

  it("does not flag a normal end_turn stop", () => {
    const s = emptySessionState("s1", "/p");
    s.lastStopReason = "end_turn";
    assert.ok(!ids(s).includes("max-tokens-stop"));
  });

  it("ranks critical before info", () => {
    const s = emptySessionState("s1", "/p");
    s.model = "claude-opus-4-8";
    s.preciseContextPercent = 95;
    s.cumulativeUsage = usage(400_000, 5_000, 0, 200_000); // triggers right-size (info) too
    const rec = analyzeSession(s).recommendations;
    assert.equal(rec[0].severity, "critical");
    assert.ok(rec.every((r, i) => i === 0 || r.severity !== "critical" || rec[i - 1].severity === "critical"));
  });
});
