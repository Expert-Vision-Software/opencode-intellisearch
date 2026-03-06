import { resolve } from "node:path";
import type { SkillMode, TestConfig } from "./types.ts";
import { runTests, getDefaultConfig } from "./runner.ts";
import { loadBaseline, saveBaseline, evaluateResult } from "./baseline.ts";
import { printHeader, printResult, printError, printInfo, printBaselineSaved } from "./report.ts";

interface CliArgs {
  mode: SkillMode | "both";
  runs: number;
  model: string | null;
  setBaseline: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    mode: "explicit",
    runs: 1,
    model: null,
    setBaseline: false,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--mode" || arg === "-m") {
      const value = args[++i];
      if (value === "explicit" || value === "implicit" || value === "both") {
        result.mode = value;
      } else {
        throw new Error(`Invalid mode: ${value}. Use: explicit, implicit, or both`);
      }
    } else if (arg === "--runs" || arg === "-r") {
      result.runs = parseInt(args[++i], 10);
      if (isNaN(result.runs) || result.runs < 1) {
        throw new Error("Runs must be a positive integer");
      }
    } else if (arg === "--model") {
      result.model = args[++i] ?? null;
    } else if (arg === "--set-baseline" || arg === "-b") {
      result.setBaseline = true;
    }
  }
  
  return result;
}

function printHelp(): void {
  console.log(`
E2E Test Runner for IntelliSearch Plugin

Usage: bun test:e2e [options]

Options:
  -m, --mode <mode>      Test mode: explicit, implicit, or both (default: explicit)
  -r, --runs <n>         Number of test runs (default: 1)
  --model <model>        Model to use (default: pre-configured)
  -b, --set-baseline     Save results as new baseline
  -h, --help             Show this help

Examples:
  bun test:e2e                      # Quick test, explicit mode
  bun test:e2e --mode implicit      # Test implicit mode
  bun test:e2e --mode both          # Test both modes
  bun test:e2e --runs 3             # Run 3 times for better metrics
  bun test:e2e --set-baseline       # Save current results as baseline
`);
}

async function runSingleMode(
  mode: SkillMode, 
  config: TestConfig, 
  setBaseline: boolean
): Promise<boolean> {
  printHeader(mode, config.runs, config.model);
  
  const testConfig: TestConfig = { ...config, mode };
  
  const metrics = await runTests(testConfig);
  const baseline = await loadBaseline(config.projectDir, mode);
  const result = evaluateResult(metrics, baseline);
  
  if (setBaseline) {
    await saveBaseline(config.projectDir, mode, metrics, {
      runs: config.runs,
      model: config.model,
      queryFile: config.queryFile
    });
    printBaselineSaved(mode);
    return true;
  }
  
  printResult(result);
  return result.passed;
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  
  const projectDir = resolve(import.meta.dirname, "..", "..", "..");
  const config: TestConfig = {
    ...getDefaultConfig(projectDir),
    runs: args.runs,
    model: args.model
  };
  
  try {
    let allPassed = true;
    
    if (args.mode === "both") {
      allPassed = await runSingleMode("explicit", config, args.setBaseline) && allPassed;
      console.log("");
      allPassed = await runSingleMode("implicit", config, args.setBaseline) && allPassed;
    } else {
      allPassed = await runSingleMode(args.mode, config, args.setBaseline);
    }
    
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    printError((error as Error).message);
    process.exit(1);
  }
}

main();
