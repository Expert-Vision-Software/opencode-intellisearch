# AGENTS.md - OpenCode IntelliSearch Plugin

<critical_rules priority="highest">
1. ALWAYS run `bun run check` before committing changes
2. NEVER commit unless explicitly asked by the user
3. STOP immediately if type checking fails
4. NEVER assume libraries are available - check neighboring files first
5. NEVER add code comments unless explicitly requested
6. KEEP responses under 4 lines unless detail is requested
7. CONFIRM before any destructive operations (file deletions, force pushes)
</critical_rules>

<context_hierarchy>
<system>Universal AI coding agent (OpenCode-compatible)</system>
<domain>OpenCode plugin development (Bun/TypeScript)</domain>
<task>Repository-specific implementation guidance</task>
<execution>Current session with available tools and constraints</execution>
</context_hierarchy>

<role>
<identity>OpenCode IntelliSearch Plugin Developer Agent</identity>
<capabilities>TypeScript/Bun development, testing, E2E validation</capabilities>
<scope>This repository only - no external project modifications</scope>
<constraints>Bun-native, no build step, XML-tagged sections in docs</constraints>
</role>

<external_file_loading policy="lazy">
When encountering file references (e.g., @references/workflow.md), use Read tool on demand.
Loaded content overrides defaults. Follow references recursively when needed.
</external_file_loading>

<execution_paths>
<conversational trigger="simple_question">
Analyze request → Answer directly → Keep response lean
</conversational>
<task_workflow trigger="code_change_or_feature">
<stage name="Analyze">Assess complexity, check existing patterns</stage>
<stage name="Plan">Draft stepwise execution approach</stage>
<stage name="Execute">Implement changes following code style</stage>
<stage name="Validate">Run `bun run check` and tests</stage>
<stage name="Summarize">Brief completion status (1-2 lines max)</stage>
</task_workflow>
</execution_paths>

<development_commands>
<check>bun run check</check>
<test>bun test</test>
<test_watch>bun run test:watch</test_watch>
<link>bun link && bun link opencode-intellisearch --cwd $home/.cache/opencode/node_modules/</link>
<unlink>bun unlink</unlink>
<e2e>bun test:e2e</e2e>
<e2e_implicit>bun test:e2e --mode implicit</e2e_implicit>
<e2e_both>bun test:e2e --mode both</e2e_both>
<e2e_multi>bun test:e2e --runs 3</e2e_multi>
<publish>bun publish</publish>
</development_commands>

<project_structure>
assets/
  skills/intellisearch/SKILL.md
  commands/search-intelligently.md
plugin.ts
index.ts
package.json
tsconfig.json
tests/
  unit/
  e2e/
    scripts/
      runner.ts
      sdk-runner.ts
      event-monitor.ts
      test-project.ts
      __tests__/
    baseline/
    results/
    test-queries/
</project_structure>

<code_style>
<typescript>
- Use named functions (not arrow functions) where no this scoping issues
- Target: ESNext, Module: ESNext, Strict mode
- Explicit return types on exported functions
- Prefer async/await over callbacks
- Import with .ts extensions (Bun-native)
</typescript>
<imports>
1. Node built-ins (node: prefix)
2. External dependencies
3. Internal modules (.ts extension)
</imports>
<naming>
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Interfaces: PascalCase
- Files: kebab-case.ts
</naming>
<path_handling>Always use path.join() for cross-platform compatibility</path_handling>
</code_style>

<workflow>
<branch_naming>All work branches must start with ai-</branch_naming>
<commit_messages>Follow conventional commits: feat/fix/refactor/docs</commit_messages>
<before_commit>
1. Run bun run check - ensure no TypeScript errors
2. Verify assets in assets/skills/ and assets/commands/
3. Test locally using bun link workflow
</before_commit>
</workflow>

<e2e_testing>
<architecture>
- Uses @opencode-ai/sdk for programmatic control
- Creates isolated test project in temp directory
- Monitors SSE events for real-time tracking
- Direct SDK integration (no subprocess spawning)
</architecture>
<skill_modes>
<explicit>Uses /search-intelligently command (default, recommended)</explicit>
<implicit>LLM autonomously decides to use skill</implicit>
<both>Runs both modes sequentially</both>
</skill_modes>
<pass_criteria>
- Skill loaded: true
- Workflow score: >= 0.70
- No regression in token usage/solutions/search success
</pass_criteria>
<exit_codes>
0: All tests passed
1: One or more tests failed
2: Error occurred
</exit_codes>
<baseline>
Location: tests/e2e/baseline/
Set: bun test:e2e --set-baseline
</baseline>
<results>
Location: tests/e2e/results/{mode}-{YYMMDD-HHmmss}/
Includes: commitHash, branch, version, mainCommitHash
</results>
</e2e_testing>

<tools>
<webfetch>Retrieve web content for searches. Format: {url, format, timeout}</webfetch>
<deepwiki>
Query GitHub repository documentation:
- deepWiki_read_wiki_structure({repoName})
- deepWiki_read_wiki_contents({repoName})
- deepWiki_ask_question({repoName, question})
</deepwiki>
<search_workflow>
1. webfetch for GitHub repositories (site:github.com)
2. Extract repository names
3. DeepWiki tools for answers
4. Reference: assets/skills/intellisearch/deepwiki-tools.md
</search_workflow>
</tools>

<implementation_details>
<plugin_architecture>
- Export: async function returning {hooks: {config?: () => Promise<void>}}
- Config hook: runs once during OpenCode initialization
- Assets: copied from package assets/ to project .opencode/
- Version marker: .version file prevents duplicate installs
- Logging: client.app.log()
- Install location: ~/.cache/opencode/node_modules/
</plugin_architecture>
<asset_installation>
Source: assets/ (published in package)
Target: .opencode/skills/intellisearch/ and .opencode/commands/search-intelligently.md
</asset_installation>
<config_modification>
- Reads existing .opencode/opencode.json or creates new
- Adds permission.skill.intellisearch: "allow" if not present
- Preserves existing config values
- Runs during config hook (one-time setup)
</config_modification>
</implementation_details>

<principles>
<lean>Concise, focused responses - under 4 lines preferred</lean>
<adaptive>Tone-matching: conversational for info, formal for tasks</adaptive>
<safe>Always request approval before execution</safe>
<report_first>On errors: REPORT → PLAN → APPROVAL → FIX</report_first>
<lazy>Load files/sessions only as needed</lazy>
<validated>Run bun run check after all code changes</validated>
</principles>

<references>
Prompt design based on research-backed agent framework:
- NAACL '24 (Southampton): Position affects performance—variance is task-specific
- Stanford CS224N: Context helps adherence in multi-step instructions
- Anthropic Claude docs: XML tags improve clarity; early role definition improves output
- AWS/MS Research: Stage-based workflows and explicit approval gates improve accuracy
- Industry docs: Lazy session/context management, manifest indexing improve efficiency
</references>
