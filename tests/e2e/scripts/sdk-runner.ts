import { createServer } from "node:net";
import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TestConfig, SkillDiscovery } from "./types.ts";

export interface SDKTestContext {
  client: OpencodeClient;
  server: { url: string; close: () => void };
  sessionId: string;
}

export async function checkSkillAvailability(
  client: OpencodeClient,
  sessionId: string,
  projectDir: string
): Promise<SkillDiscovery> {
  try {
    const skillFile = `${projectDir}/.opencode/skills/intellisearch/SKILL.md`;
    const file = Bun.file(skillFile);
    const fileExists = await file.exists();
    
    if (!fileExists) {
      return {
        available: false,
        skillName: null,
        skillDescription: null,
        error: "Skill file not found at expected location",
      };
    }
    
    const skillContent = await file.text();
    const nameMatch = skillContent.match(/^name:\s*(.+)$/m);
    const descMatch = skillContent.match(/^description:\s*(.+)$/m);
    
    if (!nameMatch || !descMatch) {
      return {
        available: false,
        skillName: null,
        skillDescription: null,
        error: "Skill file exists but missing name or description in frontmatter",
      };
    }
    
    return {
      available: true,
      skillName: nameMatch[1].trim(),
      skillDescription: descMatch[1].trim(),
    };
  } catch (error) {
    return {
      available: false,
      skillName: null,
      skillDescription: null,
      error: `Failed to check skills: ${(error as Error).message}`,
    };
  }
}

async function findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, attempts: number) => {
      if (attempts >= maxAttempts) {
        reject(new Error(`Could not find available port after ${maxAttempts} attempts`));
        return;
      }
      
      const server = createServer();
      server.once("error", () => tryPort(port + 1, attempts + 1));
      server.once("listening", () => {
        server.close();
        resolve(port);
      });
      server.listen(port, "127.0.0.1");
    };
    
    tryPort(startPort, 0);
  });
}

export async function initializeSDKTest(config: TestConfig): Promise<SDKTestContext> {
  const projectDir = config.testProjectDir;
  
  if (!projectDir) {
    throw new Error("testProjectDir is required in TestConfig");
  }
  
  const basePort = config.sdk?.port ?? 4096 + Math.floor(Math.random() * 1000);
  const port = await findAvailablePort(basePort, 100);
  
  console.log(`  Using port: ${port}`);
  console.log(`  Project dir: ${projectDir}`);
  
  const inlineConfig: Record<string, unknown> = {
    plugin: [`file:///${config.pluginSource.replace(/\\/g, "/")}`],
  };
  
  if (config.model) {
    inlineConfig.model = config.model;
  }
  
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(inlineConfig);
  
  const originalCwd = process.cwd();
  process.chdir(projectDir);
  
  try {
    const opencode = await createOpencode({
      hostname: config.sdk?.hostname ?? "127.0.0.1",
      port,
      timeout: config.sdk?.timeout ?? 10000,
    });
    
    const session = await opencode.client.session.create({
      body: { title: `E2E Test ${Date.now()}` },
    });
    
    const sessionId = session.data?.id;
    if (!sessionId) {
      throw new Error("Failed to create session: no session ID returned");
    }
    
    return {
      client: opencode.client,
      server: opencode.server,
      sessionId,
    };
  } finally {
    process.chdir(originalCwd);
  }
}
