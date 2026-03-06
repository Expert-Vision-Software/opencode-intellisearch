# Contributing to intellisearch

Thank you for your interest in contributing to intellisearch!

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Package Structure](#package-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Reporting Issues](#reporting-issues)

## Getting Started

### Prerequisites

- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) (required)
- OpenCode installed and configured
- Text editor (VS Code recommended)
- Bash or PowerShell terminal

## Development Setup

### 1. Fork and Clone

```bash
# Fork repository on GitHub
# Clone your fork
git clone https://github.com/expert-vision-software/opencode-intellisearch.git
cd opencode-intellisearch
```

### 2. Install Dependencies

```bash
bun install
```

## Package Structure

```
opencode-intellisearch/
├── assets/                      # Published directly
│   ├── skills/intellisearch/    # Skill definition
│   └── commands/                # Command definitions
├── plugin.ts                    # OpenCode plugin entry (~45 lines)
├── index.ts                     # Plugin re-export
├── package.json                 # Bun-native configuration
├── tsconfig.json                # Bun TypeScript config
├── tests/                       # Test suite
│   ├── unit/                    # Unit tests
│   └── e2e/                     # E2E tests (SDK-based)
│       ├── scripts/             # Test runner scripts
│       ├── baseline/            # Baseline JSON files
│       ├── results/             # Test results (gitignored)
│       └── test-queries/        # Test query files
├── README.md                    # Main documentation
├── CONTRIBUTING.md              # This file
├── CHANGELOG.md                 # Version history
└── LICENSE                      # MIT License
```

## Making Changes

### Skill Development

Skills are defined in `assets/skills/intellisearch/SKILL.md`.

**SKILL.md Structure:**

```markdown
---
name: skill-name
description: Clear description of when to use this skill
license: MIT
compatibility: opencode
metadata:
  audience: agents
  topic: skill-topic
---

## Content
- Skill purpose and capabilities
- When to use
- Quick examples
```

**Frontmatter Requirements:**
- `name`: 1-64 characters, lowercase alphanumeric with hyphens
- `description`: 1-1024 characters, third-person perspective
- `license`: License type
- `compatibility`: "opencode"
- `metadata`: String-to-string map for categorization

**Best Practices:**
- Use gerund form for skill names (e.g., "web-searching")
- Write descriptions in third person
- Keep primary content concise (~150 tokens)
- Use `references/` directory for detailed information
- Follow progressive disclosure pattern

### Command Development

Commands are defined in `assets/commands/search-intelligently.md`.

**Command Structure:**

```markdown
---
description: Command description for TUI list
agent: agent-name
model: anthropic/claude-3-5-sonnet-20241022
temperature: 0.2
---

Command template that becomes the agent prompt.
Use $ARGUMENTS for user input.
```

**Best Practices:**
- Keep temperature low (0.1-0.3) for deterministic results
- Use clear, descriptive frontmatter
- Provide examples in command template
- Handle edge cases in template

### Plugin Development

The plugin is located at `plugin.ts`.

**Plugin Structure:**

```typescript
import type { Plugin } from "@opencode-ai/plugin";

const plugin: Plugin = async ({ directory, client }) => ({
  config: async () => {
    // Installation logic here
  },
});

export default plugin;
```

**Key Points:**
- Uses `import.meta.dirname` for package root
- Copies assets from `assets/` to target `.opencode/`
- Uses version marker (`.version`) to prevent duplicate installs
- Returns early if version marker matches current version

## Testing

### Type Checking

```bash
bun run check
```

### Unit Tests

```bash
# Run all unit tests
bun test

# Run with watch mode
bun run test:watch
```

### E2E Tests

The plugin includes comprehensive E2E tests that validate skill loading and search capabilities using the OpenCode SDK.

**Quick Test**
```bash
bun test:e2e
```

**Test Commands**
```bash
# Explicit mode (default) - uses /search-intelligently command
bun test:e2e

# Implicit mode - LLM decides to use skill autonomously
bun test:e2e --mode implicit

# Both modes sequentially
bun test:e2e --mode both

# Multiple runs for better metrics
bun test:e2e --runs 3

# Specify model
bun test:e2e --model "anthropic/claude-3-5-sonnet-20241022"
```

**Live Output**
During execution, tool usage is streamed in real-time with cumulative token counts:
```
→ 11:09:14 [0] skill: intellisearch
→ 11:09:14 [15,249] step_finish: 15,249 tokens (15,086 in, 163 out)
→ 11:09:22 [15,249] bash: gh search "graph database javascript browser"
→ 11:09:23 [18,264] step_finish: 3,015 tokens (2,843 in, 172 out)
  ✓ Skill loaded [15,249]
...
  Session completed [35,921]
```

**Skill Modes**
| Mode       | Description                                       | Use Case                               |
| ---------- | ------------------------------------------------- | --------------------------------------- |
| `explicit` | Uses `/search-intelligently` command (default) | Recommended for reliable testing           |
| `implicit` | LLM autonomously decides to use skill                 | Testing LLM behavior/reliability        |

**Test Results**
Results are saved to `tests/e2e/results/` with naming pattern `{mode}-{YYMMDD-HHmmss}/`:
```
explicit-260306-110914/
├── run-1-110914/
│   └── run-metrics.json     # Individual run data
├── token-metrics.json       # Aggregated token data
└── consistency-report.json  # Full analysis
```

**Baseline Management**
Baselines are stored in `tests/e2e/baseline/`:
```bash
# Save current results as baseline
bun test:e2e --set-baseline

# Save specific results as baseline
bun test:e2e --set-baseline results/explicit-260306-110914
```

**Pass Criteria**
Tests pass if ALL conditions are met:
1. **Skill loaded**: `true`
2. **Workflow score**: ≥ 0.70
3. **No regression**: Token usage stable, solutions found, search success maintained

**Exit Codes**
- `0`: All tests passed
- `1`: One or more tests failed
- `2`: Error occurred

### Test Locally

```bash
# Link for local testing
bun link

# In test project, link the package
bun link opencode-intellisearch

# Or use path-based testing (recommended)
# Add to test project's opencode.json:
# {
#   "plugins": ["/path/to/opencode-intellisearch"]
# }
```

### Path-Based Testing (Recommended)

1. Configure test project's `opencode.json`:
   ```json
   {
     "plugins": ["C:/dev/projects/github/opencode-intellisearch"]
   }
   ```

2. Run test:
   ```bash
   cd /path/to/test-project
   opencode run "test hello"
   ```

3. Check OpenCode logs:
   - Windows: `%USERPROFILE%/.local/share/opencode/log/`
   - macOS/Linux: `~/.local/share/opencode/log/`

4. Verify assets installed:
   ```bash
   ls .opencode/skills/intellisearch/
    ls .opencode/commands/search-intelligently.md
   ```

### Test Cross-Platform

- Test on Linux, macOS, and Windows
- Test fresh install (no `.version` marker)
- Test version skip (existing `.version` marker)
- Test with different OpenCode versions

### Test Skill Behavior with E2E

The E2E test suite validates the full skill workflow:

```bash
# Quick validation
bun test:e2e

# Test both skill loading modes
bun test:e2e --mode both

# Multiple runs for consistency check
bun test:e2e --runs 3
```

The E2E tests automatically:
1. Create an isolated test project in temp directory
2. Load the plugin via `file://` path reference
3. Execute test queries against the skill
4. Track tool usage and token consumption
5. Verify skill loading and workflow compliance
6. Compare results against baseline

For manual testing of specific scenarios, see "Path-Based Testing" below.

### Test Skill Behavior

1. Install skill
2. Create test queries for each category:
   - Code/technology queries
   - News queries
   - Company queries
   - Person queries
   - Research queries
3. Verify routing decisions
4. Check fallback behavior when MCP servers unavailable
5. Test memory caching (if configured)

## Submitting Changes

### 1. Create a Branch

```bash
git checkout -b ai-your-feature-name
```

All branches must start with `ai-`.

### 2. Make Your Changes

- Edit files in `assets/` directory for skills/commands
- Edit `plugin.ts` for plugin logic
- Test thoroughly
- Update documentation
- Update CHANGELOG.md

### 3. Type Check

```bash
bun run check
```

Ensure no TypeScript errors.

### 4. Run Tests

```bash
# Unit tests
bun test

# E2E tests (recommended before committing)
bun test:e2e

# If E2E tests pass, update baseline if needed
bun test:e2e --set-baseline
```

### 5. Commit Changes

```bash
git add plugin.ts
git commit -m "feat: add new routing feature

- Description of what changed
- Why it was changed
- References any related issues"
```

**Commit Message Format:**
- Use conventional commits
- First line: 50 chars or less
- Subsequent lines: more detail
- Branch names must start with `ai-`

### 5. Push to Your Fork

```bash
git push origin ai-your-feature-name
```

### 6. Create Pull Request

- Go to GitHub repository
- Click "Pull Requests"
- Click "New Pull Request"
- Select your branch
- Fill in PR template
- Submit for review

### 7. Address Feedback

- Respond to review comments
- Make requested changes
- Push updates to your branch
- Ensure `bun run check` still passes

## Code Style

### TypeScript

- Use **named functions** (not arrow functions) where no `this` scoping issues
- Target: ESNext, Module: ESNext
- Strict mode enabled
- Always use explicit return types on exported functions
- Prefer `async/await` over callbacks
- **Bun-native**: Import with `.ts` extensions

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

### Markdown Files

- Use 2 spaces for indentation
- Use sentence case for headings
- Include blank line before headings
- Use fenced code blocks with language identifier
- Use relative paths for file references
- Use forward slashes for all paths

### SKILL.md Frontmatter

```yaml
---
name: skill-name
description: Third-person description
license: MIT
compatibility: opencode
metadata:
  audience: agents
  topic: category
---
```

### Command Frontmatter

```yaml
---
description: Command description
agent: agent-name
model: model-id
temperature: 0.2
---
```

## Reporting Issues

### Bug Reports

When reporting bugs, include:

1. **Environment:**
   - OS and version
   - OpenCode version
   - Bun version
   - Installation type (global/local)

2. **Steps to Reproduce:**
   - Clear, numbered steps
   - Expected behavior
   - Actual behavior

3. **Error Messages:**
   - Full error output
   - OpenCode logs from `~/.local/share/opencode/log/`
   - Screenshots if applicable

4. **Additional Context:**
   - MCP server configuration
   - Other extensions installed
   - Workarounds tried

### Feature Requests

When requesting features, include:

1. **Problem Statement:**
   - What problem does this solve?
   - Why is it important?

2. **Proposed Solution:**
   - How should it work?
   - Use cases and examples

3. **Alternatives Considered:**
   - Other approaches evaluated
   - Why this approach is preferred

### Documentation Improvements

For documentation improvements:

1. Be specific about what's unclear
2. Suggest improved wording
3. Provide examples if helpful
4. Link to relevant sections

## Getting Help

- Check existing [GitHub Issues](https://github.com/expert-vision-software/opencode-intellisearch/issues)
- Review [OpenCode Documentation](https://opencode.ai/docs)
- Join [OpenCode Discord](https://discord.gg/opencode)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other contributors

Thank you for contributing to intellisearch! 🎉
