export type SkillMode = "explicit" | "implicit";

export interface TestConfig {
  runs: number;
  mode: SkillMode;
  model: string | null;
  queryFile: string;
  pluginSource: string;
  projectDir: string;
}

export interface WorkflowCompliance {
  usedGhCli: boolean;
  usedDeepWiki: boolean;
  usedWebfetch: boolean;
  usedWebfetchOnGithub: boolean;
  score: number;
}

export interface RunMetrics {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  skillLoaded: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  toolsUsed: string[];
  workflowCompliance: WorkflowCompliance;
  solutions: string[];
  searchSuccess: boolean;
}

export interface AggregatedMetrics {
  skillLoaded: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  avgTokens: number;
  workflowScore: number;
  solutionsFound: number;
  searchSuccessRate: number;
  solutions: string[];
  runs: RunMetrics[];
}

export interface Thresholds {
  minWorkflowScore: number;
  maxTokenIncrease: number;
  minSolutionsFound: number;
}

export interface Baseline {
  version: number;
  generated: string;
  config: {
    runs: number;
    model: string | null;
    queryFile: string;
  };
  metrics: {
    skillLoaded: boolean;
    skillLoadMethod: "explicit" | "implicit" | "none";
    workflowScore: number;
    avgTokens: number;
    solutionsFound: number;
    searchSuccessRate: number;
    solutions: string[];
  };
  thresholds: Thresholds;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  detail?: string;
}

export interface TestResult {
  passed: boolean;
  checks: CheckResult[];
  metrics: AggregatedMetrics;
  baseline: Baseline | null;
}
