# Search Workflow

Tool detection and search strategy for finding GitHub repositories.

## Tool Priority

Before searching, detect available tools:

```
IF gh auth status succeeds:
  → Use gh search repos (PREFERRED - direct API)
ELSE IF search_tool exists:
  → Use search tool with keywords (NOT site:github.com)
ELSE IF fetch_tool exists:
  → Use URI-based search with engine cycling
ELSE:
  → Report: "No search capability available"
  → fallback to internal knowledge
```

## GitHub CLI (Preferred)

**Detection:**
```bash
gh auth status  # Exit 0 = available
```

**Search Patterns (try in order):**

```bash
# 1. Full query with topics and language
gh search repos "{query}" --topic={topics} --language={lang} --json nameWithOwner,stargazersCount,description --limit 10

# 2. Query with language only
gh search repos "{query}" --language={lang} --json nameWithOwner,stargazersCount,description --limit 10

# 3. Topic-based search (no query string)
gh search repos --topic={topics} --language={lang} --json nameWithOwner,stargazersCount,description --limit 10

# 4. Broader keyword search
gh search repos "{query}" --json nameWithOwner,stargazersCount,description --limit 10
```

**Process:**
1. Infer topics from query (framework/library names → topics)
2. Infer language if mentioned
3. Sort by stargazersCount, return top 5
4. Skip to DeepWiki query

**Reference:** [gh-cli.md](gh-cli.md)

## Search Tool (Fallback #1)

**DO NOT use `site:github.com`** - it returns full GitHub URLs that get misparsed as repos.

**Instead, search for technology + keywords:**

```json
{ "query": "{technology} {feature} {language} library package" }
```

**Example:**
```json
{ "query": "typescript semver validation library npm package" }
```

**From results:**
- Look for package names in snippets
- Find `github.com/owner/repo` references in descriptions
- Ignore navigation/ads

## URI-Based Search (Fallback #2)

When only fetch tools available, cycle through engines:

| Priority | Engine | URL |
|----------|--------|-----|
| 1 | Brave | `https://search.brave.com/search?q={terms}` |
| 2 | DuckDuckGo | `https://duckduckgo.com/?q={terms}` |
| 3 | Google | `https://www.google.com/search?q={terms}` |

**Error Handling:**
```
FOR each engine IN [brave, duckduckgo, google]:
  result = fetch(engine_url)
  IF success AND has_search_results:
    RETURN result
  CONTINUE
RETURN error: all engines failed
```

**Failure Causes:**
- JavaScript redirects (Google)
- Captchas (DuckDuckGo)
- HTML parsing issues

**Example:**
```json
{
  "url": "https://search.brave.com/search?q=typescript%20semver%20validation%20library",
  "format": "markdown",
  "timeout": 10
}
```

## Query Construction

**Keyword-based (preferred):**
```
{technology} {feature} {language} library package
```

**Examples:**
- `react hooks typescript library`
- `semver validation nodejs package`
- `graph database python library`

**From results, extract repos by:**
- Looking for `github.com/owner/repo` in snippet descriptions
- Finding package names that map to known repos
- Following links in documentation references

## References

- [gh-cli.md](gh-cli.md)
- [google-search.md](google-search.md)
- [brave-search.md](brave-search.md)
- [ddg-search.md](ddg-search.md)
