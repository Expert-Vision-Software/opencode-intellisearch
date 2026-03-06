import { createServer } from "node:net";
import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TestConfig } from "./types.ts";

export interface SDKTestContext {
  client: OpencodeClient;
  server: { url: string; close: () => void };
  sessionId: string;
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
  const pluginPath = config.pluginSource.replace(/\\/g, "/");
  const pluginConfig = pluginPath.startsWith("/") || pluginPath.match(/^[A-Za-z]:/)
    ? `file://${pluginPath}`
    : pluginPath;
  
  const basePort = config.sdk?.port ?? 4096 + Math.floor(Math.random() * 1000);
  const port = await findAvailablePort(basePort, 100);
  
  console.log(`  Using port: ${port}`);
  
  const opencode = await createOpencode({
    hostname: config.sdk?.hostname ?? "127.0.0.1",
    port,
    timeout: config.sdk?.timeout ?? 10000,
    config: {
      plugin: [pluginConfig],
      model: config.model ?? undefined,
    },
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
}
