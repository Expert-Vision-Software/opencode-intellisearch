import type { TestResult, SkillMode, AggregatedMetrics, Baseline } from "./types.ts";
import { formatDelta } from "./baseline.ts";

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

export function printError(message: string): void {
  console.error(color(`Error: ${message}`, "red"));
}

export function printInfo(message: string): void {
  console.log(color(message, "dim"));
}

export function printBaselineSaved(mode: SkillMode): void {
  console.log(color(`✅ Baseline saved for ${mode} mode`, "green"));
}
