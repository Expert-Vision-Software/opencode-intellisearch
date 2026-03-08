import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { initializeSDKTest } from "../sdk-runner.ts";
import { setupTestProject, type TestProjectContext } from "../test-project.ts";
import type { TestConfig } from "../types.ts";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

describe("SDK Runner", () => {
  let testProject: TestProjectContext;
  let config: TestConfig;
  
  beforeAll(async () => {
    const queryFileDir = join(process.cwd(), "tests/e2e/test-queries");
    testProject = await setupTestProject(
      process.cwd(),
      queryFileDir,
      null
    );
    
    config = {
      runs: 1,
      mode: "explicit",
      model: null,
      queryFile: "test-queries/graph-db-search.md",
      pluginSource: process.cwd(),
      projectDir: process.cwd(),
      testProjectDir: testProject.directory,
    };
  });
  
  afterAll(async () => {
    await testProject.cleanup();
  });
  
  test("should initialize SDK with plugin", async () => {
    const context = await initializeSDKTest(config);
    
    expect(context.client).toBeDefined();
    expect(context.server).toBeDefined();
    expect(context.sessionId).toBeDefined();
    expect(typeof context.sessionId).toBe("string");
    expect(context.sessionId.length).toBeGreaterThan(0);
    
    context.server.close();
  });
  
  test("should create unique session IDs", async () => {
    const context1 = await initializeSDKTest(config);
    const context2 = await initializeSDKTest(config);
    
    expect(context1.sessionId).not.toBe(context2.sessionId);
    
    context1.server.close();
    context2.server.close();
  });
  
  test("should add skill permission to config file", async () => {
    const context = await initializeSDKTest(config);
    
    const configPath = join(testProject.directory, ".opencode", "opencode.json");
    const content = await readFile(configPath, "utf-8");
    const configObj = JSON.parse(content);
    
    expect(configObj.permission).toBeDefined();
    expect(configObj.permission.skill).toBeDefined();
    expect(configObj.permission.skill.intellisearch).toBe("allow");
    
    context.server.close();
  });
});
