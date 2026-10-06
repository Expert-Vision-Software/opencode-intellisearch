# Changelog

All notable changes to the intellisearch extension for OpenCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-10-05

### Added
- `clear-cache` CLI subcommand (self-scoped only) plus best-effort pruning of this package's own cache copies on every install
- `--migrate` consent flag for root-config migration; migration is now opt-in and defaults to off
- `uninstall --purge-config` to additionally remove the package-managed permission, MCP, and plugin config entries (conservative default unchanged)
- Lenient JSONC config reader (`src/jsonc.ts`): scope detection consults `opencode.jsonc` alongside `opencode.json` plus the legacy global `config.json`, warning on unparseable candidates without masking registrations
- Load-hook failure advisory: the config hook is fully wrapped in try/catch and emits a single once-guarded advisory naming the cache directory and remediation commands when installation fails
- `CopyModeUnsupportedError` enforcement with `"content": "code"` declared in package.json; copy-mode requests fail loudly for this code-backed package
- Contract and unit regression suites for JSONC detection, surgical config splicing, cache hygiene, uninstall purge, and package file layout

### Changed
- Config writers now perform surgical text splices (`src/json-splice-editor.ts`) preserving indentation, comments, trailing commas, and key order; unparseable files are refused byte-for-byte instead of rewritten
- Permission and MCP configuration is CLI-only; the load hook installs payload assets only and never edits registrations
- Plugin entry point moved to `src/plugin.ts` with `index.ts` as the only root code file (default-only export)
- Asset layout migrated from the legacy `assets/` wrapper to repo-root `skills/` and `commands/` directories
- Skill and command frontmatter values fully quoted; skill metadata normalized to a string-to-string map
- README badge row condensed to a single line; all shipped config snippets use the valid `plugin` and `mcp` keys with canonical `name@latest` / `file:///` entries
- Detection evaluates every candidate config base before deciding so unparseable-file warnings can never be skipped by a higher-priority match

### Fixed
- Uninstall removes only manifest-recorded paths and no longer deletes foreign or consumer-authored skills and commands
- Missing bundled asset directories now fail loudly instead of leaving a scope looking installed with a partial payload

## [0.6.0] - 2026-09-08

### Added
- `RegistrationDetector` (`src/registration.ts`) for scope-aware load-time registration detection against the global opencode config and the repo's `.opencode/opencode.json` or repo-root `opencode.json`
- `InstallManifest` (`src/manifest.ts`) with per-file sha256 entries to gate install writes per detected scope
- `PluginNameNormalizer` (`src/plugin-name.ts`) for semantic `name ≡ name@latest ≡ name@x.y.z` matching and canonical `name@latest` writing
- One-shot non-blocking install advisory: a single warn-level `client.app.log` entry plus a TUI toast when the plugin is unregistered and not installed anywhere; fires at most once per plugin session, suppressed when any scope holds an install, performs zero writes
- `tests/contract/` regression suite porting the handoff's contract table: fresh-repo zero-writes, root-config preservation, valid/unparseable local configs, manifest no-op and version drift, both-scope handling, cross-scope isolation, advisory suppression and once-per-session semantics
- `tests/helpers/global-sandbox.ts` to sandbox the global config via `XDG_CONFIG_HOME` so contract tests never touch the real global config
- Ported five-scenario qcgates-style repro harness into `tests/contract/plugin.test.ts` asserting zero repo disk writes from the config hook across fresh, root-only, local-foreign, invalid-local, and control-up-to-date-local scenarios

### Changed
- `plugin.ts` now performs scope-aware, manifest-gated load-time installation instead of unconditional reinstalls
- Installer hardened to share a single code path with the CLI: unparseable configs are preserved byte-for-byte with a warning; `--force` is CLI-only; root-config migration requires explicit consent and never runs at load
- Plugin references are written canonically as `name@latest` with semantic dedup; `name@x.y.z` and bare `name` references are treated as the same package
- Legacy `.version` markers inside installed skill directories are reconciled and removed on first manifest-era install

### Removed
- Old unconditional load-time reinstall behavior and the `addPluginConfig: true` / `migrateRootConfig: true` defaults at the config hook (the hook now installs assets only, never edits `plugin` arrays, never migrates root configs)

## [0.5.0] - 2026-03-13

### Added
- CLI with install/uninstall/status commands for plugin management
- DeepWiki MCP server configuration support
- Interactive prompts for permission and MCP setup
- Workflow violation detection in E2E tests
- Verbose mode and show-results option in E2E tests
- Claude plugin compatibility (.codenomad support)
- Cache cleanup for test isolation
- Bash detection for curl fallback

### Changed
- Migrated root opencode.json to .opencode/ directory structure
- Plugin now added to opencode.json plugin array on install
- Normalized tool names to avoid duplicate lines in output
- Updated skill for improved marketability and clarity

### Fixed
- Package-files test for new installer location
- DeepWiki fallback when MCP tools unavailable

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
