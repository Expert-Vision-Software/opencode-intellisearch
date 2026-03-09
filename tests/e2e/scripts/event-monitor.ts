import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TestConfig, WorkflowCompliance, WorkflowViolation, ScoreBreakdown, EnhancedMetrics } from "./types.ts";
import { printToolUse, printStepFinish, clearStatusLine } from "./report.ts";

const SEARCH_TOOLS = new Set([
  "deepwiki_ask_question",
  "deepwiki_read_wiki_structure", 
  "deepwiki_read_wiki_contents",
  "bash",
  "webfetch",
  "google_search",
]);

const DEEPWIKI_TOOLS = new Set([
  "deepwiki_ask_question",
  "deepwiki_read_wiki_structure",
  "deepwiki_read_wiki_contents",
]);

const EXCLUDED_FROM_STEP_COUNT = new Set(["read", "skill", "task"]);

export interface ToolCallRecord {
  position: number;
  tool: string;
  isDeepWiki: boolean;
  isSearchTool: boolean;
  isRead: boolean;
}

export interface EventMonitor {
  toolCallCount: number;
  skillDetected: boolean;
  skillLoadMethod: "explicit" | "implicit" | "none";
  tokens: { input: number; output: number };
  toolsUsed: Set<string>;
  printedTools: Set<string>;
  bashCommands: string[];
  reposExamined: Set<string>;
  deepWikiQuestions: number;
  startTime: number;
  toolCallSequence: ToolCallRecord[];
  abort: () => void;
  waitForCompletion: () => Promise<void>;
}

const MAX_TOOL_CALLS_WITHOUT_SKILL = 5;

interface RunningToolPart {
  type: "tool";
  tool: string;
  state: {
    status: "running";
    input: Record<string, unknown>;
  };
}

interface StepFinishPart {
  type: "step-finish";
  tokens?: {
    input?: number;
    output?: number;
  };
}

function isRunningToolPart(part: unknown): part is RunningToolPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as Record<string, unknown>;
  return p.type === "tool" && 
         typeof p.tool === "string" &&
         typeof p.state === "object" && 
         p.state !== null &&
         (p.state as Record<string, unknown>).status === "running";
}

function isStepFinishPart(part: unknown): part is StepFinishPart {
  if (typeof part !== "object" || part === null) return false;
  return (part as Record<string, unknown>).type === "step-finish";
}

export async function createEventMonitor(
  client: OpencodeClient,
  sessionId: string,
  config: TestConfig
): Promise<EventMonitor> {
  let completionResolve: (() => void) | undefined;
  const completionPromise = new Promise<void>((resolve) => {
    completionResolve = resolve;
  });
  
  const abortController = new AbortController();
  
  const state: EventMonitor = {
    toolCallCount: 0,
    skillDetected: false,
    skillLoadMethod: "none",
    tokens: { input: 0, output: 0 },
    toolsUsed: new Set(),
    printedTools: new Set(),
    bashCommands: [],
    reposExamined: new Set(),
    deepWikiQuestions: 0,
    startTime: Date.now(),
    toolCallSequence: [],
    abort: () => abortController.abort(),
    waitForCompletion: () => {
      const timeoutMs = 600000;
      return Promise.race([
        completionPromise,
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error(`Session completion timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    },
  };
  
  const pollInterval = setInterval(async () => {
    try {
      const statusResult = await client.session.status({});
      const sessionStatus = statusResult.data?.[sessionId];
      if (sessionStatus?.type === "idle") {
        if (completionResolve) {
          completionResolve();
        }
        abortController.abort();
        clearInterval(pollInterval);
      }
    } catch {}
  }, 3000);
  
  (async () => {
    try {
      const events = await client.event.subscribe({
        signal: abortController.signal,
      });
      
      for await (const event of events.stream) {
        if (abortController.signal.aborted) break;
        
        if (event.type === "message.part.updated") {
          const part = event.properties.part;
          
          if (isRunningToolPart(part)) {
            state.toolCallCount++;
            const toolName = part.tool.toLowerCase();
            state.toolsUsed.add(toolName);
            
            const isDeepWiki = DEEPWIKI_TOOLS.has(toolName);
            const isSearchTool = SEARCH_TOOLS.has(toolName);
            const isRead = toolName === "read";
            
            state.toolCallSequence.push({
              position: state.toolCallCount,
              tool: toolName,
              isDeepWiki,
              isSearchTool,
              isRead,
            });
            
            const input = part.state.input;
            const toolKey = `${toolName}:${JSON.stringify(input)}`;
            
            if (toolName === "skill" || toolName === "task") {
              const name = input.name as string | undefined;
              const command = input.command as string | undefined;
              const prompt = input.prompt as string | undefined;
              
              const isExplicitCommand = command?.startsWith("/search-intelligently") ||
                                        prompt?.startsWith("/search-intelligently");
              const isImplicitSkill = name === "intellisearch";
              
              if (isExplicitCommand || isImplicitSkill) {
                state.skillDetected = true;
                state.skillLoadMethod = isExplicitCommand ? "explicit" : "implicit";
                const cumulativeTokens = state.tokens.input + state.tokens.output;
                console.log(`  ✓ Skill loaded [${cumulativeTokens.toLocaleString()}]`);
              }
            }
            
            clearStatusLine();
            const cumulativeTokens = state.tokens.input + state.tokens.output;
            
            if (toolName === "bash") {
              const cmd = String(input.command || "");
              if (cmd) {
                state.bashCommands.push(cmd);
              }
            }
            
            if (toolName === "deepwiki_ask_question" || 
                toolName === "deepwiki_read_wiki_structure" ||
                toolName === "deepwiki_read_wiki_contents") {
              const repoName = String(input.repoName || "");
              if (repoName) {
                state.reposExamined.add(repoName.toLowerCase());
              }
              if (toolName === "deepwiki_ask_question") {
                state.deepWikiQuestions++;
              }
            }
            
            if (!state.printedTools.has(toolKey)) {
              state.printedTools.add(toolKey);
              printToolUse(part.tool, input, Date.now(), cumulativeTokens);
            }
            
            if (config.mode === "explicit" && 
                state.toolCallCount >= MAX_TOOL_CALLS_WITHOUT_SKILL && 
                !state.skillDetected) {
              console.log(`  ✗ EARLY_FAILURE: Skill not loaded after ${state.toolCallCount} tool calls`);
              abortController.abort();
              await client.session.abort({ path: { id: sessionId } });
            }
          }
          
          if (isStepFinishPart(part)) {
            if (part.tokens) {
              state.tokens.input += part.tokens.input ?? 0;
              state.tokens.output += part.tokens.output ?? 0;
              clearStatusLine();
              const cumulativeTokens = state.tokens.input + state.tokens.output;
              printStepFinish(
                { input: part.tokens.input ?? 0, output: part.tokens.output ?? 0 },
                Date.now(),
                cumulativeTokens
              );
            }
          }
        }
        
        if (event.type === "session.status") {
          const props = event.properties as { sessionID: string; status: { type: string } };
          if (props.sessionID === sessionId && props.status.type === "idle") {
            const cumulativeTokens = state.tokens.input + state.tokens.output;
            console.log(`  Session completed [${cumulativeTokens.toLocaleString()}]`);
            if (completionResolve) completionResolve();
            abortController.abort();
          }
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        console.error(`  Event stream error: ${(error as Error).message}`);
        if (completionResolve) {
          completionResolve();
        }
      }
      clearInterval(pollInterval);
    }
  })();
  
  return state;
}

export function extractSolutions(text: string): string[] {
  const solutions = new Set<string>();
  const githubRepoRegex = /github\.com\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/gi;
  const matches = text.match(githubRepoRegex) ?? [];
  
  for (const match of matches) {
    const name = match.split("/")[1]?.toLowerCase() ?? match.toLowerCase();
    solutions.add(name);
  }
  
  return [...solutions];
}

export function calculateWorkflowCompliance(
  monitor: EventMonitor,
  text: string,
  mode?: "explicit" | "implicit",
  solutionsFound?: number
): WorkflowCompliance {
  const usedGhCli = text.includes("gh search") || text.includes("gh repo");
  const usedDeepWiki = monitor.toolsUsed.has("deepwiki_ask_question") ||
                       monitor.toolsUsed.has("deepwiki_read_wiki_structure") ||
                       monitor.bashCommands.some(cmd => cmd.includes("mcp.deepwiki.com"));
  const usedWebfetch = monitor.toolsUsed.has("webfetch");
  const usedWebfetchOnGithub = usedWebfetch && text.includes("github.com");
  
  const breakdown: ScoreBreakdown = {
    skillLoaded: monitor.skillDetected ? 0.3 : 0,
    ghCli: usedGhCli ? 0.25 : 0,
    deepWiki: usedDeepWiki ? 0.25 : 0,
    noWebfetchOnGithub: !usedWebfetchOnGithub ? 0.2 : 0,
  };
  
  const violations: WorkflowViolation[] = [];
  
  if (usedWebfetchOnGithub) {
    violations.push({
      rule: "no_webfetch_on_github",
      detail: "Used webfetch on github.com instead of DeepWiki",
      impact: -0.2,
    });
  }
  
  if (monitor.skillDetected && !usedDeepWiki) {
    violations.push({
      rule: "must_use_deepwiki",
      detail: "Skill loaded but DeepWiki not used",
      impact: -0.25,
    });
  }
  
  if (mode === "explicit" && !monitor.skillDetected) {
    violations.push({
      rule: "explicit_skill_required",
      detail: "Skill failed to load in explicit mode",
      impact: -0.3,
    });
  }
  
  const onlyGoogleSearchUsed = monitor.toolsUsed.has("google_search") && 
                                !monitor.skillDetected &&
                                monitor.toolCallCount >= 3;
  if (onlyGoogleSearchUsed) {
    violations.push({
      rule: "stuck_on_google_search",
      detail: "Multiple google_search calls without skill loading",
      impact: -0.15,
    });
  }
  
  const deepWikiCalls = monitor.toolCallSequence.filter(c => c.isDeepWiki);
  const firstDeepWikiCall = deepWikiCalls[0];
  const lastDeepWikiCall = deepWikiCalls[deepWikiCalls.length - 1];
  
  if (firstDeepWikiCall && monitor.skillDetected) {
    const nonReadStepsBeforeDeepWiki = monitor.toolCallSequence
      .filter(c => c.position < firstDeepWikiCall.position && !EXCLUDED_FROM_STEP_COUNT.has(c.tool))
      .length;
    
    if (nonReadStepsBeforeDeepWiki > 2) {
      const excessSteps = nonReadStepsBeforeDeepWiki - 2;
      const scaledImpact = Math.min(0.25, 0.10 + (excessSteps * 0.03));
      violations.push({
        rule: "delayed_deepwiki_start",
        detail: `${nonReadStepsBeforeDeepWiki} non-read steps before first DeepWiki call`,
        impact: -Math.round(scaledImpact * 100) / 100,
      });
    }
    
    const totalDeepWikiCalls = deepWikiCalls.length;
    if (totalDeepWikiCalls < 2) {
      const deficit = 2 - totalDeepWikiCalls;
      const scaledImpact = Math.min(0.20, 0.10 + (deficit * 0.05));
      violations.push({
        rule: "insufficient_deepwiki_usage",
        detail: `Only ${totalDeepWikiCalls} DeepWiki call(s)`,
        impact: -Math.round(scaledImpact * 100) / 100,
      });
    }
    
    if (lastDeepWikiCall) {
      const searchToolsAfterDeepWiki = monitor.toolCallSequence
        .filter(c => 
          c.position > lastDeepWikiCall.position && 
          c.isSearchTool && 
          !c.isDeepWiki
        ).length;
      
      if (searchToolsAfterDeepWiki > 3) {
        const excessSearches = searchToolsAfterDeepWiki - 3;
        const scaledImpact = Math.min(0.20, 0.08 + (excessSearches * 0.02));
        violations.push({
          rule: "excessive_post_deepwiki_search",
          detail: `${searchToolsAfterDeepWiki} search tool calls after last DeepWiki`,
          impact: -Math.round(scaledImpact * 100) / 100,
        });
      }
    }
  }
  
  const usedSearchTools = [...monitor.toolsUsed].filter(t => SEARCH_TOOLS.has(t));
  const toolDiversity = usedSearchTools.length / SEARCH_TOOLS.size;
  const searchDepth = monitor.reposExamined.size;
  const totalTokens = monitor.tokens.input + monitor.tokens.output;
  const tokenEfficiency = solutionsFound && solutionsFound > 0 
    ? totalTokens / solutionsFound 
    : totalTokens;
  const workflowDuration = Math.floor((Date.now() - monitor.startTime) / 1000);
  
  const enhanced: EnhancedMetrics = {
    toolDiversity: Math.round(toolDiversity * 100) / 100,
    searchDepth,
    tokenEfficiency: Math.round(tokenEfficiency),
    workflowDuration,
  };
  
  const score = Math.min(1, breakdown.skillLoaded + breakdown.ghCli + breakdown.deepWiki + breakdown.noWebfetchOnGithub);
  
  return {
    usedGhCli,
    usedDeepWiki,
    usedWebfetch,
    usedWebfetchOnGithub,
    score,
    breakdown,
    violations,
    enhanced,
  };
}
