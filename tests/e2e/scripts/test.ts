import { resolve, basename, join } from "node:path";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { SkillMode, TestConfig } from "./types.ts";
import { runTests, getDefaultConfig, loadResultsDir } from "./runner.ts";
import { loadBaseline, saveBaseline, evaluateResult } from "./baseline.ts";
import { printHeader, printResult, printError, printBaselineSaved, printResultsPath } from "./report.ts";

interface CliArgs {
  mode: SkillMode | "both";
  runs: number;
  model: string | null;
  setBaseline: boolean;
  baselinePath: string | null;
  analyze: string | null;
  validate: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    mode: "explicit",
    runs: 1,
    model: null,
    setBaseline: false,
    baselinePath: null,
    analyze: null,
    validate: false,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--validate" || arg === "-v") {
      result.validate = true;
    } else if (arg === "--mode" || arg === "-m") {
      const value = args[++i];
      if (value === "explicit" || value === "implicit" || value === "both") {
        result.mode = value;
      } else {
        throw new Error(`Invalid mode: ${value}. Use: explicit, implicit, or both`);
      }
    } else if (arg === "--runs" || arg === "-r") {
      result.runs = parseInt(args[++i] ?? "1", 10);
      if (isNaN(result.runs) || result.runs < 1) {
        throw new Error("Runs must be a positive integer");
      }
    } else if (arg === "--model") {
      result.model = args[++i] ?? null;
    } else if (arg === "--set-baseline" || arg === "-b") {
      result.setBaseline = true;
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        result.baselinePath = next;
        i++;
      }
    } else if (arg === "--analyze" || arg === "-a") {
      result.analyze = args[++i] ?? null;
    }
  }
  
  return result;
}

function printHelp(): void {
  console.log(`
E2E Test Runner for IntelliSearch Plugin

Usage: bun test:e2e [options]

Options:
  -m, --mode <mode>        Test mode: explicit, implicit, or both (default: explicit)
  -r, --runs <n>           Number of test runs (default: 1)
  --model <model>          Model to use (default: pre-configured)
  -v, --validate           Run validation test (quick check)
  -b, --set-baseline       Save results as new baseline
                           Optionally provide path to existing results dir
  -a, --analyze <dir>      Re-analyze existing results
  -h, --help               Show this help

Examples:
  bun test:e2e --validate                      # Quick validation test
  bun test:e2e                                 # Quick test (explicit mode)
  bun test:e2e --mode implicit                  # Test implicit mode
  bun test:e2e --mode both                      # Test both modes
  bun test:e2e --runs 3                         # Multiple runs
  bun test:e2e --set-baseline                   # Save current as baseline
  bun test:e2e --set-baseline results/explicit-260306-143205
  bun test:e2e --analyze results/explicit-260306-143205
`);
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function runSingleMode(
  mode: SkillMode, 
  config: TestConfig, 
  setBaseline: boolean
): Promise<{ passed: boolean; resultsDir: string }> {
  const testConfig: TestConfig = { ...config, mode };
  
  printHeader(mode, testConfig.runs, testConfig.model);
  
  const { metrics, resultsDir } = await runTests(testConfig);
  
  if (setBaseline) {
    await saveBaseline(
      config.projectDir,
      mode,
      metrics,
      { runs: config.runs, model: config.model, queryFile: config.queryFile }
    );
    printBaselineSaved(mode);
  }
  
  const baseline = await loadBaseline(config.projectDir, mode);
  const result = evaluateResult(metrics, baseline);
  
  printResult(result);
  printResultsPath(resultsDir);
  
  return { passed: result.passed, resultsDir };
}

async function analyzeResults(resultsPath: string, projectDir: string): Promise<boolean> {
  const resolvedPath = resolve(projectDir, resultsPath);
  
  if (!(await dirExists(resolvedPath))) {
    printError(`Results directory not found: ${resolvedPath}`);
    return false;
  }
  
  const dirName = basename(resolvedPath);
  const modeMatch = dirName.match(/^(explicit|implicit)-/);
  const mode: SkillMode = modeMatch ? (modeMatch[1] as SkillMode) : "explicit";
  
  console.log(`Re-analyzing results from: ${resolvedPath}`);
  
  const metrics = await loadResultsDir(resolvedPath);
  
  if (!metrics) {
    printError("Failed to load results");
    return false;
  }
  
  const baseline = await loadBaseline(projectDir, mode);
  const result = evaluateResult(metrics, baseline);
  
  printResult(result);
  
  return result.passed;
}

async function setBaselineFromPath(resultsPath: string, projectDir: string): Promise<boolean> {
  const resolvedPath = resolve(projectDir, resultsPath);
  
  if (!(await dirExists(resolvedPath))) {
    printError(`Results directory not found: ${resolvedPath}`);
    return false;
  }
  
  const metrics = await loadResultsDir(resolvedPath);
  
  if (!metrics) {
    printError("Failed to load results");
    return false;
  }
  
  const dirName = basename(resolvedPath);
  const modeMatch = dirName.match(/^(explicit|implicit)-/);
  const mode: SkillMode = modeMatch ? (modeMatch[1] as SkillMode) : "explicit";
  
  await saveBaseline(
    projectDir,
    mode,
    metrics,
    { runs: metrics.runs.length, model: null, queryFile: "tests/e2e/test-queries/graph-db-search.md" }
  );
  
  printBaselineSaved(mode);
  
  return true;
}

async function runValidation(projectDir: string): Promise<boolean> {
  console.log("=== Running Validation Test ===\n");
  
  const simpleQueryPath = join(projectDir, "tests/e2e/test-queries/simple-validation.md");
  
  if (!existsSync(simpleQueryPath)) {
    await writeFile(simpleQueryPath, "What is 2 + 2? Please answer briefly.\n");
    console.log("Created simple validation query file");
  }
  
  const testConfig: TestConfig = {
    runs: 1,
    mode: "explicit",
    model: null,
    queryFile: "tests/e2e/test-queries/simple-validation.md",
    pluginSource: projectDir,
    projectDir
  };
  
  printHeader("explicit", 1, null);
  
  try {
    const { metrics } = await runTests(testConfig);
    
    console.log("\n=== Validation Results ===");
    console.log(`Skill loaded: ${metrics.skillLoaded ? '✓' : '✗'}`);
    console.log(`Load method: ${metrics.skillLoadMethod}`);
    console.log(`Workflow score: ${metrics.workflowScore.toFixed(2)}`);
    
    if (metrics.runs[0]?.earlyFailure) {
      console.log(`\nEarly failure: ${metrics.runs[0].earlyFailureReason}`);
    }
    
    const passed = metrics.skillLoaded && metrics.workflowScore >= 0.5;
    
    if (passed) {
      console.log("\n✓ Validation PASSED");
    } else {
      console.log("\n✗ Validation FAILED");
      if (!metrics.skillLoaded) {
        console.log("  - Skill did not load");
      }
      if (metrics.workflowScore < 0.5) {
        console.log("  - Workflow score too low");
      }
    }
    
    return passed;
  } catch (error) {
    console.log("\n✗ Validation FAILED with error:");
    console.log((error as Error).message);
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  
  const projectDir = process.cwd();
  
  if (args.validate) {
    const passed = await runValidation(projectDir);
    process.exit(passed ? 0 : 1);
    return;
  }
  
  const config = getDefaultConfig(projectDir);
  
  config.runs = args.runs;
  config.model = args.model;
  
  try {
    if (args.analyze) {
      const passed = await analyzeResults(args.analyze, projectDir);
      process.exit(passed ? 0 : 1);
      return;
    }
    
    if (args.setBaseline && args.baselinePath) {
      const success = await setBaselineFromPath(args.baselinePath, projectDir);
      process.exit(success ? 0 : 1);
      return;
    }
    
    let allPassed = true;
    
    if (args.mode === "both") {
      const explicitResult = await runSingleMode("explicit", config, args.setBaseline);
      allPassed = explicitResult.passed && allPassed;
      
      console.log("");
      
      const implicitResult = await runSingleMode("implicit", config, args.setBaseline);
      allPassed = implicitResult.passed && allPassed;
    } else {
      const result = await runSingleMode(args.mode, config, args.setBaseline);
      allPassed = result.passed;
    }
    
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    printError((error as Error).message);
    process.exit(2);
  }
}

main();
