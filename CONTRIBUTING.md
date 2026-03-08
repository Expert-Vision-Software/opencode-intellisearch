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

```bash
# Quick test (explicit mode)
bun test:e2e

# Test implicit mode
bun test:e2e --mode implicit

# Both modes
bun test:e2e --mode both

# Multiple runs
bun test:e2e --runs 3

# Set baseline
bun test:e2e --set-baseline
```

**Pass Criteria:**
- Skill loaded: true
- Workflow score: ≥ 0.70
- No regression in token usage/solutions/search success

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
