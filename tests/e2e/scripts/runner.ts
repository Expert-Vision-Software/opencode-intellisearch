import { $ } from "bun";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { TestConfig, RunMetrics, AggregatedMetrics, WorkflowCompliance } from "./types.ts";

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

function getTimestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
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

function parseLogOutput(content: string): {
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
    } catch {
      // Skip non-JSON lines
    }
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

async function runSingleTest(config: TestConfig, runIndex: number): Promise<RunMetrics> {
  const testId = `${getTimestamp()}-run-${runIndex}`;
  const { cacheDir, dataDir, cleanup } = await createIsolatedEnv(testId);
  
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
    
    const result = await $`opencode run ${query} --format json ${modelArgs}`
      .env(env)
      .cwd(config.projectDir)
      .quiet()
      .nothrow();
    
    const output = result.stdout.toString() + result.stderr.toString();
    const parsed = parseLogOutput(output);
    
    return {
      timestamp: testId,
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

export async function runTests(config: TestConfig): Promise<AggregatedMetrics> {
  const runs: RunMetrics[] = [];
  
  for (let i = 0; i < config.runs; i++) {
    process.stdout.write(`\rRunning test ${i + 1}/${config.runs}...`);
    const metrics = await runSingleTest(config, i + 1);
    runs.push(metrics);
  }
  console.log("\n");
  
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
    runs
  };
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
