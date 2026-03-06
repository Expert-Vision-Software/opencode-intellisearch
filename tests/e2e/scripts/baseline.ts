import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Baseline, AggregatedMetrics, TestResult, CheckResult, SkillMode } from "./types.ts";

const BASELINE_VERSION = 1;

const DEFAULT_THRESHOLDS = {
  minWorkflowScore: 0.70,
  maxTokenIncrease: 500,
  minSolutionsFound: 3
};

function getBaselinePath(projectDir: string, mode: SkillMode): string {
  return join(projectDir, "tests/e2e/baseline", `${mode}.json`);
}

export async function loadBaseline(projectDir: string, mode: SkillMode): Promise<Baseline | null> {
  const path = getBaselinePath(projectDir, mode);
  const file = Bun.file(path);
  
  if (!(await file.exists())) {
    return null;
  }
  
  try {
    return await file.json() as Baseline;
  } catch {
    return null;
  }
}

export async function saveBaseline(
  projectDir: string, 
  mode: SkillMode, 
  metrics: AggregatedMetrics,
  config: { runs: number; model: string | null; queryFile: string }
): Promise<void> {
  const baselineDir = join(projectDir, "tests/e2e/baseline");
  await mkdir(baselineDir, { recursive: true });
  
  const baseline: Baseline = {
    version: BASELINE_VERSION,
    generated: new Date().toISOString(),
    config: {
      runs: config.runs,
      model: config.model,
      queryFile: config.queryFile
    },
    metrics: {
      skillLoaded: metrics.skillLoaded,
      skillLoadMethod: metrics.skillLoadMethod,
      workflowScore: metrics.workflowScore,
      avgTokens: metrics.avgTokens,
      solutionsFound: metrics.solutionsFound,
      searchSuccessRate: metrics.searchSuccessRate,
      solutions: metrics.solutions.slice(0, 10)
    },
    thresholds: DEFAULT_THRESHOLDS,
    meta: metrics.meta
  };
  
  const path = getBaselinePath(projectDir, mode);
  await Bun.write(path, JSON.stringify(baseline, null, 2));
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "✅ yes" : "❌ no";
  if (typeof value === "number") return value.toString();
  return String(value);
}

function hasRegression(current: AggregatedMetrics, baseline: Baseline): boolean {
  if (current.avgTokens > baseline.metrics.avgTokens + baseline.thresholds.maxTokenIncrease) {
    return true;
  }
  if (current.solutionsFound < baseline.thresholds.minSolutionsFound) {
    return true;
  }
  if (current.workflowScore < baseline.metrics.workflowScore - 0.2) {
    return true;
  }
  if (current.searchSuccessRate < baseline.metrics.searchSuccessRate - 0.1) {
    return true;
  }
  return false;
}

export function evaluateResult(
  metrics: AggregatedMetrics, 
  baseline: Baseline | null
): TestResult {
  const checks: CheckResult[] = [];
  
  checks.push({
    name: "Skill loaded",
    pass: metrics.skillLoaded === true,
    expected: "true",
    actual: formatValue(metrics.skillLoaded)
  });
  
  const minScore = baseline?.thresholds.minWorkflowScore ?? DEFAULT_THRESHOLDS.minWorkflowScore;
  checks.push({
    name: "Workflow score",
    pass: metrics.workflowScore >= minScore,
    expected: `≥ ${minScore}`,
    actual: metrics.workflowScore.toFixed(2),
    detail: metrics.workflowScore >= minScore ? undefined : "Below threshold"
  });
  
  if (baseline) {
    const regressed = hasRegression(metrics, baseline);
    checks.push({
      name: "No regression",
      pass: !regressed,
      expected: "No major regressions",
      actual: regressed ? "Regressions detected" : "Stable or improved",
      detail: regressed ? "Token spike, score drop, or solutions loss" : undefined
    });
  }
  
  return {
    passed: checks.every(c => c.pass),
    checks,
    metrics,
    baseline
  };
}

export function formatDelta(current: number, baseline: number): string {
  const diff = current - baseline;
  if (Math.abs(diff) < 0.001) return "=";
  if (diff > 0) return `+${diff.toFixed(diff < 1 ? 2 : 0)} ↑`;
  return `${diff.toFixed(diff > -1 ? 2 : 0)} ↓`;
}
