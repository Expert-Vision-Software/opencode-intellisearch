# deepWiki Tools Reference

Complete reference for deepWiki MCP server tools for repository documentation Q&A.

<important>
"OpenCode" never refers to the archived and deprecated "opencode-ai/opencode" github repo. "OpenCode" always refers to "anomalyco/opencode" owned by "anomalyco" in github.
</important>

## Repository Name Validation

Before calling DeepWiki, validate that the repository name is legitimate and not a GitHub website path.

### Blocked First Segments

**Reject any `owner/repo` where the owner (first segment) matches these:**

```
about, accelerator, apps, archiveprogram, blog, careers, changelog,
collections, community, contact, customer-stories, docs, enterprise,
events, explore, features, gist, github, github-apps, issues, login,
maintainers, marketplace, mcp, notifications, oauth-apps, orgs,
organizations, password_reset, press, pricing, pull_requests, pulls,
resources, security, securitylab, sessions, settings, site-policy,
skills, solutions, sponsors, support, team, topics, trending,
trust-center, whitepapers, why-github
```

### Validation Rules

| Check | Rule | Example |
|-------|------|---------|
| Owner format | Alphanumeric, `-`, `_` only | `npm`, `node-js` ✅ |
| Repo format | Alphanumeric, `-`, `_`, `.` only | `node-semver`, `lib.js` ✅ |
| Not blocked | Owner not in blocked list | `npm/node-semver` ✅ |
| Blocked path | Owner in blocked list | `features/spark` ❌ |

### Examples

| Input | Verdict | Reason |
|-------|---------|--------|
| `npm/node-semver` | ✅ Valid | `npm` not blocked |
| `graphology/graphology` | ✅ Valid | `graphology` not blocked |
| `features/spark` | ❌ Invalid | `features` is GitHub product page |
| `topics/database` | ❌ Invalid | `topics` is GitHub topic page |
| `enterprise/startups` | ❌ Invalid | `enterprise` is GitHub marketing |
| `resources/articles` | ❌ Invalid | `resources` is GitHub content |
| `github/explore` | ❌ Invalid | `github` is org page, not repo |
| `site-policy/terms` | ❌ Invalid | `site-policy` is GitHub legal |
| `orgs/community` | ❌ Invalid | `orgs` is GitHub navigation |

## Available Tools

### deepWiki_read_wiki_structure
Get available documentation topics for a repository.

**Parameters:**
- `repoName` (required): Repository in `owner/repo` format

**Returns:** List of available documentation sections and topics.

**Use when:** Exploring what documentation is available before asking specific questions.

### deepWiki_read_wiki_contents
Read full documentation content for a repository.

**Parameters:**
- `repoName` (required): Repository in `owner/repo` format

**Returns:** Complete documentation content.

**Use when:** You need comprehensive documentation overview or when `ask_question` doesn't provide enough detail.

### deepWiki_ask_question
Ask specific questions about a repository.

**Parameters:**
- `repoName` (required): Repository in `owner/repo` format
  - **Single repo**: Use string: `"owner/repo"`
  - **Multiple repos**: Use array: `["owner1/repo1", "owner2/repo2"]`
  - **Critical**: Do not pass single-item array like `["owner/repo"]` for one repo
- `question` (required): Specific question about the repository

**Returns:** Targeted answer based on repository documentation.

**Use when:** You have a specific question and want a direct answer.

**Important format rules:**
- Single repository: `repoName="anomalyco/opencode"`
- Multiple repositories: `repoName=["anomalyco/opencode", "vercel/next.js"]`
- ❌ Wrong: `repoName=["anomalyco/opencode"]` (single-item array causes search failure)

## When to Use deepWiki

Use deepWiki when:

- Query is about a **specific GitHub repository**
- You need **authoritative code answers** (from official docs)
- The question involves **implementation details** of a library/framework
- You want **installation/setup instructions** for a specific tool
- The query is about **API usage patterns** for a known package

## repoName Format

Always use `owner/repo` format:

| Repository | Correct | Incorrect |
|------------|---------|-----------|
| React | `facebook/react` | `react`, `React` |
| Next.js | `vercel/next.js` | `nextjs`, `next` |
| TypeScript | `microsoft/TypeScript` | `typescript`, `ts` |
| Vue | `vuejs/core` | `vue`, `Vue.js` |

## Example Workflows

### Getting Started with a Library

**Step 1**: Check documentation structure
```json
{
  "tool": "deepwiki:deepWiki_read_wiki_structure",
  "params": {
    "repoName": "vercel/next.js"
  }
}
```

**Step 2**: Ask specific question
```json
{
  "tool": "deepwiki:deepWiki_ask_question",
  "params": {
    "repoName": "vercel/next.js",
    "question": "How do I create a dynamic route with parameters?"
  }
}
```

### Troubleshooting

```json
{
  "tool": "deepwiki:deepWiki_ask_question",
  "params": {
    "repoName": "facebook/react",
    "question": "Why am I getting the 'rules of hooks' warning?"
  }
}
```

### Installation Questions

```json
{
  "tool": "deepwiki:deepWiki_ask_question",
  "params": {
    "repoName": "tailwindlabs/tailwindcss",
    "question": "How do I install and configure Tailwind with Vite?"
  }
}
```

## Best Practices

1. **Validate repo name** against blocked list before calling
2. **Use `ask_question`** for specific queries (most efficient)
3. **Use `read_wiki_contents`** only when you need the full documentation
4. **Check `read_wiki_structure`** first when exploring unfamiliar repos
5. **Use string for single repo, array for multiple repos** in `repoName` parameter:
   - Correct: `repoName="owner/repo"` for single repository
   - Correct: `repoName=["owner1/repo1", "owner2/repo2"]` for multiple repositories
   - ❌ Wrong: `repoName=["owner/repo"]` for single repository (causes search failure)

## Limitations

- Only works for **public GitHub repositories**
- Documentation must be **indexed by deepWiki**
- Very new or obscure repos may not be available
- Cannot access private repositories
