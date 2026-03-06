# AGENTS.md - OpenCode Extension Package Template

Guidelines for agentic coding agents working on this OpenCode extension repository.

## Development Commands

```bash
# TypeScript type checking (no build step - Bun runs TS natively)
bun run check

# Run tests
bun test
bun run test:watch  # Watch mode

# Local development (link to OpenCode plugin cache)
bun link
bun link opencode-intellisearch --cwd $home/.cache/opencode/node_modules/
# Alternative: ln -s $(pwd) ~/.cache/opencode/node_modules/opencode-intellisearch

# Unlink when done
bun unlink
```

## Project Structure

```
├── assets/           # Skills and commands (published directly)
│   ├── skills/
│   │   └── intellisearch/
│   │       └── SKILL.md
│   └── commands/
│       └── search-intelligently.md
├── plugin.ts         # OpenCode plugin with config hook (~45 lines)
├── index.ts          # Plugin re-export
├── package.json      # Bun-native configuration
├── tsconfig.json     # Bun-optimized TypeScript config
└── tests/            # Test suite
    ├── unit/         # Unit tests
    └── e2e/          # E2E tests (SDK-based)
        ├── scripts/
        │   ├── runner.ts          # Main orchestration
        │   ├── sdk-runner.ts      # SDK initialization
        │   ├── event-monitor.ts   # SSE monitoring
        │   ├── test-project.ts    # Test project setup
        │   └── __tests__/         # E2E unit tests
        ├── baseline/              # Baseline JSON files
        ├── results/               # Test results
        └── test-queries/          # Test query files
```

## Code Style Guidelines

### TypeScript
- Use **named functions** (not arrow functions) where no `this` scoping issues
- Target: ESNext, Module: ESNext
- Strict mode enabled with all strict flags
- Always use explicit return types on exported functions
- Prefer `async/await` over callbacks
- **Bun-native**: Import with `.ts` extensions, no compilation needed

### Imports
```typescript
// Node built-ins first (use node: prefix)
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

// External dependencies
import type { Plugin } from "@opencode-ai/plugin";

// Internal modules (include .ts extension for Bun)
import { default as plugin } from "./plugin.ts";
```

### Naming Conventions
- Functions: `camelCase` (e.g., `copyDirectory`, `installAssets`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `VERSION`)
- Interfaces: `PascalCase` (e.g., `PluginContext`)
- Files: `kebab-case.ts`

### Error Handling
```typescript
try {
  await copyDir(src, dest);
} catch (error) {
  await client.app.log({
    service: "intellisearch",
    level: "error",
    message: `Failed to copy: ${(error as Error).message}`
  });
}
```

### Path Handling
Always use `path.join()` for cross-platform compatibility:
```typescript
const targetDir = path.join(directory, ".opencode");
const assetsDir = path.join(import.meta.dirname, "assets");
```

## Development Workflow

### Branch Naming
All work branches must start with `ai-`:
```bash
git checkout -b ai-feature-name
git checkout -b ai-fix-bug-description
```

### Commit Messages
Follow conventional commits:
```
feat: add bun-native TypeScript support
fix: correct asset path resolution
refactor: remove CLI and build scripts
docs: update installation for bun-only
```

### Before Committing
1. Run `bun run check` - ensure no TypeScript errors
2. Verify assets are in `assets/skills/` and `assets/commands/`
3. Test locally using bun link workflow

### E2E Test Runner (SDK-Based)

E2E tests validate the IntelliSearch plugin's skill loading and search capabilities using the OpenCode SDK.

**Architecture**
- Uses `@opencode-ai/sdk` for programmatic control
- Creates isolated test project in temp directory
- Monitors SSE events for real-time tracking
- No subprocess spawning - direct SDK integration

**Test Commands**
```bash
# Quick test (explicit mode, 1 run - default)
bun test:e2e

# Test implicit mode
bun test:e2e --mode implicit

# Test both modes sequentially
bun test:e2e --mode both

# Multiple runs for better metrics
bun test:e2e --runs 3

# Specify model
bun test:e2e --model "anthropic/claude-3-5-sonnet-20241022"

# Unit tests for SDK runner
bun test tests/e2e/scripts/__tests__/
```

**Skill Modes**
| Mode       | Description                                       | Use Case                               |
| ---------- | ------------------------------------------------- | --------------------------------------- |
| `explicit` | Uses `/search-intelligently` command (default) | Recommended for reliable testing           |
| `implicit` | LLM autonomously decides to use skill                 | Testing LLM behavior/reliability        |
| `both`      | Runs both modes sequentially                        | Comprehensive testing                     |

**Live Output Format**
```
→ 11:09:14 [0] skill: intellisearch
→ 11:09:14 [15,249] step_finish: 15,249 tokens (15,086 in, 163 out)
→ 11:09:22 [15,249] bash: gh search "graph database javascript browser"
→ 11:09:23 [18,264] step_finish: 3,015 tokens (2,843 in, 172 out)
  ✓ Skill loaded [15,249]
...
  Session completed [35,921]
```
The `[X,XXX]` number in yellow is cumulative token count.

**Test Results**
Results saved to `tests/e2e/results/` with naming pattern `{mode}-{YYMMDD-HHmmss}/`:
```
explicit-260306-110914/
├── run-1-110914/
│   └── run-metrics.json     # Individual run data
├── token-metrics.json       # Aggregated token data
└── consistency-report.json  # Full analysis
```

**Baseline Management**
Baselines stored in `tests/e2e/baseline/`:
- `explicit.json` - Baseline for explicit mode
- `implicit.json` - Baseline for implicit mode

```bash
# Save current results as baseline
bun test:e2e --set-baseline

# Save specific results as baseline
bun test:e2e --set-baseline results/explicit-260306-110914
```

**Pass Criteria**
Tests pass if ALL conditions are met:
1. **Skill loaded**: `true` (explicit mode) or `true` (implicit mode with skill invocation)
2. **Workflow score**: ≥ 0.70 (threshold)
3. **No regression**: Token usage stable, solutions found, search success maintained

**Exit Codes**
- `0`: All tests passed
- `1`: One or more tests failed
- `2`: Error occurred

---

### E2E Test Implementation Details

**Key Files**
```
tests/e2e/scripts/
├── runner.ts          # Main test orchestration (~400 lines)
├── sdk-runner.ts      # SDK initialization + port finder
├── event-monitor.ts   # SSE event monitoring
├── test-project.ts    # Test project directory setup
├── test.ts            # CLI entry point
├── types.ts           # TypeScript interfaces
├── baseline.ts        # Baseline comparison
├── report.ts          # Console output formatting
└── __tests__/         # Unit tests
    └── sdk-runner.test.ts
```

**Test Project Setup**
- Creates temp directory: `%TEMP%\opencode-e2e-{timestamp}`
- Generates `.opencode/opencode.json` with plugin reference
- Uses `file://` prefix for local plugin path
- Symlinks (or copies) test-queries directory
- Cleanup on completion or process exit

**Event Monitoring**
- Subscribes to SSE via `client.event.subscribe()`
- Detects session completion via `session.status` event with `status.type === "idle"`
- Tracks tool calls and token usage from `step-finish` parts
- Early failure detection: 5 tool calls without skill in explicit mode

**Before Running E2E Tests**
1. Ensure `bun run check` passes
2. Clear any processes on ports 4096-5096 if tests hang
3. Run unit tests first: `bun test tests/e2e/scripts/__tests__/`

---

### Automated Testing (For Agents)

When asked to run E2E tests automatically:

```bash
# Run explicit mode test (default)
bun test:e2e

# Run both modes and compare results
bun test:e2e --mode both

# Run multiple tests and compare metrics
bun test:e2e --runs 3
```

**Result Files Include Git Metadata**
- `commitHash`: Current HEAD commit
- `branch`: Current branch name
- `version`: From package.json
- `mainCommitHash`: origin/main (or origin/master)

### Manual Workflow

1. Run test before commit to get quick feedback
2. If pass, set baseline with `bun test:e2e --set-baseline`
3. If fail, investigate results in `tests/e2e/results/`
4. Fix issues and re-run
5. Commit changes

## Helpful Tools

### Web Fetching
Use `webfetch` to retrieve web content for searches:

```typescript
// Fetch documentation pages
webfetch({ 
  url: "https://opencode.ai/docs/plugins/",
  format: "markdown",
  timeout: 30 
})
```

### DeepWiki
Query GitHub repository documentation:
```typescript
deepWiki_read_wiki_structure({ repoName: "anomalyco/opencode" })
deepWiki_read_wiki_contents({ repoName: "anomalyco/opencode" })
deepWiki_ask_question({ 
  repoName: "anomalyco/opencode", 
  question: "Where does OpenCode load npm plugins from?" 
})
```

### Simplified Workflow
1. Search with `webfetch` for GitHub repositories (`site:github.com`)
2. Extract repository names from search results
3. Use DeepWiki tools to query repositories for answers
4. Reference: `assets/skills/intellisearch/deepwiki-tools.md`

## Package Publishing

```bash
# Version bump
npm version patch  # or minor/major

# Publish (bun only)
bun publish
```

## Key Implementation Details

### Plugin Architecture
- Plugin exports default async function returning `{ hooks: { config?: () => Promise<void> } }`
- Config hook runs once during OpenCode initialization
- Assets are copied from package `assets/` directory to project `.opencode/`
- Use version marker file (`.version`) to prevent duplicate installs
- Log progress via `client.app.log()`
- OpenCode installs npm plugins to `~/.cache/opencode/node_modules/`

### Asset Installation
Source: `assets/` (published directly in package)
→ Plugin copies to: `.opencode/skills/intellisearch/` and `.opencode/commands/search-intelligently.md`
