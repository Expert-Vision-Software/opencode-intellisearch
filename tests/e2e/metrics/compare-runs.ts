import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Solution {
  name: string;
  githubRepo?: string;
}

interface LogEntry {
  type?: string;
  part?: {
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

interface RunResult {
  timestamp: string;
  solutions: Solution[];
  searchSuccess: boolean;
  searchFailures: string[];
  rawOutput: string;
  skillLoaded: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  toolsUsed: string[];
  workflowCompliance: {
    usedGhCli: boolean;
    usedDeepWiki: boolean;
    usedWebfetch: boolean;
    score: number;
  };
}

interface ConsistencyReport {
  generated: string;
  runCount: number;
  consistency: {
    jaccardScore: number;
    commonSolutions: string[];
    allSolutions: string[];
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
  };
  runs: RunResult[];
}

function extractSolutions(text: string): Solution[] {
  const solutions: Solution[] = [];
  
  const githubRegex = /github\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/gi;
  const repoMatches = text.match(githubRegex) ?? [];
  const uniqueRepos = [...new Set(repoMatches)];
  
  for (const repo of uniqueRepos) {
    const name = repo.split("/")[1] ?? repo;
    solutions.push({ name, githubRepo: repo });
  }
  
  const namePatterns = [
    /(?:solution|option|library|database):\s*\*\*([^*]+)\*\*/gi,
    /\|\s*\*\*([^*]+)\*\*\s*\|/gi,
    /^\s*[-*]\s+\*\*([^*]+)\*\*/gm
  ];
  
  for (const pattern of namePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (!solutions.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        solutions.push({ name });
      }
    }
  }
  
  return solutions;
}

function detectSearchFailures(text: string, skillLoaded: boolean, usedWebfetchOnGithub: boolean): { success: boolean; failures: string[] } {
  const failures: string[] = [];
  
  if (!skillLoaded) {
    failures.push("Skill Not Loaded");
  }
  
  if (usedWebfetchOnGithub) {
    failures.push("Direct GitHub Fetch (skill not followed)");
  }
  
  const failurePatterns = [
    { pattern: /captcha|bot detection|blocked/i, name: "Captcha/Block" },
    { pattern: /redirect.*enablejs|please click/i, name: "JS Redirect" },
    { pattern: /repository not found|not indexed/i, name: "DeepWiki Not Found" },
    { pattern: /403|401|forbidden|unauthorized/i, name: "Auth Error" },
    { pattern: /timeout|timed out/i, name: "Timeout" }
  ];
  
  for (const { pattern, name } of failurePatterns) {
    if (pattern.test(text)) {
      failures.push(name);
    }
  }
  
  return {
    success: failures.length === 0,
    failures
  };
}

function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function analyzeWorkflow(logContent: string): {
  skillLoaded: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  toolsUsed: string[];
  workflowCompliance: {
    usedGhCli: boolean;
    usedDeepWiki: boolean;
    usedWebfetch: boolean;
    usedWebfetchOnGithub: boolean;
    score: number;
  };
} {
  let skillLoaded = false;
  let skillLoadMethod: "explicit" | "implicit" | "none" = "none";
  const toolsUsed = new Set<string>();
  let usedGhCli = false;
  let usedDeepWiki = false;
  let usedWebfetch = false;
  let usedWebfetchOnGithub = false;
  
  const lines = logContent.split("\n").filter(Boolean);
  
  for (const line of lines) {
    try {
      const parsed: LogEntry = JSON.parse(line);
      
      if (parsed.type === "tool_use" && parsed.part?.tool) {
        const tool = parsed.part.tool;
        toolsUsed.add(tool);
        
        if (tool === "skill" && parsed.part.input?.name === "intellisearch") {
          skillLoaded = true;
          skillLoadMethod = "explicit";
        }
        
        if (tool === "task") {
          const command = parsed.part.input?.command ?? parsed.part.state?.input?.command ?? "";
          const prompt = parsed.part.input?.prompt ?? parsed.part.state?.input?.prompt ?? "";
          if (command.startsWith("/search-intelligently") || prompt.startsWith("/search-intelligently")) {
            skillLoaded = true;
            skillLoadMethod = "explicit";
          }
        }
        
        if (tool === "bash" && parsed.part.input?.command) {
          if (parsed.part.input.command.includes("gh search") || 
              parsed.part.input.command.includes("gh repo")) {
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
          if (parsed.part.input?.url?.includes("github.com")) {
            usedWebfetchOnGithub = true;
          }
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }
  
  let score = 0;
  if (skillLoaded) score += 0.3;
  if (usedGhCli) score += 0.25;
  if (usedDeepWiki) score += 0.25;
  if (!usedWebfetchOnGithub) score += 0.2;
  score = Math.min(1, score);
  
  return {
    skillLoaded,
    skillLoadMethod,
    toolsUsed: [...toolsUsed],
    workflowCompliance: {
      usedGhCli,
      usedDeepWiki,
      usedWebfetch,
      usedWebfetchOnGithub,
      score
    }
  };
}

async function compareRuns(resultsDir: string): Promise<ConsistencyReport> {
  const runs: RunResult[] = [];
  const entries = await readdir(resultsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const runDir = join(resultsDir, entry.name);
    const outputFile = join(runDir, "output.json");
    
    try {
      const content = await readFile(outputFile, "utf-8");
      const workflow = analyzeWorkflow(content);
      const { success: searchSuccess, failures } = detectSearchFailures(
        content, 
        workflow.skillLoaded, 
        workflow.workflowCompliance.usedWebfetchOnGithub
      );
      
      runs.push({
        timestamp: entry.name,
        solutions: extractSolutions(content),
        searchSuccess,
        searchFailures: failures,
        rawOutput: content,
        skillLoaded: workflow.skillLoaded,
        skillLoadMethod: workflow.skillLoadMethod,
        toolsUsed: workflow.toolsUsed,
        workflowCompliance: workflow.workflowCompliance
      });
    } catch (error) {
      console.error(`Failed to read ${outputFile}: ${(error as Error).message}`);
    }
  }
  
  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  
  const allSolutionNames = new Set<string>();
  for (const run of runs) {
    for (const sol of run.solutions) {
      allSolutionNames.add(sol.name.toLowerCase());
    }
  }
  
  let totalJaccard = 0;
  let comparisons = 0;
  const commonSolutions = new Set<string>(allSolutionNames);
  
  for (let i = 0; i < runs.length; i++) {
    const setI = new Set(runs[i].solutions.map(s => s.name.toLowerCase()));
    
    for (let j = i + 1; j < runs.length; j++) {
      const setJ = new Set(runs[j].solutions.map(s => s.name.toLowerCase()));
      totalJaccard += jaccardSimilarity(setI, setJ);
      comparisons++;
      
      const intersection = [...setI].filter(x => setJ.has(x));
      for (const sol of intersection) {
        if (!commonSolutions.has(sol)) {
          // Not common across all runs
        }
      }
    }
  }
  
  const avgJaccard = comparisons > 0 ? totalJaccard / comparisons : 0;
  
  const successRate = runs.filter(r => r.searchSuccess).length / runs.length;
  
  const loadedCount = runs.filter(r => r.skillLoaded).length;
  const explicitCount = runs.filter(r => r.skillLoadMethod === "explicit").length;
  const implicitCount = runs.filter(r => r.skillLoadMethod === "implicit").length;
  
  const avgWorkflowScore = runs.reduce((sum, r) => sum + r.workflowCompliance.score, 0) / runs.length || 0;
  const runsUsingGhCli = runs.filter(r => r.workflowCompliance.usedGhCli).length;
  const runsUsingDeepWiki = runs.filter(r => r.workflowCompliance.usedDeepWiki).length;
  const runsUsingWebfetch = runs.filter(r => r.workflowCompliance.usedWebfetch).length;
  
  const report: ConsistencyReport = {
    generated: new Date().toISOString(),
    runCount: runs.length,
    consistency: {
      jaccardScore: Math.round(avgJaccard * 100) / 100,
      commonSolutions: [...commonSolutions],
      allSolutions: [...allSolutionNames]
    },
    searchSuccessRate: Math.round(successRate * 100) / 100,
    tokenMetrics: {
      average: 0,
      min: 0,
      max: 0,
      stdDev: 0
    },
    skillMetrics: {
      loadedCount,
      explicitCount,
      implicitCount,
      loadRate: runs.length > 0 ? loadedCount / runs.length : 0
    },
    workflowCompliance: {
      averageScore: Math.round(avgWorkflowScore * 100) / 100,
      runsUsingGhCli,
      runsUsingDeepWiki,
      runsUsingWebfetch
    },
    runs
  };
  
  return report;
}

async function main(): Promise<void> {
  const resultsDir = process.argv[2] ?? "./tests/e2e/results";
  
  console.log(`Comparing runs in ${resultsDir}...`);
  const report = await compareRuns(resultsDir);
  
  const reportPath = join(resultsDir, "consistency-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  
  console.log("\n=== Consistency Report ===");
  console.log(`Runs analyzed: ${report.runCount}`);
  console.log(`Skill loaded: ${report.skillMetrics.loadedCount}/${report.runCount} (${Math.round(report.skillMetrics.loadRate * 100)}%) - explicit: ${report.skillMetrics.explicitCount}, implicit: ${report.skillMetrics.implicitCount}`);
  console.log(`Workflow compliance: ${report.workflowCompliance.averageScore} avg score`);
  console.log(`  - Using gh CLI: ${report.workflowCompliance.runsUsingGhCli} runs`);
  console.log(`  - Using DeepWiki: ${report.workflowCompliance.runsUsingDeepWiki} runs`);
  console.log(`  - Using webfetch (bad): ${report.workflowCompliance.runsUsingWebfetch} runs`);
  console.log(`Jaccard similarity: ${report.consistency.jaccardScore}`);
  console.log(`Search success rate: ${report.searchSuccessRate * 100}%`);
  console.log(`Unique solutions found: ${report.consistency.allSolutions.length}`);
  console.log(`\nReport written to ${reportPath}`);
}

main().catch(console.error);
