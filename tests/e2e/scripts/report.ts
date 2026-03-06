import type { TestResult, SkillMode, AggregatedMetrics, Baseline } from "./types.ts";

const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m"
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
  let detail = "";
  
  switch (tool) {
    case "skill":
      detail = String(input.name || "");
      break;
    case "bash": {
      const cmd = String(input.command || "");
      const ghMatch = cmd.match(/gh\s+(?:search|repo)\s+(?:repos\s+)?["']?([^"']+)["']?/);
      detail = ghMatch ? `gh search "${ghMatch[1]}"` : "gh command";
      break;
    }
    case "DeepWiki_ask_question":
      detail = String(input.repoName || input.question || "");
      break;
    case "DeepWiki_read_wiki_structure":
    case "DeepWiki_read_wiki_contents":
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

export function printResult(result: TestResult): void {
  const { metrics, baseline, checks, passed } = result;
  
  console.log(color("=== Results ===", "cyan"));
  
  if (baseline) {
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
  console.log(`Skill Loaded:     ${formatBool(metrics.skillLoaded)}`);
  console.log(`Workflow Score:   ${metrics.workflowScore.toFixed(2)}`);
  console.log(`Tokens:           ${metrics.avgTokens}`);
  console.log(`Solutions:        ${metrics.solutionsFound}`);
  console.log(`Search Success:   ${formatPercent(metrics.searchSuccessRate)}`);
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
