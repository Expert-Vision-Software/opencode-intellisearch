import { createServer } from "node:net";
import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TestConfig } from "./types.ts";

export interface SDKTestContext {
  client: OpencodeClient;
  server: { url: string; close: () => void };
  sessionId: string;
}

export async function initializeSDKTest(config: TestConfig): Promise<SDKTestContext> {
  const pluginPath = config.pluginSource.replace(/\\/g, "/");
  
  const opencode = await createOpencode({
    hostname: config.sdk?.hostname ?? "127.0.0.1",
    port: config.sdk?.port ?? 4096,
    timeout: config.sdk?.timeout ?? 10000,
    config: {
      plugin: [pluginPath],
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
