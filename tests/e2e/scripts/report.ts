import type { TestResult, SkillMode, AggregatedMetrics, Baseline, ViolationSummary, ConsistencyLevel } from "./types.ts";

const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  magenta: "\x1b[35m"
};

function color(text: string, c: keyof typeof COLORS): string {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

function formatBool(value: boolean): string {
  return value ? color("✅ yes", "green") : color("❌ no", "red");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return new Date().toTimeString().slice(0, 8);
  return new Date(ts).toTimeString().slice(0, 8);
}

export function printToolUse(tool: string, input: Record<string, unknown>, timestamp?: number, cumulativeTokens?: number): void {
  const time = formatTimestamp(timestamp);
  const tokens = cumulativeTokens !== undefined ? ` [${cumulativeTokens.toLocaleString()}]` : "";
  const toolLower = tool.toLowerCase();
  let detail = "";
  
  switch (toolLower) {
    case "skill":
      detail = String(input.name || "");
      break;
    case "bash": {
      const cmd = String(input.command || "");
      const ghMatch = cmd.match(/gh\s+(?:search|repo)\s+(?:repos\s+)?["']?([^"']+)["']?/);
      detail = ghMatch ? `gh search "${ghMatch[1]}"` : "gh command";
      break;
    }
    case "deepwiki_ask_question":
      detail = String(input.repoName || input.question || "");
      break;
    case "deepwiki_read_wiki_structure":
    case "deepwiki_read_wiki_contents":
      detail = String(input.repoName || "");
      break;
    case "webfetch": {
      const url = String(input.url || "");
      const shortUrl = url.replace(/^https?:\/\//, "").slice(0, 50);
      detail = shortUrl.length < url.length ? shortUrl + "..." : shortUrl;
      break;
    }
    case "task": {
      const cmd = String(input.command || input.prompt || "");
      detail = cmd.split("\n")[0]?.slice(0, 40) || "subtask";
      break;
    }
    case "read": {
      const filePath = String(input.filePath || "");
      const shortPath = filePath.split("/").pop() || filePath.slice(0, 50);
      detail = shortPath;
      break;
    }
    case "google_search": {
      const query = String(input.query || "");
      detail = query.slice(0, 50) || "search";
      break;
    }
    default:
      detail = "";
  }
  
  console.log(`  → ${color(time, "dim")}${color(tokens, "yellow")} ${color(tool, "cyan")}: ${detail}`);
}

export function printStepFinish(tokens: { input: number; output: number }, timestamp?: number, cumulativeTokens?: number): void {
  const time = formatTimestamp(timestamp);
  const cumul = cumulativeTokens !== undefined ? ` [${cumulativeTokens.toLocaleString()}]` : "";
  const total = tokens.input + tokens.output;
  console.log(`  → ${color(time, "dim")}${color(cumul, "yellow")} ${color("step_finish", "green")}: ${total.toLocaleString()} tokens (${tokens.input.toLocaleString()} in, ${tokens.output.toLocaleString()} out)`);
}

export function printHeader(mode: SkillMode, runs: number, model: string | null): void {
  console.log("");
  console.log(color("=== E2E Test: " + mode + " mode ===", "cyan"));
  console.log(`Runs: ${runs} | Model: ${model ?? "<default>"}`);
  console.log("");
}

export function printResult(result: TestResult, verbose: boolean = false): void {
  const { metrics, baseline, checks, passed } = result;
  
  console.log(color("=== Results ===", "cyan"));
  
  if (verbose) {
    printVerboseOutput(metrics, baseline);
  } else if (baseline) {
    printComparisonTable(metrics, baseline);
  } else {
    printMetricsOnly(metrics);
  }
  
  console.log("");
  console.log(color("Pass Criteria:", "yellow"));
  for (const check of checks) {
    const status = check.pass ? color("✅", "green") : color("❌", "red");
    const detail = check.detail ? color(` (${check.detail})`, "dim") : "";
    console.log(`  ${status} ${check.name}: ${check.actual}${detail}`);
  }
  
  console.log("");
  if (passed) {
    console.log(color("Status: ✅ PASS", "green"));
  } else {
    console.log(color("Status: ❌ FAIL", "red"));
  }
  
  if (baseline) {
    console.log(color("\nRun `bun test:e2e --set-baseline` to update baseline", "dim"));
  } else {
    console.log(color("\nNo baseline found. Run `bun test:e2e --set-baseline` to create one.", "yellow"));
  }
}

function printVerboseOutput(metrics: AggregatedMetrics, baseline: Baseline | null): void {
  console.log(color("\n--- Workflow Compliance ---", "magenta"));
  
  const breakdown = metrics.runs[0]?.workflowCompliance?.breakdown;
  if (breakdown) {
    console.log(`  Skill Loaded:      ${formatBool(metrics.skillLoaded)} (${metrics.skillLoadMethod})`);
    console.log(`  Workflow Score:    ${metrics.workflowScore.toFixed(2)}`);
    console.log(color("  Breakdown:", "dim"));
    console.log(`    skillLoaded:        +${breakdown.skillLoaded.toFixed(2)}`);
    console.log(`    ghCli:               +${breakdown.ghCli.toFixed(2)}`);
    console.log(`    deepWiki:            +${breakdown.deepWiki.toFixed(2)}`);
    console.log(`    noWebfetchOnGithub:  +${breakdown.noWebfetchOnGithub.toFixed(2)}`);
  } else {
    console.log(`  Skill Loaded:      ${formatBool(metrics.skillLoaded)} (${metrics.skillLoadMethod})`);
    console.log(`  Workflow Score:    ${metrics.workflowScore.toFixed(2)}`);
  }
  
  console.log(color("\n--- Solutions ---", "magenta"));
  console.log(`  Found: ${metrics.solutionsFound}`);
  if (metrics.solutions.length > 0) {
    for (const sol of metrics.solutions.slice(0, 10)) {
      console.log(`    - ${sol}`);
    }
    if (metrics.solutions.length > 10) {
      console.log(color(`    ... and ${metrics.solutions.length - 10} more`, "dim"));
    }
  }
  
  const violations = aggregateViolations(metrics);
  if (violations.length > 0) {
    console.log(color("\n--- Violations ---", "magenta"));
    for (const v of violations) {
      console.log(`  ${color("⚠️", "yellow")} ${v.rule} (${v.totalImpact.toFixed(2)})`);
      console.log(color(`      ${v.detail}`, "dim"));
    }
  }
  
  const enhanced = metrics.runs[0]?.workflowCompliance?.enhanced;
  if (enhanced) {
    console.log(color("\n--- Enhanced Metrics ---", "magenta"));
    console.log(`  Tool Diversity:    ${(enhanced.toolDiversity * 100).toFixed(0)}%`);
    console.log(`  Search Depth:      ${enhanced.searchDepth} repos examined`);
    console.log(`  Token Efficiency:  ${enhanced.tokenEfficiency.toLocaleString()} tokens/solution`);
    console.log(`  Duration:          ${formatDuration(enhanced.workflowDuration)}`);
  }
  
  console.log(color("\n--- Run Summary ---", "magenta"));
  for (let i = 0; i < metrics.runs.length; i++) {
    const run = metrics.runs[i];
    const violationCount = run.workflowCompliance.violations.length;
    const violationStr = violationCount > 0 
      ? color(`, ${violationCount} violation${violationCount > 1 ? "s" : ""}`, "yellow")
      : "";
    console.log(`  Run ${i + 1}: score ${run.workflowCompliance.score.toFixed(2)}, ${run.solutions.length} solutions${violationStr}`);
  }
  
  if (baseline) {
    console.log(color("\n--- Baseline Comparison ---", "magenta"));
    printBaselineComparison(metrics, baseline);
  }
}

function aggregateViolations(metrics: AggregatedMetrics): Array<{ rule: string; totalImpact: number; detail: string }> {
  const violationMap = new Map<string, { totalImpact: number; detail: string }>();
  
  for (const run of metrics.runs) {
    for (const v of run.workflowCompliance.violations) {
      const existing = violationMap.get(v.rule);
      if (existing) {
        existing.totalImpact += v.impact;
      } else {
        violationMap.set(v.rule, { totalImpact: v.impact, detail: v.detail });
      }
    }
  }
  
  return [...violationMap.entries()].map(([rule, data]) => ({
    rule,
    totalImpact: Math.round(data.totalImpact * 100) / 100,
    detail: data.detail,
  }));
}

function printBaselineComparison(metrics: AggregatedMetrics, baseline: Baseline): void {
  const rows = [
    { label: "Workflow Score", current: metrics.workflowScore, baseline: baseline.metrics.workflowScore },
    { label: "Tokens", current: metrics.avgTokens, baseline: baseline.metrics.avgTokens },
    { label: "Solutions", current: metrics.solutionsFound, baseline: baseline.metrics.solutionsFound },
    { label: "Search Success", current: metrics.searchSuccessRate, baseline: baseline.metrics.searchSuccessRate },
  ];
  
  for (const row of rows) {
    const delta = row.current - row.baseline;
    const deltaStr = formatDeltaWithColor(delta, row.label === "Tokens");
    console.log(`  ${row.label.padEnd(18)} ${row.current.toFixed ? row.current.toFixed(2) : row.current} (baseline: ${row.baseline.toFixed ? row.baseline.toFixed(2) : row.baseline}) ${deltaStr}`);
  }
}

function formatDeltaWithColor(delta: number, inverse: boolean = false): string {
  if (Math.abs(delta) < 0.001) return color("=", "dim");
  const isPositive = inverse ? delta < 0 : delta > 0;
  const arrow = delta > 0 ? "↑" : "↓";
  const value = Math.abs(delta).toFixed(delta < 1 && delta > -1 ? 2 : 0);
  return isPositive 
    ? color(`+${value} ${arrow}`, "green")
    : color(`-${value} ${arrow}`, "red");
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function printComparisonTable(metrics: AggregatedMetrics, baseline: Baseline): void {
  const rows = [
    { 
      label: "Skill Loaded", 
      baseline: formatBool(baseline.metrics.skillLoaded), 
      current: formatBool(metrics.skillLoaded),
      delta: metrics.skillLoaded === baseline.metrics.skillLoaded ? "=" : "changed"
    },
    { 
      label: "Workflow Score", 
      baseline: baseline.metrics.workflowScore.toFixed(2), 
      current: metrics.workflowScore.toFixed(2),
      delta: formatDelta(metrics.workflowScore, baseline.metrics.workflowScore)
    },
    { 
      label: "Tokens", 
      baseline: baseline.metrics.avgTokens.toString(), 
      current: metrics.avgTokens.toString(),
      delta: formatDelta(metrics.avgTokens, baseline.metrics.avgTokens)
    },
    { 
      label: "Solutions", 
      baseline: baseline.metrics.solutionsFound.toString(), 
      current: metrics.solutionsFound.toString(),
      delta: formatDelta(metrics.solutionsFound, baseline.metrics.solutionsFound)
    },
    { 
      label: "Search Success", 
      baseline: formatPercent(baseline.metrics.searchSuccessRate), 
      current: formatPercent(metrics.searchSuccessRate),
      delta: formatDelta(metrics.searchSuccessRate, baseline.metrics.searchSuccessRate)
    }
  ];
  
  const labelWidth = Math.max(...rows.map(r => r.label.length));
  const baselineWidth = Math.max(...rows.map(r => r.baseline.length));
  const currentWidth = Math.max(...rows.map(r => r.current.length));
  
  console.log(
    "Metric".padEnd(labelWidth) + 
    " | Baseline".padEnd(baselineWidth + 3) + 
    " | Current".padEnd(currentWidth + 3) + 
    " | Delta"
  );
  console.log("-".repeat(labelWidth + baselineWidth + currentWidth + 20));
  
  for (const row of rows) {
    console.log(
      row.label.padEnd(labelWidth) + 
      " | " + row.baseline.padEnd(baselineWidth) + 
      " | " + row.current.padEnd(currentWidth) + 
      " | " + row.delta
    );
  }
}

function printMetricsOnly(metrics: AggregatedMetrics): void {
  const breakdown = metrics.runs[0]?.workflowCompliance?.breakdown;
  const enhanced = metrics.runs[0]?.workflowCompliance?.enhanced;
  const violations = aggregateViolations(metrics);
  
  console.log(`Skill Loaded:     ${formatBool(metrics.skillLoaded)} (${metrics.skillLoadMethod})`);
  
  if (breakdown) {
    const parts = [];
    if (breakdown.skillLoaded > 0) parts.push(`skill: ${breakdown.skillLoaded.toFixed(2)}`);
    if (breakdown.ghCli > 0) parts.push(`gh: ${breakdown.ghCli.toFixed(2)}`);
    if (breakdown.deepWiki > 0) parts.push(`deepWiki: ${breakdown.deepWiki.toFixed(2)}`);
    if (breakdown.noWebfetchOnGithub > 0) parts.push(`noWebfetch: ${breakdown.noWebfetchOnGithub.toFixed(2)}`);
    console.log(`Workflow Score:   ${metrics.workflowScore.toFixed(2)} (${parts.join(", ")})`);
  } else {
    console.log(`Workflow Score:   ${metrics.workflowScore.toFixed(2)}`);
  }
  
  console.log(`Solutions:        ${metrics.solutionsFound} (${metrics.solutions.slice(0, 3).join(", ")}${metrics.solutions.length > 3 ? "..." : ""})`);
  
  if (violations.length > 0) {
    const violationStr = violations.map(v => `${v.rule}: ${v.totalImpact.toFixed(2)}`).join(", ");
    console.log(`Violations:       ${color(violations.length.toString(), "yellow")} (${violationStr})`);
  } else {
    console.log(`Violations:       ${color("0", "green")}`);
  }
  
  if (enhanced) {
    console.log(`Search Depth:     ${enhanced.searchDepth} repos examined`);
    console.log(`Duration:         ${formatDuration(enhanced.workflowDuration)}`);
  }
}

function formatDelta(current: number, baselineVal: number): string {
  const diff = current - baselineVal;
  if (Math.abs(diff) < 0.001) return "=";
  if (diff > 0) return `+${diff.toFixed(diff < 1 ? 2 : 0)} ↑`;
  return `${diff.toFixed(diff > -1 ? 2 : 0)} ↓`;
}

export function printError(message: string): void {
  console.error(color(`Error: ${message}`, "red"));
}

export function printInfo(message: string): void {
  console.log(color(message, "dim"));
}

export function printBaselineSaved(mode: SkillMode): void {
  console.log(color(`✅ Baseline saved for ${mode} mode`, "green"));
}

export function printResultsPath(resultsDir: string): void {
  console.log(color(`\nResults saved to: ${resultsDir}`, "dim"));
}

export function printStatusLine(tool: string, elapsedSeconds: number): void {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const time = `${mins}:${secs.toString().padStart(2, "0")}`;
  const toolName = tool === "step_finish" ? "completion" : tool;
  process.stdout.write(`\r[${color(time, "dim")}] Waiting for ${color(toolName, "cyan")}...`);
}

export function clearStatusLine(): void {
  process.stdout.write("\r" + " ".repeat(60) + "\r");
}

export function printInactivityWarning(seconds: number): void {
  clearStatusLine();
  console.log(color(`⚠️ No activity for ${seconds}s - test may be stuck`, "yellow"));
}

export function printTimeoutKilled(): void {
  console.log(color("\n❌ Test killed after 10 minute timeout", "red"));
}
