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
└── tests/            # Bun test suite
    ├── unit/         # Unit tests
    └── integration/  # Integration tests
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

### E2E Test Runner (TypeScript)

E2E tests validate the IntelliSearch plugin's skill loading and search capabilities across different skill loading modes

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
bun test:e2e --model "minimax/MiniMax-M2.5"
```

**Skill Modes**
| Mode       | Description                                       | Use Case                               |
| ---------- | ------------------------------------------------- | --------------------------------------- |
| `explicit` | Uses `/search-intelligently` command (default) | Recommended for reliable testing           |
| `implicit` | LLM autonomously decides to use skill                 | Testing LLM behavior/reliability        |
| `both`      | Runs both modes sequentially                        | Comprehensive testing                     |

**Test Results**
Results are saved to `tests/e2e/results/` with naming pattern:
```
{mode}-{YYMMDD-HHmmss}/

Example: `explicit-260306-143205/`
```
├── run-1-143205/
│   ├── output.json         # Raw opencode output
│   ├── token-metrics.json      # Aggregated token data
│   └── consistency-report.json # Full analysis
```

**Baseline Management**
Baselines are committed to `tests/e2e/baseline/` as JSON files:
- `explicit.json` - Baseline for explicit mode
- `implicit.json` - Baseline for implicit mode

```bash
# Save current results as baseline
bun test:e2e --set-baseline

# Save specific results as baseline
bun test:e2e --set-baseline results/explicit-260306-143205
```

**Re-analyzing Results**
Regenerate reports from existing results without re-running
```bash
bun test:e2e --analyze results/explicit-260306-143205
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

### Automated Testing (For Agents)

When asked to run E2E tests automatically

```bash
# Run explicit mode test (default)
bun test:e2e

# Run both modes and compare results
bun test:e2e --mode both

# Run multiple tests and compare metrics
bun test:e2e --runs 3
```

**Live Feedback**
During test execution, tool usage is streamed to console in real-time
```
→ 14:32:05 skill: intellisearch
  → 14:32:08 bash: gh search repos "graph database javascript"
  → 14:32:12 DeepWiki_ask_question: levelgraph/levelgraph
  → 14:32:18 step_finish: 2,145 tokens (1,855 in, 290 out)
```

**Result Files**
All result files include git metadata:
- `commitHash`: Current HEAD commit
- `branch`: Current branch name
- `version`: From package.json
- `mainCommitHash`: origin/main (or origin/master)

**Example output.json**
```json
{
  "generated": "2026-03-06T14:32:05.000Z",
  "runCount": 1,
  "averages": {
    "inputTokens": 1855,
    "outputTokens": 290,
    "totalTokens": 2145
  },
  "meta": {
    "commitHash": "abc1234",
    "branch": "ai-e2e-testing",
    "version": "0.3.4",
    "mainCommitHash": "def5678"
  },
  "runs": [...]
}
```

### Manual Workflow

1. Run test before commit to get quick feedback
2. If pass, set baseline
3. If fail, investigate results
4. Fix issues and re-run
5. Commit changes

---

### Cleanup Phase
```bash
# 1. Remove plugin from opencode.json
# 2. Clean test project assets
rm -rf C:\dev\projects\playground\aigpt\test-websearch\.opencode\skills\intellisearch
rm C:\dev\projects\playground\aigpt\test-websearch\.opencode\commands\search-intelligently.md
# Or simply: rm -rf .opencode/
```

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
