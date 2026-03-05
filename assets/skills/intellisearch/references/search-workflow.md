# Search Workflow

Tool detection and search strategy for finding GitHub repositories.

## Tool Priority

Before searching, detect available tools:

```
IF gh auth status succeeds:
  → Use gh search repos
ELSE IF search_tool exists:
  → Use search tool with site:github.com
ELSE IF fetch_tool exists:
  → Use URI-based search with engine cycling
ELSE:
  → Report: "No search capability available"
```

## GitHub CLI (Preferred)

**Detection:**
```bash
gh auth status  # Exit 0 = available
```

**Search:**
```bash
gh search repos --topic=TOPICS --language=LANG --json nameWithOwner,stargazersCount --limit 10
```

**Process:**
1. Infer topics from query (framework/library names → topics)
2. Infer language if mentioned
3. Sort by stargazersCount, return top 5
4. Skip to DeepWiki query

**Reference:** [gh-cli.md](gh-cli.md)

## Search Tool (Fallback #1)

Use with `site:github.com` operator:

```json
{ "query": "site:github.com {keywords} {language}" }
```

**Example:**
```json
{
  "query": "site:github.com semver validation typescript"
}
```

## URI-Based Search (Fallback #2)

When only fetch tools available, cycle through engines:

| Priority | Engine | URL |
|----------|--------|-----|
| 1 | Brave | `https://search.brave.com/search?q={terms}` |
| 2 | DuckDuckGo | `https://ddg.gg/?q={terms}` |
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
  "url": "https://search.brave.com/search?q=site:github.com%20semver%20validation",
  "format": "markdown",
  "timeout": 10
}
```

## Query Construction

```
site:github.com {search terms}
```

**With context:**
```
site:github.com {technology} {feature} {language}
```

**Examples:**
- `site:github.com react hooks typescript`
- `site:github.com semver validation nodejs`
- `site:github.com "graph database" python`

## References

- [gh-cli.md](gh-cli.md)
- [google-search.md](google-search.md)
- [brave-search.md](brave-search.md)
- [ddg-search.md](ddg-search.md)
