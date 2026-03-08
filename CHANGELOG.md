# Changelog

All notable changes to the intellisearch extension for OpenCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2025-03-08

### Added
- Automatic skill permission configuration during plugin install
- Implicit skill loading detection in E2E tests
- Cumulative token count display in E2E test output
- Git metadata (commitHash, branch, version, mainCommitHash) in test results
- Live feedback during E2E test execution
- Validation mode for quick E2E testing

### Changed
- **BREAKING**: AGENTS.md restructured with XML-tagged sections for agent consumption
- Replaced Node.js file operations with Bun native APIs
- Updated skill frontmatter for improved discoverability
- E2E tests now use stdin for query passing
- Improved E2E test stability to prevent hanging sessions

### Fixed
- Early failure detection in E2E tests (5 tool calls without skill)
- Unit test version check failures
- Plugin loading issues in test environment

## [0.3.0] - 2025-02-15

### Changed
- Simplified skill to GitHub repository search + DeepWiki workflow
- Removed site:github.com web search (use GitHub CLI or DeepWiki directly)
- Updated command to use agent: general with subtask: true

### Removed
- Exa integration and API key requirements
- DuckDuckGo fallback search mechanism
- Memory caching for follow-up queries
- Unused reference files

## [0.2.0] - 2025-02-03

### Changed
- **BREAKING**: Migrated to Bun-only architecture
- Removed CLI, build scripts, and npm compatibility
- Eliminated ~82% of codebase (450 → ~80 lines)
- Assets now published directly from `assets/` directory
- Plugin now at root level (`plugin.ts`, `index.ts`)
- Simplified testing with path-based plugin loading
- Updated all documentation for Bun-only workflow

### Removed
- CLI (`bin/cli.ts`) - no longer needed
- Build scripts (`scripts/build.ts`, `scripts/detect-pm.ts`)
- npm lockfile support
- Manual installation methods (npx/bunx)
- `source/` and `dist/` directories

## [0.1.0] - 2025-02-01

### Added
- Initial release of intellisearch extension
- Intelligent web search routing between Exa, deepWiki, DuckDuckGo, and webfetch
- Automatic GitHub repository detection for code/technology queries
- Memory caching support for faster follow-up queries
- Token-optimized search strategies
- Graceful fallback handling when primary tools unavailable
- Cross-platform support (Windows, macOS, Linux)
- TypeScript implementation with ESM support
