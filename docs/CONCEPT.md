## Principles
1. When a model searches the web for technical answers, that information is always best sourced directly from code repositories. 
2. Nowadays technical reference sources on the Internet mostly have github repositories. 
3. DeepWiki is the best way to learn about, navigate, and ask about a specific github repository. 

## Relevant Tools
1. DeepWiki provides up-to-date documentation you can talk to, for every repo in the world. Think Deep Research for GitHub - powered by Devin. It is available via remote MCP server without api key or authentication required at `https://mcp.deepwiki.com/mcp`. reference: https://docs.devin.ai/work-with-devin/deepwiki-mcp
2. Agents (.e.g OpenCode, Claude Code, Gemini Cli, etc) natively support fetching content from a url and typically handle converting html to markdown. For OpenCode, it is called `webfetch` and takes parameters `url`, `format` allowing text, markdown, and html, and `timeout` in number of seconds. reference: https://opencode.ai/docs/tools/#webfetch

## Example Flow WITHOUT skill:
1. User says "search the web for tools to validate semver specification strings"
2. Agent, leveraging inference, calls `webfetch` to google or some search provider "semver specification validation". example url "https://www.google.com/search?q=semver+specification+validation"
3. Top 3 search results are: semver.org (official), A Github Pages site  "Online Semver Checker", and a Medium article "SemVer-Validator". 
4. Agent, either sequentially or in parallel, calls `webfetch` against those top 3.
5. Model ingests all content from all three, interprets each:
5a. https://semver.org - includes text description of spec, formatting, and rules. Includes regex that validates BMF grammar.
5b. https://jubianchi.github.io/semver-check  - contains web textbox fields with validation for spec and text describing the spec along with links to implementations by npm, composer, and bundler npm packages.
5c. https://medium.com/@the_shubham_yadav/semver-validator-edab31a589a4 - contains description and some opinions about the spec and why to use it. Includes link to github repo for a demo site that includes input textbox and show validation results.
6. Model has to infer what to do from here and how to choose best solution or how to extract code. This will likely involve some assumptions and nuance based on system prompt.
7. Model makes decisions and responds back to user.

## Examples Flow WITH skill:
1. User says "search the web for tools to validate semver specification strings"

> SKILL Interjection: ensure add relevant language, framework, coding context. For this example, assume typescript and web.

2. Agent, leveraging inference, calls `webfetch` to google or some search provider "semver specification validation". example url "https://www.google.com/search?q=semver+specification+validation"

> SKILL Interjection: Instructs LLM to first search directly for github.com repositories. example google query string: `site:github.com {search string}`.
> it would find three choices in first page: https://github.com/mattfarina/semver-isvalid, https://github.com/npm/node-semver, https://github.com/fsaintjacques/semver-tool
> return response based on 3 options.

3. Top 3 search results are: semver.org (official), A Github Pages site  "Online Semver Checker", and a Medium article "SemVer-Validator". 

> SKILL Interjection: regex scan content for each page looking for a github.com or github.io reference.
> Find semver.org -> https://github.com/semver/semver/issues
> https://jubianchi.github.io/semver-check/ -> Detect url pattern `https://{owner}.github.io/{repository}/` 
> Find https://medium.com/@the_shubham_yadav/semver-validator-edab31a589a4 -> https://github.com/ShubhamYadav25/SemVer-Validator
> Map to github repository names in format `{owner}/{repository}`. 3 total.
> Use DeepWiki `ask_question` tool, repoName parameter takes string array for multiple repositories.
> `question` parameter = "Is there a package typescript-compatible package that can be installed and used locally on a web page to validate semver strings?"
> Model interprets yes/no or DeepWiki-inferred answers and returns best answer back to user.

## Baseline Behavior Prompt Example
In a new agent session with no skills loaded. Assign this prompt to a subagent:

> @general search the internet, do not use internal knowledge. show me 3 graph db solutions that fit best with my application and provide analysis (pros/cons). consider tech stack and current deployment model - preferring client-side solution over backend. 
> frontend: vitejs + aurelia 2 
> backend: dotnet 9 c# webapi

**Variation 1:**
Transcript: [baseline-pure-web-fetch-transcript.md](baseline-pure-web-fetch-transcript.md).
Tokens: 6143
Model: MiniMax-M2.5

**Variation 2:**
Transcript: [baseline-naive-transcript.md](baseline-naive-transcript.md).
Tokens: 11719
Model: MiniMax-M2.5

## Comparison Against Intellisearch
**Version 0.3.0**:
Transcript: [here](intellisearch-v0_3_0-transcript.md)
Tokens: 12652
Model: MiniMax-M2.5

**Version 0.3.2 - phase 1**
Transcript: [here](phase1-transcript.md)
Tokens: 8570
Model: MiniMax-M2.5

**Version 0.3.2 - phase 2**
Transcript: [here](phase2-transcript.md)
Tokens: 3753
Model: MiniMax-M2.5

**Version 0.3.2 - phase 3**
Transcript: [here](phase3-transcript.md)
Tokens: 3947
Model: MiniMax-M2.5

**Version 0.3.2 - phase 4 without search tool**
Transcript: [here](phase4-nosearchtool-transcript.md)
Tokens: 6777
Model: MiniMax-M2.5

**Version 0.3.2 - phase 4 with search tool**
Transcript: [here](phase4-nosearchtool-transcript.md)
Tokens: 5965
Model: MiniMax-M2.5