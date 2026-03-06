import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { initializeSDKTest } from "../sdk-runner.ts";
import type { TestConfig } from "../types.ts";

describe("SDK Runner", () => {
  test("should initialize SDK with plugin", async () => {
    const config: TestConfig = {
      runs: 1,
      mode: "explicit",
      model: null,
      queryFile: "test.md",
      pluginSource: process.cwd(),
      projectDir: process.cwd(),
      sdk: {
        port: 4097,
      },
    };
    
    const context = await initializeSDKTest(config);
    
    expect(context.client).toBeDefined();
    expect(context.server).toBeDefined();
    expect(context.sessionId).toBeDefined();
    expect(typeof context.sessionId).toBe("string");
    expect(context.sessionId.length).toBeGreaterThan(0);
    
    context.server.close();
  });
  
  test("should create unique session IDs", async () => {
    const config: TestConfig = {
      runs: 1,
      mode: "explicit",
      model: null,
      queryFile: "test.md",
      pluginSource: process.cwd(),
      projectDir: process.cwd(),
      sdk: {
        port: 4098,
      },
    };
    
    const context1 = await initializeSDKTest({
      ...config,
      sdk: { port: 4098 },
    });
    
    const context2 = await initializeSDKTest({
      ...config,
      sdk: { port: 4099 },
    });
    
    expect(context1.sessionId).not.toBe(context2.sessionId);
    
    context1.server.close();
    context2.server.close();
  });
});
