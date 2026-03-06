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
gh search repos --topic=semver,validation --language=typescript --json fullName,stargazersCount --limit 10
```

### Keyword Search (Fallback)
```bash
# Query: "cli shell terminal"
gh search repos cli shell terminal --json fullName,stargazersCount --limit 10
```

### Combined Search
```bash
# Topics with additional keywords
gh search repos "release automation" --topic=semver,versioning --language=typescript --json fullName,stargazersCount --limit 10
```

## Output Format

```bash
--json fullName,stargazersCount,createdAt,updatedAt,description --limit 10
```

**Example output:**
```json
[
  {"createdAt":"2020-03-17T21:23:36Z","description":"SEMVER validation Github Action","fullName":"rubenesp87/semver-validation-action","stargazersCount":8,"updatedAt":"2024-03-29T19:31:00Z"},
  {"createdAt":"2024-10-07T16:18:55Z","description":"An example to prove semverValidate Helm function","fullName":"lucabaggi/helm-semver-validation","stargazersCount":0,"updatedAt":"2024-10-07T16:24:06Z"},
  {"createdAt":"2022-11-20T13:56:07Z","description":"","fullName":"actions-marketplace-validations/skymatic_semver-validation-action","stargazersCount":0,"updatedAt":"2025-12-06T11:10:03Z"}
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
| `--json` | Output format | `--json fullName,stargazersCount` |
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
