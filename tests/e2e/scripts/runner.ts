import { $ } from "bun";
import { join, basename } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import type { TestConfig, RunMetrics, AggregatedMetrics, GitMetadata, TokenMetricsReport, ConsistencyReport, WorkflowCompliance, ViolationSummary, ConsistencyLevel } from "./types.ts";
import { initializeSDKTest, checkSkillAvailability, type SDKTestContext } from "./sdk-runner.ts";
import { createEventMonitor, extractSolutions, calculateWorkflowCompliance, type EventMonitor } from "./event-monitor.ts";
import { setupTestProject, type TestProjectContext } from "./test-project.ts";

function generateResultsDirName(mode: string): string {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${mode}-${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function collectGitMetadata(projectDir: string): Promise<GitMetadata> {
  let commitHash = "";
  let branch = "";
  let mainCommitHash = "";
  let version = "unknown";
  
  try {
    commitHash = (await $`git rev-parse HEAD`.cwd(projectDir).quiet().text()).trim();
  } catch {}
  
  try {
    branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(projectDir).quiet().text()).trim();
    if (branch === "HEAD") {
      branch = commitHash.slice(0, 7) || "detached";
    }
  } catch {}
  
  try {
    mainCommitHash = (await $`git rev-parse origin/main`.cwd(projectDir).quiet().text()).trim();
  } catch {
    try {
      mainCommitHash = (await $`git rev-parse origin/master`.cwd(projectDir).quiet().text()).trim();
    } catch {}
  }
  
  try {
    const pkgContent = await readFile(join(projectDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgContent);
    version = pkg.version || "unknown";
  } catch {}
  
  return { commitHash, branch, version, mainCommitHash };
}

async function runSingleTest(
  config: TestConfig, 
  runIndex: number, 
  runDir: string
): Promise<RunMetrics> {
  const startTime = Date.now();
  
  console.log(`  Starting OpenCode SDK test...`);
  console.log(`  Mode: ${config.mode}`);
  
  let context: SDKTestContext | null = null;
  let monitor: EventMonitor | null = null;
  
  try {
    context = await initializeSDKTest(config);
    console.log(`  Session ID: ${context.sessionId}`);
    
    monitor = await createEventMonitor(context.client, context.sessionId, config);
    
    const queryFilePath = config.testProjectDir 
      ? join(config.testProjectDir, config.queryFile)
      : join(config.projectDir, config.queryFile);
    const queryContent = await readFile(queryFilePath, "utf-8");
    const query = config.mode === "explicit" 
      ? `/search-intelligently ${queryContent}` 
      : queryContent;
    
    console.log(`  Query preview: ${query.slice(0, 100).replace(/\n/g, ' ')}...`);
    
    await context.client.session.prompt({
      path: { id: context.sessionId },
      body: {
        parts: [{ type: "text", text: query }],
      },
    });
    
    await monitor.waitForCompletion();
    
    const skillDiscovery = await checkSkillAvailability(
      context.client,
      context.sessionId,
      config.testProjectDir ?? config.projectDir
    );
    
    if (skillDiscovery.available) {
      console.log(`  ✓ Skill available: ${skillDiscovery.skillName}`);
      console.log(`    Description: ${skillDiscovery.skillDescription?.slice(0, 100)}...`);
    } else {
      console.log(`  ✗ Skill NOT available: ${skillDiscovery.error}`);
    }
    
    const earlyFailure = config.mode === "explicit" && 
                         monitor.toolCallCount >= 5 && 
                         !monitor.skillDetected;
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`  Completed in ${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`);
    
    if (earlyFailure) {
      return {
        timestamp: `run-${runIndex}-${Date.now()}`,
        inputTokens: monitor.tokens.input,
        outputTokens: monitor.tokens.output,
        totalTokens: monitor.tokens.input + monitor.tokens.output,
        skillLoaded: false,
        skillLoadMethod: "none",
        skillDiscovery,
        toolsUsed: [...monitor.toolsUsed],
        workflowCompliance: {
          usedGhCli: false,
          usedDeepWiki: false,
          usedWebfetch: false,
          usedWebfetchOnGithub: false,
          score: 0,
          breakdown: { skillLoaded: 0, ghCli: 0, deepWiki: 0, noWebfetchOnGithub: 0 },
          violations: [{
            rule: "explicit_skill_required",
            detail: "Skill failed to load in explicit mode",
            impact: -0.3,
          }],
          enhanced: {
            toolDiversity: 0,
            searchDepth: 0,
            tokenEfficiency: 0,
            workflowDuration: elapsed,
          },
        },
        solutions: [],
        searchSuccess: false,
        earlyFailure: true,
        earlyFailureReason: "EARLY_FAILURE: Skill not loaded after 5 tool calls in explicit mode",
        workflowDuration: elapsed,
      };
    }
    
    const messages = await context.client.session.messages({
      path: { id: context.sessionId },
    });
    
    const allText = (messages.data ?? [])
      .flatMap(m => m.parts.map(p => {
        if (p.type === "text") return p.text;
        return "";
      }))
      .join(" ");
    
    const solutions = extractSolutions(allText);
    const workflow = calculateWorkflowCompliance(monitor, allText, config.mode, solutions.length);
    
    return {
      timestamp: `run-${runIndex}-${Date.now()}`,
      inputTokens: monitor.tokens.input,
      outputTokens: monitor.tokens.output,
      totalTokens: monitor.tokens.input + monitor.tokens.output,
      skillLoaded: monitor.skillDetected,
      skillLoadMethod: monitor.skillLoadMethod,
      skillDiscovery,
      toolsUsed: [...monitor.toolsUsed],
      workflowCompliance: workflow,
      solutions,
      searchSuccess: !earlyFailure && workflow.score >= 0.5,
      workflowDuration: elapsed,
    };
    
  } catch (error) {
    console.error(`  Error: ${(error as Error).message}`);
    throw error;
  } finally {
    if (monitor) {
      monitor.abort();
    }
    if (context) {
      try {
        await context.client.session.delete({
          path: { id: context.sessionId },
        });
      } catch {}
      context.server.close();
    }
  }
}

async function saveRunMetrics(runDir: string, metrics: RunMetrics): Promise<void> {
  await writeFile(
    join(runDir, "run-metrics.json"), 
    JSON.stringify(metrics, null, 2)
  );
}

async function loadRunsFromDirectory(resultsDir: string): Promise<RunMetrics[]> {
  const runs: RunMetrics[] = [];
  const dir = Bun.file(resultsDir);
  
  if (!(await dir.exists())) {
    return runs;
  }
  
  const entries = Array.from(new Bun.Glob("run-*/run-metrics.json").scanSync(resultsDir));
  
  for (const entry of entries) {
    try {
      const file = Bun.file(join(resultsDir, entry));
      const metrics = await file.json() as RunMetrics;
      runs.push(metrics);
    } catch {}
  }
  
  return runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function computeAggregatedMetrics(runs: RunMetrics[], meta: GitMetadata): AggregatedMetrics {
  const avgTokens = Math.round(
    runs.reduce((sum, r) => sum + r.totalTokens, 0) / runs.length
  );
  
  const avgWorkflowScore = Math.round(
    runs.reduce((sum, r) => sum + r.workflowCompliance.score, 0) / runs.length * 100
  ) / 100;
  
  const successRate = runs.filter(r => r.searchSuccess).length / runs.length;
  
  const allSolutions = new Set<string>();
  for (const run of runs) {
    for (const sol of run.solutions) {
      allSolutions.add(sol);
    }
  }
  
  const skillLoaded = runs.every(r => r.skillLoaded);
  const skillLoadMethods = new Set(runs.map(r => r.skillLoadMethod));
  const skillLoadMethod = skillLoaded 
    ? (skillLoadMethods.has("explicit") ? "explicit" : "implicit")
    : "none";
  
  return {
    skillLoaded,
    skillLoadMethod,
    avgTokens,
    workflowScore: avgWorkflowScore,
    solutionsFound: allSolutions.size,
    searchSuccessRate: successRate,
    solutions: [...allSolutions],
    runs,
    meta
  };
}

export async function runTests(config: TestConfig): Promise<{ metrics: AggregatedMetrics; resultsDir: string }> {
  const meta = await collectGitMetadata(config.projectDir);
  const resultsDirName = generateResultsDirName(config.mode);
  const resultsDir = join(config.projectDir, "tests/e2e/results", resultsDirName);
  await mkdir(resultsDir, { recursive: true });
  
  const queryFileDir = join(config.projectDir, "tests/e2e/test-queries");
  const testProject = await setupTestProject(
    config.pluginSource,
    queryFileDir,
    config.model
  );
  
  const testConfig: TestConfig = {
    ...config,
    testProjectDir: testProject.directory,
    queryFile: "test-queries/" + basename(config.queryFile),
  };
  
  const runs: RunMetrics[] = [];
  
  try {
    for (let i = 0; i < testConfig.runs; i++) {
      console.log(`\nRunning test ${i + 1}/${testConfig.runs}...`);
      
      const runTimestamp = Date.now();
      const runDirName = `run-${i + 1}-${runTimestamp}`;
      const runDir = join(resultsDir, runDirName);
      await mkdir(runDir, { recursive: true });
      
      const metrics = await runSingleTest(testConfig, i + 1, runDir);
      runs.push(metrics);
      
      await saveRunMetrics(runDir, metrics);
      
      const aggregated = computeAggregatedMetrics(runs, meta);
      await saveTokenMetrics(resultsDir, aggregated);
      await saveConsistencyReport(resultsDir, aggregated);
    }
    
    const finalAggregated = computeAggregatedMetrics(runs, meta);
    return { metrics: finalAggregated, resultsDir };
  } finally {
    await testProject.cleanup();
  }
}

async function saveTokenMetrics(resultsDir: string, metrics: AggregatedMetrics): Promise<void> {
  const avgInput = Math.round(metrics.runs.reduce((s, r) => s + r.inputTokens, 0) / metrics.runs.length);
  const avgOutput = Math.round(metrics.runs.reduce((s, r) => s + r.outputTokens, 0) / metrics.runs.length);
  
  const report: TokenMetricsReport = {
    generated: new Date().toISOString(),
    runCount: metrics.runs.length,
    averages: {
      inputTokens: avgInput,
      outputTokens: avgOutput,
      totalTokens: metrics.avgTokens
    },
    meta: metrics.meta,
    runs: metrics.runs
  };
  
  await writeFile(join(resultsDir, "token-metrics.json"), JSON.stringify(report, null, 2));
}

async function saveConsistencyReport(resultsDir: string, metrics: AggregatedMetrics): Promise<void> {
  const allSolutionNames = new Set<string>();
  for (const run of metrics.runs) {
    for (const sol of run.solutions) {
      allSolutionNames.add(sol.toLowerCase());
    }
  }
  
  let totalJaccard = 0;
  let comparisons = 0;
  
  for (let i = 0; i < metrics.runs.length; i++) {
    const setI = new Set(metrics.runs[i].solutions.map(s => s.toLowerCase()));
    for (let j = i + 1; j < metrics.runs.length; j++) {
      const setJ = new Set(metrics.runs[j].solutions.map(s => s.toLowerCase()));
      const intersection = new Set([...setI].filter(x => setJ.has(x)));
      const union = new Set([...setI, ...setJ]);
      totalJaccard += union.size === 0 ? 0 : intersection.size / union.size;
      comparisons++;
    }
  }
  
  const avgJaccard = comparisons > 0 ? totalJaccard / comparisons : 0;
  const consistencyLevel: ConsistencyLevel = avgJaccard >= 0.5 ? "HIGH" : avgJaccard >= 0.3 ? "MEDIUM" : "LOW";
  
  const tokenValues = metrics.runs.map(r => r.totalTokens);
  const avgTokens = tokenValues.reduce((a, b) => a + b, 0) / tokenValues.length || 0;
  const minTokens = Math.min(...tokenValues) || 0;
  const maxTokens = Math.max(...tokenValues) || 0;
  const stdDev = tokenValues.length > 0 
    ? Math.sqrt(tokenValues.map(v => Math.pow(v - avgTokens, 2)).reduce((a, b) => a + b, 0) / tokenValues.length)
    : 0;
  
  const loadedCount = metrics.runs.filter(r => r.skillLoaded).length;
  const explicitCount = metrics.runs.filter(r => r.skillLoadMethod === "explicit").length;
  const implicitCount = metrics.runs.filter(r => r.skillLoadMethod === "implicit").length;
  
  const avgWorkflowScore = metrics.runs.reduce((s, r) => s + r.workflowCompliance.score, 0) / metrics.runs.length || 0;
  const runsUsingGhCli = metrics.runs.filter(r => r.workflowCompliance.usedGhCli).length;
  const runsUsingDeepWiki = metrics.runs.filter(r => r.workflowCompliance.usedDeepWiki).length;
  const runsUsingWebfetch = metrics.runs.filter(r => r.workflowCompliance.usedWebfetch).length;
  
  const violationMap = new Map<string, { count: number; totalImpact: number; runs: string[] }>();
  for (const run of metrics.runs) {
    for (const violation of run.workflowCompliance.violations) {
      const existing = violationMap.get(violation.rule) || { count: 0, totalImpact: 0, runs: [] };
      existing.count++;
      existing.totalImpact += violation.impact;
      existing.runs.push(run.timestamp);
      violationMap.set(violation.rule, existing);
    }
  }
  const violations: ViolationSummary[] = [...violationMap.entries()].map(([rule, data]) => ({
    rule,
    count: data.count,
    totalImpact: Math.round(data.totalImpact * 100) / 100,
    runs: data.runs,
  }));
  
  const report: ConsistencyReport = {
    generated: new Date().toISOString(),
    runCount: metrics.runs.length,
    consistency: {
      jaccardScore: Math.round(avgJaccard * 100) / 100,
      commonSolutions: [...allSolutionNames],
      allSolutions: [...allSolutionNames],
      level: consistencyLevel,
    },
    searchSuccessRate: metrics.searchSuccessRate,
    tokenMetrics: {
      average: Math.round(avgTokens),
      min: minTokens,
      max: maxTokens,
      stdDev: Math.round(stdDev)
    },
    skillMetrics: {
      loadedCount,
      explicitCount,
      implicitCount,
      loadRate: metrics.runs.length > 0 ? loadedCount / metrics.runs.length : 0
    },
    workflowCompliance: {
      averageScore: Math.round(avgWorkflowScore * 100) / 100,
      runsUsingGhCli,
      runsUsingDeepWiki,
      runsUsingWebfetch,
      violations,
    },
    meta: metrics.meta,
    runs: metrics.runs
  };
  
  await writeFile(join(resultsDir, "consistency-report.json"), JSON.stringify(report, null, 2));
}

export async function loadResultsDir(resultsDir: string): Promise<AggregatedMetrics | null> {
  const reportPath = join(resultsDir, "consistency-report.json");
  const file = Bun.file(reportPath);
  
  if (!(await file.exists())) {
    return null;
  }
  
  try {
    const report = await file.json() as ConsistencyReport;
    
    return {
      skillLoaded: report.skillMetrics.loadedCount === report.runCount,
      skillLoadMethod: report.skillMetrics.explicitCount > 0 ? "explicit" : 
                       report.skillMetrics.implicitCount > 0 ? "implicit" : "none",
      avgTokens: report.tokenMetrics.average,
      workflowScore: report.workflowCompliance.averageScore,
      solutionsFound: report.consistency.allSolutions.length,
      searchSuccessRate: report.searchSuccessRate,
      solutions: report.consistency.allSolutions,
      runs: report.runs,
      meta: report.meta
    };
  } catch {
    return null;
  }
}

export function getDefaultConfig(projectDir: string): TestConfig {
  return {
    runs: 1,
    mode: "explicit",
    model: null,
    queryFile: "tests/e2e/test-queries/graph-db-search.md",
    pluginSource: projectDir,
    projectDir
  };
}
