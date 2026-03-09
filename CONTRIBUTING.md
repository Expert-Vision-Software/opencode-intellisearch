# Contributing to intellisearch

Thank you for your interest in contributing to intellisearch!

## Getting Started

### Prerequisites

- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) (required)
- OpenCode installed and configured

### Setup

```bash
# Fork and clone
git clone https://github.com/expert-vision-software/opencode-intellisearch.git
cd opencode-intellisearch

# Install dependencies
bun install
```

## Project Structure

```
opencode-intellisearch/
├── assets/                      # Published directly
│   ├── skills/intellisearch/    # Skill definition
│   └── commands/                # Command definitions
├── plugin.ts                    # OpenCode plugin entry (~45 lines)
├── index.ts                     # Plugin re-export
├── package.json                 # Bun-native configuration
├── tsconfig.json                # Bun TypeScript config
├── tests/
│   ├── unit/                    # Unit tests
│   └── e2e/                     # E2E tests (SDK-based)
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── INSTALLATION.md
├── AGENTS.md                    # Agent instructions (XML-tagged)
└── LICENSE
```

## Making Changes

### Skill Development

Skills are defined in `assets/skills/intellisearch/SKILL.md`.

**Frontmatter Requirements:**
- `name`: 1-64 characters, lowercase alphanumeric with hyphens
- `description`: 1-1024 characters, third-person perspective
- `license`: MIT
- `compatibility`: "opencode"

### Command Development

Commands are defined in `assets/commands/search-intelligently.md`.

**Frontmatter:**
```yaml
---
description: Command description
agent: general
subtask: true
---
```

### Plugin Development

The plugin (`plugin.ts`) handles:
- Copying assets from `assets/` to target `.opencode/`
- Version marker (`.version`) to prevent duplicate installs
- Automatic skill permission configuration

## Testing

### Type Checking

```bash
bun run check
```

### Unit Tests

```bash
bun test
bun run test:watch  # Watch mode
```

### E2E Tests

E2E tests validate the complete workflow using the OpenCode SDK with real LLM calls.

#### Basic Usage

```bash
# Quick test (explicit mode, 1 run)
bun test:e2e

# Test implicit mode
bun test:e2e --mode implicit

# Test both modes sequentially
bun test:e2e --mode both

# Multiple runs for consistency analysis
bun test:e2e --runs 3

# Multiple runs on both modes
bun test:e2e --mode both --runs 3
```

#### CLI Options

| Flag                     | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `-m, --mode <mode>`      | Test mode: `explicit`, `implicit`, or `both` (default: explicit) |
| `-r, --runs <n>`         | Number of test runs per mode (default: 1)            |
| `--model <model>`        | Override model (default: pre-configured)             |
| `--validate`             | Run quick validation test                            |
| `--verbose`              | Show detailed output with breakdown and violations   |
| `-b, --set-baseline`     | Save current results as baseline                     |
| `-a, --analyze <dir>`    | Re-analyze existing results directory                |
| `-h, --help`             | Show help                                            |

#### Examples

```bash
# Quick validation (simple query, fast check)
bun test:e2e --validate

# Standard test with baseline comparison
bun test:e2e --mode implicit --runs 3

# Detailed output with all metrics
bun test:e2e --verbose --runs 3

# Set new baseline after improvements
bun test:e2e --set-baseline

# Set baseline from specific results
bun test:e2e --set-baseline tests/e2e/results/implicit-260309-060729

# Re-analyze previous run
bun test:e2e --analyze tests/e2e/results/explicit-260309-055419 --verbose
```

#### Output Formats

**Default Output:**
```
=== Results ===
Metric          | Baseline | Current | Delta
--------------------------------------------------
Skill Loaded    | ✅ yes   | ✅ yes  | =
Workflow Score  | 0.75     | 0.68    | -0.07 ↓
Tokens          | 27047    | 32846   | +5799 ↑
Solutions       | 5        | 5       | =
Search Success  | 100%     | 100%    | =

Breakdown: skill: 0.30, deepWiki: 0.25, noWebfetch: 0.13
Violations: 1 (excessive_post_deepwiki_search: -0.08)
Search Depth: 3 repos examined | Duration: 2:45

Pass Criteria:
  ✅ Skill loaded: yes
  ✅ Workflow score: 0.68

Status: ✅ PASS
```

**Verbose Output (`--verbose`):**
```
=== Results ===

--- Workflow Compliance ---
  Skill Loaded:      ✅ yes (implicit)
  Workflow Score:    0.68
  Breakdown:
    skillLoaded:        +0.30
    ghCli:               +0.00
    deepWiki:            +0.25
    noWebfetchOnGithub:  +0.13

--- Solutions ---
  Found: 5
    - amark
    - levelgraph
    - quadstorejs
    - graphology
    - dxnn

--- Violations ---
  ⚠️ excessive_post_deepwiki_search (-0.08)
      4 search tool calls after last DeepWiki

--- Enhanced Metrics ---
  Tool Diversity:    33%
  Search Depth:      3 repos examined
  Token Efficiency:  10,755 tokens/solution
  Duration:          2:45

--- Run Summary ---
  Run 1: score 0.75, 3 solutions
  Run 2: score 0.75, 3 solutions
  Run 3: score 0.55, 3 solutions, 1 violation

--- Baseline Comparison ---
  Workflow Score     0.68 (baseline: 0.75) -0.07 ↓
  Tokens             32846 (baseline: 27047) +5799 ↑
  Solutions          5 (baseline: 5) =
  Search Success     1.00 (baseline: 1.00) =
```

#### Workflow Violations

Violations detect workflow quality issues and scale based on severity:

| Rule                           | Base Impact | Max Impact | Trigger                                         |
| ------------------------------ | ----------- | ---------- | ----------------------------------------------- |
| `no_webfetch_on_github`          | -0.20       | -0.20      | Used webfetch on github.com instead of DeepWiki |
| `must_use_deepwiki`              | -0.25       | -0.25      | Skill loaded but DeepWiki not used              |
| `explicit_skill_required`        | -0.30       | -0.30      | Skill failed to load in explicit mode           |
| `stuck_on_google_search`         | -0.15       | -0.15      | Multiple google_search calls without skill      |
| `delayed_deepwiki_start`         | -0.10       | -0.25      | > 2 non-read steps before first DeepWiki call   |
| `insufficient_deepwiki_usage`    | -0.10       | -0.20      | < 2 DeepWiki calls when skill loaded            |
| `excessive_post_deepwiki_search` | -0.08       | -0.20      | > 3 search tools after last DeepWiki call       |

#### Pass Criteria

| Criterion              | Requirement                    |
| ---------------------- | ------------------------------ |
| Skill loaded           | `true`                         |
| Workflow score         | ≥ 0.70 (configurable baseline) |
| No critical regression | Token spike, score drop, solutions loss |

#### Baselines

Baselines are stored in `tests/e2e/baseline/{explicit,implicit}.json`:

```bash
# Create initial baseline
bun test:e2e --runs 3 --set-baseline

# Update baseline after improvements
bun test:e2e --mode implicit --set-baseline

# Set baseline from existing results
bun test:e2e --set-baseline tests/e2e/results/implicit-260309-060729
```

#### Results Location

Results are saved to `tests/e2e/results/{mode}-{YYMMDD-HHmmss}/`:

```
tests/e2e/results/implicit-260309-060729/
├── consistency-report.json    # Full report with all metrics
├── token-metrics.json         # Token usage breakdown
├── run-1-1773051087396/       # Per-run details
│   └── run-metrics.json
├── run-2-1773051436343/
│   └── run-metrics.json
└── run-3-1773051633361/
    └── run-metrics.json
```

### Local Testing

```bash
# Link package
bun link

# In test project
bun link opencode-intellisearch --cwd ~/.cache/opencode/node_modules/
```

Or use path-based plugin loading:
```json
{
  "plugins": ["C:/dev/projects/github/opencode-intellisearch"]
}
```

## Submitting Changes

### Branch Naming

All branches must start with `ai-`:
```bash
git checkout -b ai-your-feature-name
```

### Commit Messages

Follow conventional commits:
```
feat: add new feature
fix: correct bug
docs: update documentation
refactor: restructure code
```

### Before Committing

1. Run `bun run check` - ensure no TypeScript errors
2. Run tests: `bun test` and `bun test:e2e`
3. Update CHANGELOG.md

### Pull Request

1. Push to your fork
2. Create PR on GitHub
3. Ensure CI passes
4. Address review feedback

## Code Style

### TypeScript

- Use named functions (not arrow functions) where no `this` scoping issues
- Target: ESNext, Module: ESNext, Strict mode
- Explicit return types on exported functions
- Prefer async/await over callbacks
- Import with `.ts` extensions (Bun-native)

### Imports

```typescript
// Node built-ins (node: prefix)
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

// External dependencies
import type { Plugin } from "@opencode-ai/plugin";

// Internal modules (.ts extension)
import { default as plugin } from "./plugin.ts";
```

### Naming

- Functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Interfaces: `PascalCase`
- Files: `kebab-case.ts`

## Reporting Issues

### Bug Reports

Include:
- OS and version
- OpenCode version
- Bun version
- Steps to reproduce
- Expected vs actual behavior
- Error messages and logs

### Feature Requests

Include:
- Problem statement
- Proposed solution
- Use cases and examples

## Getting Help

- [GitHub Issues](https://github.com/expert-vision-software/opencode-intellisearch/issues)
- [OpenCode Documentation](https://opencode.ai/docs)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
