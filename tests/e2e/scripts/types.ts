export type SkillMode = "explicit" | "implicit";

export interface GitMetadata {
  commitHash: string;
  branch: string;
  version: string;
  mainCommitHash: string;
}

export interface TestConfig {
  runs: number;
  mode: SkillMode;
  model: string | null;
  queryFile: string;
  pluginSource: string;
  projectDir: string;
  testProjectDir?: string;
  sdk?: {
    hostname?: string;
    port?: number;
    timeout?: number;
  };
}

export interface ScoreBreakdown {
  skillLoaded: number;
  ghCli: number;
  deepWiki: number;
  noWebfetchOnGithub: number;
}

export interface WorkflowViolation {
  rule: string;
  detail: string;
  impact: number;
}

export interface EnhancedMetrics {
  toolDiversity: number;
  searchDepth: number;
  tokenEfficiency: number;
  workflowDuration: number;
}

export interface WorkflowCompliance {
  usedGhCli: boolean;
  usedDeepWiki: boolean;
  usedWebfetch: boolean;
  usedWebfetchOnGithub: boolean;
  score: number;
  breakdown: ScoreBreakdown;
  violations: WorkflowViolation[];
  enhanced: EnhancedMetrics;
}

export interface SkillDiscovery {
  available: boolean;
  skillName: string | null;
  skillDescription: string | null;
  error?: string;
}

export type ConsistencyLevel = "HIGH" | "MEDIUM" | "LOW";

export interface RunMetrics {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  skillLoaded: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  skillDiscovery: SkillDiscovery;
  toolsUsed: string[];
  workflowCompliance: WorkflowCompliance;
  solutions: string[];
  searchSuccess: boolean;
  earlyFailure?: boolean;
  earlyFailureReason?: string;
  workflowDuration: number;
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
  meta?: GitMetadata;
}

export interface Thresholds {
  minWorkflowScore: number;
  maxTokenIncrease: number;
  minSolutionsFound: number;
  scoreTolerance: number;
}

export interface Regression {
  type: "workflow_score" | "token_usage" | "skill_load" | "solutions_found";
  severity: number;
  expected: number | string;
  actual: number | string;
}

export interface ViolationSummary {
  rule: string;
  count: number;
  totalImpact: number;
  runs: string[];
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
  meta?: GitMetadata;
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

export interface TokenMetricsReport {
  generated: string;
  runCount: number;
  averages: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  meta?: GitMetadata;
  runs: RunMetrics[];
}

export interface ConsistencyReport {
  generated: string;
  runCount: number;
  consistency: {
    jaccardScore: number;
    commonSolutions: string[];
    allSolutions: string[];
    level: ConsistencyLevel;
  };
  searchSuccessRate: number;
  tokenMetrics: {
    average: number;
    min: number;
    max: number;
    stdDev: number;
  };
  skillMetrics: {
    loadedCount: number;
    explicitCount: number;
    implicitCount: number;
    loadRate: number;
  };
  workflowCompliance: {
    averageScore: number;
    runsUsingGhCli: number;
    runsUsingDeepWiki: number;
    runsUsingWebfetch: number;
    violations: ViolationSummary[];
  };
  meta?: GitMetadata;
  runs: RunMetrics[];
}
