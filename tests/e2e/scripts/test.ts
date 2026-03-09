import { resolve, basename, join } from "node:path";
import { stat, readdir } from "node:fs/promises";
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
  showResults: string | null;
  validate: boolean;
  verbose: boolean;
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
    showResults: null,
    validate: false,
    verbose: false,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--validate") {
      result.validate = true;
    } else if (arg === "--verbose") {
      result.verbose = true;
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
    } else if (arg === "--show-results" || arg === "-s") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        result.showResults = next;
        i++;
      } else {
        result.showResults = "latest";
      }
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
                           With --show-results: filter by mode when finding latest
  -r, --runs <n>           Number of test runs (default: 1)
  --model <model>          Model to use (default: pre-configured)
  --validate               Run validation test (quick check)
  --verbose                Show detailed output with breakdown, violations, baseline comparison
  -b, --set-baseline       Save results as new baseline
                           Optionally provide path to existing results dir
  -a, --analyze <dir>      Re-analyze existing results
  -s, --show-results       Show results from latest run or specified directory
                           Without arg: shows latest results
                           With dir: shows results from that directory
                           Use --mode to filter by mode when finding latest
  -h, --help               Show this help

Examples:
  bun test:e2e --validate                      # Quick validation test
  bun test:e2e                                 # Quick test (explicit mode)
  bun test:e2e --mode implicit                  # Test implicit mode
  bun test:e2e --mode both                      # Test both modes
  bun test:e2e --runs 3                         # Multiple runs
  bun test:e2e --verbose                        # Detailed output
  bun test:e2e --set-baseline                   # Save current as baseline
  bun test:e2e --set-baseline tests/e2e/results/explicit-260306-143205
  bun test:e2e --analyze tests/e2e/results/explicit-260306-143205
  bun test:e2e --show-results                   # Show latest results (any mode)
  bun test:e2e -s --mode implicit               # Show latest implicit results
  bun test:e2e --show-results --verbose         # Show latest with details
  bun test:e2e -s tests/e2e/results/implicit-260309-060729
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

async function findLatestResultsDir(projectDir: string, mode?: SkillMode): Promise<string | null> {
  const resultsDir = join(projectDir, "tests/e2e/results");
  
  if (!(await dirExists(resultsDir))) {
    return null;
  }
  
  const entries = await readdir(resultsDir, { withFileTypes: true });
  const dirs = entries
    .filter(e => {
      if (!e.isDirectory()) return false;
      if (mode) {
        return e.name.startsWith(`${mode}-`);
      }
      return e.name.startsWith("explicit-") || e.name.startsWith("implicit-");
    })
    .map(e => e.name)
    .sort()
    .reverse();
  
  return dirs.length > 0 ? join(resultsDir, dirs[0]) : null;
}

async function showResults(
  resultsPath: string | null, 
  projectDir: string, 
  verbose: boolean = false,
  mode?: SkillMode
): Promise<boolean> {
  let resolvedPath: string;
  
  if (resultsPath === "latest" || resultsPath === null) {
    const latestDir = await findLatestResultsDir(projectDir, mode);
    if (!latestDir) {
      const modeHint = mode ? ` for ${mode} mode` : "";
      printError(`No results directories found in tests/e2e/results/${modeHint}`);
      return false;
    }
    resolvedPath = latestDir;
    console.log(`Showing latest ${mode ? mode + " " : ""}results: ${basename(resolvedPath)}\n`);
  } else {
    resolvedPath = resolve(projectDir, resultsPath);
    
    if (!(await dirExists(resolvedPath))) {
      printError(`Results directory not found: ${resolvedPath}`);
      return false;
    }
    console.log(`Showing results from: ${basename(resolvedPath)}\n`);
  }
  
  const dirName = basename(resolvedPath);
  const modeMatch = dirName.match(/^(explicit|implicit)-/);
  const resultsMode: SkillMode = modeMatch ? (modeMatch[1] as SkillMode) : "explicit";
  
  const metrics = await loadResultsDir(resolvedPath);
  
  if (!metrics) {
    printError("Failed to load results");
    return false;
  }
  
  const baseline = await loadBaseline(projectDir, resultsMode);
  const result = evaluateResult(metrics, baseline);
  
  printResult(result, verbose);
  
  return result.passed;
}

async function runSingleMode(
  mode: SkillMode, 
  config: TestConfig, 
  setBaseline: boolean,
  verbose: boolean = false
): Promise<{ passed: boolean; resultsDir: string }> {
  const testConfig: TestConfig = { ...config, mode };
  
  printHeader(mode, testConfig.runs ?? 1, testConfig.model);
  
  const { metrics, resultsDir } = await runTests(testConfig);
  
  if (setBaseline) {
    await saveBaseline(
      config.projectDir,
      mode,
      metrics,
      { runs: testConfig.runs ?? 1, model: config.model, queryFile: config.queryFile }
    );
    printBaselineSaved(mode);
  }
  
  const baseline = await loadBaseline(config.projectDir, mode);
  const result = evaluateResult(metrics, baseline);
  
  printResult(result, verbose);
  printResultsPath(resultsDir);
  
  return { passed: result.passed, resultsDir };
}

async function analyzeResults(resultsPath: string, projectDir: string, verbose: boolean = false): Promise<boolean> {
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
  
  printResult(result, verbose);
  
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
  
  if (args.showResults !== null) {
    const modeFilter = args.mode === "both" ? undefined : args.mode;
    const passed = await showResults(args.showResults, projectDir, args.verbose, modeFilter);
    process.exit(passed ? 0 : 1);
    return;
  }
  
  const config = getDefaultConfig(projectDir);
  
  config.runs = args.runs;
  config.model = args.model;
  
  try {
    if (args.analyze) {
      const passed = await analyzeResults(args.analyze, projectDir, args.verbose);
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
      const explicitResult = await runSingleMode("explicit", config, args.setBaseline, args.verbose);
      allPassed = explicitResult.passed && allPassed;
      
      console.log("");
      
      const implicitResult = await runSingleMode("implicit", config, args.setBaseline, args.verbose);
      allPassed = implicitResult.passed && allPassed;
    } else {
      const result = await runSingleMode(args.mode, config, args.setBaseline, args.verbose);
      allPassed = result.passed;
    }
    
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    printError((error as Error).message);
    process.exit(2);
  }
}

main();
