import { $ } from "bun";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { TestConfig, RunMetrics, AggregatedMetrics, WorkflowCompliance, GitMetadata, TokenMetricsReport, ConsistencyReport } from "./types.ts";
import { printToolUse, printStepFinish, clearStatusLine, printInactivityWarning, printTimeoutKilled, printStatusLine } from "./report.ts";

interface LogEntry {
  type?: string;
  part?: {
    tokens?: {
      input?: number;
      output?: number;
    };
    tool?: string;
    input?: {
      name?: string;
      command?: string;
      url?: string;
      prompt?: string;
    };
    state?: {
      input?: {
        command?: string;
        prompt?: string;
      };
    };
  };
}

const KEY_TOOLS_EXPLICIT = ["skill", "bash", "DeepWiki_ask_question", "DeepWiki_read_wiki_structure", "DeepWiki_read_wiki_contents", "webfetch", "task", "step_finish"];
const KEY_TOOLS_IMPLICIT = ["skill", "bash", "DeepWiki_ask_question", "DeepWiki_read_wiki_structure", "DeepWiki_read_wiki_contents", "webfetch", "step_finish"];

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

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

async function createIsolatedEnv(testId: string): Promise<{
  cacheDir: string;
  dataDir: string;
  cleanup: () => Promise<void>;
}> {
  const baseDir = join(tmpdir(), `opencode-e2e-${testId}`);
  const cacheDir = join(baseDir, "cache");
  const dataDir = join(baseDir, "data");
  
  await mkdir(join(cacheDir, "opencode"), { recursive: true });
  await mkdir(join(dataDir, "storage"), { recursive: true });
  
  await writeFile(join(cacheDir, "opencode", "version"), "21");
  await writeFile(join(dataDir, "opencode.db"), new Uint8Array(0));
  
  return {
    cacheDir,
    dataDir,
    cleanup: async () => {
      await $`rm -rf ${baseDir}`.quiet().nothrow();
    }
  };
}

function isKeyTool(tool: string, mode: string, input?: Record<string, unknown>): boolean {
  const keyTools = mode === "explicit" ? KEY_TOOLS_EXPLICIT : KEY_TOOLS_IMPLICIT;
  if (!keyTools.includes(tool)) return false;
  
  if (tool === "bash") {
    const cmd = (input?.command as string) || "";
    return cmd.includes("gh ") || cmd.includes("gh\t");
  }
  
  return true;
}

function parseLogOutput(content: string, mode: string): {
  tokens: { input: number; output: number };
  skillLoaded: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  toolsUsed: string[];
  workflow: WorkflowCompliance;
  solutions: string[];
  searchSuccess: boolean;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let skillLoaded = false;
  let skillLoadMethod: "explicit" | "implicit" | "none" = "none";
  const toolsUsed = new Set<string>();
  let usedGhCli = false;
  let usedDeepWiki = false;
  let usedWebfetch = false;
  let usedWebfetchOnGithub = false;
  const solutions = new Set<string>();
  
  const lines = content.split("\n").filter(Boolean);
  
  for (const line of lines) {
    try {
      const entry: LogEntry = JSON.parse(line);
      
      if (entry.type === "step_finish" && entry.part?.tokens) {
        inputTokens += entry.part.tokens.input ?? 0;
        outputTokens += entry.part.tokens.output ?? 0;
      }
      
      if (entry.type === "tool_use" && entry.part?.tool) {
        const tool = entry.part.tool;
        toolsUsed.add(tool);
        
        if (tool === "skill" && entry.part.input?.name === "intellisearch") {
          skillLoaded = true;
          skillLoadMethod = "explicit";
        }
        
        if (tool === "task") {
          const cmd = entry.part.input?.command ?? 
                      entry.part.state?.input?.command ?? 
                      entry.part.input?.prompt ?? 
                      entry.part.state?.input?.prompt ?? "";
          if (cmd.startsWith("/search-intelligently")) {
            skillLoaded = true;
            skillLoadMethod = "explicit";
          }
        }
        
        if (tool === "bash" && entry.part.input?.command) {
          const cmd = entry.part.input.command;
          if (cmd.includes("gh search") || cmd.includes("gh repo")) {
            usedGhCli = true;
          }
        }
        
        if (tool === "DeepWiki_ask_question" || 
            tool === "DeepWiki_read_wiki_structure" ||
            tool === "DeepWiki_read_wiki_contents") {
          usedDeepWiki = true;
        }
        
        if (tool === "webfetch") {
          usedWebfetch = true;
          const url = entry.part.input?.url ?? "";
          if (url.includes("github.com")) {
            usedWebfetchOnGithub = true;
          }
        }
      }
    } catch {}
  }
  
  const githubRepoRegex = /github\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/gi;
  const matches = content.match(githubRepoRegex) ?? [];
  for (const match of matches) {
    const name = match.split("/")[1]?.toLowerCase() ?? match.toLowerCase();
    solutions.add(name);
  }
  
  const failurePatterns = [
    /captcha|bot detection|blocked/i,
    /redirect.*enablejs|please click/i,
    /403|401|forbidden|unauthorized/i,
    /timeout|timed out/i
  ];
  
  const hasFailure = failurePatterns.some(p => p.test(content)) || 
                      usedWebfetchOnGithub ||
                      !skillLoaded;
  
  let score = 0;
  if (skillLoaded) score += 0.3;
  if (usedGhCli) score += 0.25;
  if (usedDeepWiki) score += 0.25;
  if (!usedWebfetchOnGithub) score += 0.2;
  score = Math.min(1, score);
  
  return {
    tokens: { input: inputTokens, output: outputTokens },
    skillLoaded,
    skillLoadMethod,
    toolsUsed: [...toolsUsed],
    workflow: {
      usedGhCli,
      usedDeepWiki,
      usedWebfetch,
      usedWebfetchOnGithub,
      score
    },
    solutions: [...solutions],
    searchSuccess: !hasFailure
  };
}

async function runSingleTest(
  config: TestConfig, 
  runIndex: number, 
  runDir: string
): Promise<RunMetrics> {
  const testId = `${Date.now()}-run-${runIndex}`;
  const { cacheDir, dataDir, cleanup } = await createIsolatedEnv(testId);
  
  const HARD_TIMEOUT_MS = 600000;
  const INACTIVITY_WARNING_MS = 60000;
  const STATUS_UPDATE_MS = 2000;
  
  try {
    const queryContent = await readFile(join(config.projectDir, config.queryFile), "utf-8");
    const query = config.mode === "explicit" 
      ? `/search-intelligently ${queryContent}` 
      : queryContent;
    
    const pluginPath = config.pluginSource.replace(/\\/g, "/");
    const configJson = JSON.stringify({ plugin: [pluginPath] });
    
    const env: Record<string, string> = {
      ...process.env,
      XDG_CACHE_HOME: cacheDir,
      XDG_STATE_HOME: join(cacheDir, "..", "state"),
      OPENCODE_TEST_HOME: join(cacheDir, "..", "home"),
      OPENCODE_DISABLE_MIGRATIONS: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
      OPENCODE_DISABLE_SHARE: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_CONFIG_CONTENT: configJson
    };
    
    const modelArgs = config.model ? ["--model", config.model] : [];
    
    const proc = Bun.spawn([
      "opencode", "run", "--format", "json", ...modelArgs
    ], {
      env,
      cwd: config.projectDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    
    proc.stdin.write(query);
    await proc.stdin.end();
    
    const outputLines: string[] = [];
    const stderrLines: string[] = [];
    const startTime = Date.now();
    let lastActivity = startTime;
    let lastTool = "start";
    let hasPrintedInactivityWarning = false;
    
    const MAX_TOOL_CALLS_WITHOUT_SKILL = 5;
    let toolCallCount = 0;
    let skillDetected = false;
    
    const statusInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      printStatusLine(lastTool, elapsed);
    }, STATUS_UPDATE_MS);
    
    const inactivityCheck = setInterval(() => {
      const inactiveMs = Date.now() - lastActivity;
      if (inactiveMs > INACTIVITY_WARNING_MS && !hasPrintedInactivityWarning) {
        printInactivityWarning(Math.floor(inactiveMs / 1000));
        hasPrintedInactivityWarning = true;
      }
    }, 10000);
    
    const hardTimeout = setTimeout(() => {
      proc.kill();
      printTimeoutKilled();
    }, HARD_TIMEOUT_MS);
    
    const decoder = new TextDecoder();
    
    async function readStream(
      stream: ReadableStream<Uint8Array>, 
      target: string[]
    ): Promise<void> {
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        target.push(text);
        
        for (const line of text.split("\n").filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === "tool_use" && entry.part?.tool) {
              toolCallCount++;
              lastActivity = Date.now();
              lastTool = entry.part.tool;
              hasPrintedInactivityWarning = false;
              
              if (entry.part.tool === "skill" || entry.part.tool === "task") {
                const cmd = entry.part.input?.command ?? 
                            entry.part.state?.input?.command ?? 
                            entry.part.input?.prompt ?? 
                            entry.part.state?.input?.prompt ?? "";
                if (cmd.startsWith("/search-intelligently") || 
                    entry.part.input?.name === "intellisearch") {
                  skillDetected = true;
                }
              }
              
              if (config.mode === "explicit" && 
                  toolCallCount >= MAX_TOOL_CALLS_WITHOUT_SKILL && 
                  !skillDetected) {
                proc.kill();
                throw new Error(
                  `EARLY_FAILURE: Skill not loaded after ${toolCallCount} tool calls in explicit mode`
                );
              }
              
              const tool = entry.part.tool;
              if (isKeyTool(tool, config.mode, entry.part.input as Record<string, unknown>)) {
                clearStatusLine();
                printToolUse(tool, entry.part.input ?? {}, entry.timestamp);
              }
            }
            if (entry.type === "step_finish" && entry.part?.tokens) {
              lastActivity = Date.now();
              clearStatusLine();
              printStepFinish(
                { input: entry.part.tokens.input ?? 0, output: entry.part.tokens.output ?? 0 },
                entry.timestamp
              );
            }
          } catch {}
        }
      }
    }
    
    try {
      await Promise.all([
        readStream(proc.stdout, outputLines),
        readStream(proc.stderr, stderrLines)
      ]);
      
      await proc.exited;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("EARLY_FAILURE:")) {
        console.log(`  ${error.message}`);
        
        clearInterval(statusInterval);
        clearInterval(inactivityCheck);
        clearTimeout(hardTimeout);
        clearStatusLine();
        
        const output = outputLines.join("");
        await writeFile(join(runDir, "output.json"), output);
        
        return {
          timestamp: `run-${runIndex}-${Date.now()}`,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          skillLoaded: false,
          skillLoadMethod: "none" as const,
          toolsUsed: [],
          workflowCompliance: {
            usedGhCli: false,
            usedDeepWiki: false,
            usedWebfetch: false,
            usedWebfetchOnGithub: false,
            score: 0
          },
          solutions: [],
          searchSuccess: false,
          earlyFailure: true,
          earlyFailureReason: error.message
        };
      }
      throw error;
    } finally {
      clearInterval(statusInterval);
      clearInterval(inactivityCheck);
      clearTimeout(hardTimeout);
      clearStatusLine();
      
      if (proc.exitCode === null) {
        proc.kill();
      }
    }
    
    const output = outputLines.join("");
    await writeFile(join(runDir, "output.json"), output);
    
    const parsed = parseLogOutput(output, config.mode);
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`  Completed in ${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, "0")}`);
    
    return {
      timestamp: `run-${runIndex}-${Date.now()}`,
      inputTokens: parsed.tokens.input,
      outputTokens: parsed.tokens.output,
      totalTokens: parsed.tokens.input + parsed.tokens.output,
      skillLoaded: parsed.skillLoaded,
      skillLoadMethod: parsed.skillLoadMethod,
      toolsUsed: parsed.toolsUsed,
      workflowCompliance: parsed.workflow,
      solutions: parsed.solutions,
      searchSuccess: parsed.searchSuccess
    };
  } finally {
    await cleanup();
  }
}

export async function runTests(config: TestConfig): Promise<{ metrics: AggregatedMetrics; resultsDir: string }> {
  const meta = await collectGitMetadata(config.projectDir);
  const resultsDirName = generateResultsDirName(config.mode);
  const resultsDir = join(config.projectDir, "tests/e2e/results", resultsDirName);
  await mkdir(resultsDir, { recursive: true });
  
  const runs: RunMetrics[] = [];
  
  for (let i = 0; i < config.runs; i++) {
    console.log(`\nRunning test ${i + 1}/${config.runs}...`);
    
    const runTimestamp = Date.now();
    const runDirName = `run-${i + 1}-${runTimestamp}`;
    const runDir = join(resultsDir, runDirName);
    await mkdir(runDir, { recursive: true });
    
    const metrics = await runSingleTest(config, i + 1, runDir);
    runs.push(metrics);
  }
  
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
  
  const aggregated: AggregatedMetrics = {
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
  
  await saveTokenMetrics(resultsDir, aggregated);
  await saveConsistencyReport(resultsDir, aggregated);
  
  return { metrics: aggregated, resultsDir };
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
  
  const report: ConsistencyReport = {
    generated: new Date().toISOString(),
    runCount: metrics.runs.length,
    consistency: {
      jaccardScore: Math.round(avgJaccard * 100) / 100,
      commonSolutions: [...allSolutionNames],
      allSolutions: [...allSolutionNames]
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
      runsUsingWebfetch
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
