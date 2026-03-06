import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TestConfig, WorkflowCompliance } from "./types.ts";
import { printToolUse, printStepFinish, clearStatusLine } from "./report.ts";

export interface EventMonitor {
  toolCallCount: number;
  skillDetected: boolean;
  tokens: { input: number; output: number };
  toolsUsed: Set<string>;
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
    tokens: { input: 0, output: 0 },
    toolsUsed: new Set(),
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
            state.toolsUsed.add(part.tool);
            
            const input = part.state.input;
            
            if (part.tool === "skill" || part.tool === "task") {
              const name = input.name as string | undefined;
              const command = input.command as string | undefined;
              const prompt = input.prompt as string | undefined;
              
              if (name === "intellisearch" || 
                  command?.startsWith("/search-intelligently") ||
                  prompt?.startsWith("/search-intelligently")) {
                state.skillDetected = true;
                const cumulativeTokens = state.tokens.input + state.tokens.output;
                console.log(`  ✓ Skill loaded [${cumulativeTokens.toLocaleString()}]`);
              }
            }
            
            clearStatusLine();
            const cumulativeTokens = state.tokens.input + state.tokens.output;
            printToolUse(part.tool, input, Date.now(), cumulativeTokens);
            
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
  text: string
): WorkflowCompliance {
  const usedGhCli = text.includes("gh search") || text.includes("gh repo");
  const usedDeepWiki = monitor.toolsUsed.has("DeepWiki_ask_question") ||
                       monitor.toolsUsed.has("DeepWiki_read_wiki_structure");
  const usedWebfetch = monitor.toolsUsed.has("webfetch");
  const usedWebfetchOnGithub = usedWebfetch && text.includes("github.com");
  
  let score = 0;
  if (monitor.skillDetected) score += 0.3;
  if (usedGhCli) score += 0.25;
  if (usedDeepWiki) score += 0.25;
  if (!usedWebfetchOnGithub) score += 0.2;
  
  return {
    usedGhCli,
    usedDeepWiki,
    usedWebfetch,
    usedWebfetchOnGithub,
    score: Math.min(1, score),
  };
}
