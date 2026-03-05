---
name: intellisearch
description: Searches for technical answers by finding GitHub repositories and querying them with DeepWiki. Use when users ask technical questions about frameworks, libraries, APIs, or need documentation from code repositories.
license: MIT
compatibility: opencode
metadata:
  audience: agents
  topic: github-repository-search
---

## Definitions

| Term | Definition | Example |
|------|------------|---------|
| **Fetch Tool** | Reads URL, returns content | `webfetch` |
| **Search Tool** | Takes query, searches web | `websearch`, `google_search` |
| **URI-Based Search** | Fetch tool + search engine URL | `webfetch("https://google.com/search?q=...")` |
| **GitHub CLI** | Direct GitHub API access | `gh search repos` |

## Critical Rules

1. **NEVER fallback to internal knowledge** - always search externally
2. **NEVER fetch repository README/pages directly** - use DeepWiki instead
3. **Prefer gh CLI > search tool > fetch tool** - reliability decreases down the chain
4. **If DeepWiki multi-repo fails, query repos individually**
5. **Limit tool calls to 5 per query** - each call adds context tokens
6. **Filter to top 3 repos before DeepWiki** - avoid over-exploration

## Workflow

```
[Detect tools: gh → search → fetch]
              ↓
1. Search repositories (gh CLI preferred)
              ↓
2. Extract owner/repo format
              ↓
2.5. Filter to top 3 by stars
              ↓
3. Query DeepWiki (max 3 repos)
              ↓
4. Return answer from DeepWiki results
```

## Step 1: Search Repositories

**Priority:** `gh CLI` → `search tool` → `fetch tool`

**gh CLI (preferred - no HTML parsing, direct API):**
```bash
gh search repos --topic=semver,validation --language=typescript --json nameWithOwner,stargazersCount --limit 10
```
→ Sort by stargazersCount, take top 5 → Skip to Step 3

**Search tool:**
```json
{ "query": "site:github.com semver validation typescript" }
```
→ Continue to Step 2

**Fetch tool:** See [search-workflow.md](references/search-workflow.md) for URI cycling

## Step 2: Extract Repositories (skip if gh CLI used)

Parse search results for GitHub URLs:

| Pattern | Regex | Example |
|---------|-------|---------|
| Standard repo | `github\.com/([\w-]+)/([\w.-]+)` | `github.com/npm/node-semver` → `npm/node-semver` |
| GitHub Pages | `([\w-]+)\.github\.io/([\w.-]+)` | `npm.github.io/semver` → `npm/semver` |

## Step 2.5: Filter Candidates

Select **top 3 repositories** before DeepWiki query.

**Prioritization:**
1. **Stars** - Higher count = community validation
2. **Recency** - Recent commits = active maintenance
3. **Language match** - Prefer repos matching query language

**Do not query DeepWiki for repos you won't recommend.**

## Step 3: Query DeepWiki

**Multi-repo query (try first):**
```json
{
  "repoName": ["npm/node-semver", "mattfarina/semver-isvalid"],
  "question": "Is there a TypeScript-compatible package for validating semver strings?"
}
```

**IF multi-repo fails (any repo unindexed):**
```json
// Query repos individually
{ "repoName": "npm/node-semver", "question": "..." }
{ "repoName": "mattfarina/semver-isvalid", "question": "..." }
```

**Format rules:**
- Single: `repoName="owner/repo"` (string)
- Multi: `repoName=["owner1/repo1", "owner2/repo2"]` (array, 2+ items)
- ❌ Never: `repoName=["owner/repo"]` (single-item array fails)

**Efficiency rules:**
- Query max 3 repos per request
- Prioritize by: stars > recency > language match
- If multi-repo fails, query top candidate only (not all individually)

## Step 4: Return Answer

From DeepWiki results, provide:
- Best options with trade-offs
- Specific implementation guidance
- Code examples if available
- Repository links

> **Efficiency:** If you found more than 3 repos, prioritize by: stars > recency > language match. Only include details for your top 3 candidates.

## Failure Handling

| Failure | Action |
|---------|--------|
| gh CLI not available | Fall back to search tool |
| Search tool not available | Fall back to fetch tool + URI cycling |
| URI search fails (captcha/redirect) | Try next engine in cycle |
| All URI searches fail | Report: "Unable to search - no working search method" |
| DeepWiki multi-repo fails | Query repos individually |
| DeepWiki single repo fails | Try next repo in list |
| All DeepWiki queries fail | Report: "Repos found but not indexed by DeepWiki" |

## References

- [search-workflow.md](references/search-workflow.md) - Tool detection, URI cycling
- [gh-cli.md](references/gh-cli.md) - GitHub CLI search syntax
- [google-search.md](references/google-search.md) - Google operators
- [brave-search.md](references/brave-search.md) - Brave operators
- [ddg-search.md](references/ddg-search.md) - DuckDuckGo operators
