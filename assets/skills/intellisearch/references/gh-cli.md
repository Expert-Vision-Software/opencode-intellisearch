# GitHub CLI Search

Using `gh` CLI for direct GitHub repository search.

## Detection

Check availability with:
```bash
gh auth status
```
- Exit code 0: gh is available and authenticated
- Exit code non-zero: gh not available or not authenticated

## Search Command

```bash
gh search repos [query] [flags]
```

## Query Strategy

### Hybrid Approach

1. **Topics + Language** (preferred when topics identifiable)
2. **Keywords only** (fallback)

### Topic Detection

Infer topics from user query context:
- Framework names → topics (react, vue, express)
- Library names → topics (lodash, axios, moment)
- Concepts → topics (semver, validation, authentication)

### Language Inference

Extract programming language from:
- Explicit mention: "in TypeScript", "Python library"
- File extensions: ".ts", ".py", ".go"
- Context: "npm package" → JavaScript/TypeScript

## Examples

### Topic + Language Search
```bash
# Query: "semver validation in TypeScript"
gh search repos --topic=semver,validation --language=typescript --json nameWithOwner,stargazersCount --limit 10
```

### Keyword Search (Fallback)
```bash
# Query: "cli shell terminal"
gh search repos cli shell terminal --json nameWithOwner,stargazersCount --limit 10
```

### Combined Search
```bash
# Topics with additional keywords
gh search repos "release automation" --topic=semver,versioning --language=typescript --json nameWithOwner,stargazersCount --limit 10
```

## Output Format

```bash
--json nameWithOwner,stargazersCount --limit 10
```

**Example output:**
```json
[
  {"nameWithOwner": "npm/node-semver", "stargazersCount": 4500},
  {"nameWithOwner": "isaacs/node-semver", "stargazersCount": 1200},
  {"nameWithOwner": "mattfarina/semver-isvalid", "stargazersCount": 89}
]
```

## Result Processing

1. Get top 10 results from gh
2. Sort by `stargazersCount` descending
3. Return top 5 for DeepWiki queries

## Common Flags

| Flag | Purpose | Example |
|------|---------|---------|
| `--topic` | Filter by topics | `--topic=react,hooks` |
| `--language` | Filter by language | `--language=typescript` |
| `--owner` | Filter by owner | `--owner=facebook` |
| `--stars` | Min stars | `--stars=">100"` |
| `--sort` | Sort field | `--sort=stars` |
| `--order` | Sort order | `--order=desc` |
| `--limit` | Max results | `--limit=10` |
| `--json` | Output format | `--json nameWithOwner,stargazersCount` |
| `--archived` | Exclude archived | `--archived=false` |

## Error Handling

```
IF gh auth status fails:
  → Fall back to search_tool or fetch_tool
IF gh search repos fails:
  → Fall back to search_tool or fetch_tool
```

## Permission Opt-Out

Users can deny `gh` tool permission in OpenCode to opt out of this search method. The skill will automatically fall back to web search tools.
