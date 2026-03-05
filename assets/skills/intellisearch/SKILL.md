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
3. **NEVER use `site:github.com` with search/fetch tools** - causes bad URL extraction
4. **Prefer gh CLI > search tool > fetch tool** - reliability decreases down the chain
5. **If DeepWiki multi-repo fails, query repos individually**
6. **Limit tool calls to 5 per query** - each call adds context tokens
7. **Filter to top 3 repos before DeepWiki** - avoid over-exploration

## Workflow

```
[Detect tools: gh → search → fetch]
              ↓
1. Search repositories (gh CLI preferred)
              ↓
2. Extract owner/repo format (from gh JSON or search snippets)
              ↓
2.5. Filter to top 3 by stars
              ↓
3. Query DeepWiki (max 3 repos)
              ↓
4. Return answer from DeepWiki results
```

## Step 1: Search Repositories

**Priority:** `gh CLI` → `search tool` → `fetch tool`

### Method 1: gh CLI (Preferred - Direct API, No HTML Parsing)

**Try these searches in order (stop when you get good results):**

```bash
# 1. Full query with topics and language
gh search repos "semver validation" --topic=semver,validation --language=typescript --json nameWithOwner,stargazersCount,description --limit 10

# 2. Query with language only
gh search repos "semver validation" --language=typescript --json nameWithOwner,stargazersCount,description --limit 10

# 3. Topic-based search (no query string)
gh search repos --topic=semver,validation --language=typescript --json nameWithOwner,stargazersCount,description --limit 10

# 4. Broader keyword search
gh search repos "semver validation" --json nameWithOwner,stargazersCount,description --limit 10
```

**From results:**
- Sort by `stargazersCount` (descending)
- Take top 5 candidates
- **Skip to Step 3** (DeepWiki query)

### Method 2: Search Tool (Fallback - No site: Operator)

**DO NOT use `site:github.com`** - it returns full GitHub URLs that get misparsed.

**Instead, search for the technology + keywords:**

```json
{ "query": "typescript semver validation library npm package" }
```

**Look for:**
- Package names mentioned (e.g., "semver", "semver-compare")
- Library names in snippets
- GitHub repo references in descriptions (e.g., "github.com/user/repo")

**Extract repo names from search snippets:**
- Look for `github.com/owner/repo` patterns in result descriptions
- Validate: owner and repo contain only alphanumeric, `-`, `_`, `.`

### Method 3: Fetch Tool (Fallback - URI-Based Search)

Use search engine URLs directly. **DO NOT fetch github.com pages.**

**Engines (try in order):**

| Priority | Engine | URL Pattern |
|----------|--------|-------------|
| 1 | Brave | `https://search.brave.com/search?q={encoded_query}` |
| 2 | DuckDuckGo | `https://duckduckgo.com/?q={encoded_query}` |
| 3 | Google | `https://www.google.com/search?q={encoded_query}` |

**Example:**
```json
{
  "url": "https://search.brave.com/search?q=typescript%20semver%20validation%20library",
  "format": "markdown",
  "timeout": 10
}
```

**From results:**
- Extract repo names from search snippets (not from navigation/ads)
- Look for `github.com/owner/repo` in result descriptions
- Ignore any URLs starting with github.com/features, github.com/topics, etc.

## Step 2: Extract Repositories (skip if gh CLI used)

**Only needed for search tool / fetch tool results.**

### Valid Repository URL Patterns

| Pattern | Regex | Example |
|---------|-------|---------|
| Standard repo | `github\.com/([\w-]+)/([\w.-]+)` | `github.com/npm/node-semver` |
| GitHub Pages | `([\w-]+)\.github\.io/([\w.-]+)` | `npm.github.io/semver` |

### Validation Rules

**See [deepwiki-tools.md](references/deepwiki-tools.md) for blocked path list.**

**Only extract if:**
- First segment (owner) is NOT in blocked list
- Owner contains only: alphanumeric, `-`, `_`
- Repo contains only: alphanumeric, `-`, `_`, `.`

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
