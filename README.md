# intellisearch

GitHub repository search for OpenCode with automatic DeepWiki integration for technical answers.

## Features

- **GitHub-First Search**: Searches for GitHub repositories and extracts technical answers directly from code
- **DeepWiki Integration**: Uses DeepWiki for authoritative Q&A on any GitHub repository
- **Automatic Repo Detection**: Identifies GitHub repos from search results and maps them to owner/repo format
- **Simple Workflow**: Search web → Extract GitHub repos → Query DeepWiki → Return results
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Bun-Native**: Zero build step, runs TypeScript natively

## Installation

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-intellisearch"]
}
```

Or install locally in your project:

```bash
bun add -d opencode-intellisearch
```

Then add to your project's `opencode.json`:

```json
{
  "plugins": ["opencode-intellisearch"]
}
```

## Usage

Once installed, the plugin adds the `/search-intelligently` command to OpenCode:

```bash
/search-intelligently How does React useEffect work?
/search-intelligently Tools for validating semver specification strings
/search-intelligently Best way to handle file uploads in Next.js
/search-intelligently Compare Zod vs Yup for validation libraries
/search-intelligently github:vercel/next.js app router patterns
```

## Requirements

### Runtime

- **Bun** - Download from [bun.sh](https://bun.sh/)

### Optional

- **GitHub CLI (`gh`)** - Direct GitHub repository search (preferred when available)
  - Install from [cli.github.com](https://cli.github.com/)
  - Run `gh auth login` to authenticate

### MCP Servers

**Required:**
- **deepwiki** - Repository Q&A ([docs](https://docs.devin.ai/work-with-devin/deepwiki-mcp))

Configure in `~/.config/opencode/opencode.json` or project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcpServers": {
    "deepwiki": {
      "url": "https://mcp.deepwiki.com/mcp"
    }
  }
}
```

## How It Works

### Tool Priority

1. **GitHub CLI** (if authenticated) → Direct GitHub API search with topics/language
2. **Search Tool** (websearch, etc.) → Web search with `site:github.com` operator
3. **Fetch Tool** (webfetch) → URI-based search with engine cycling (Brave → DDG → Google)

### Workflow

1. **Detect Tools** → Check gh CLI, search tool, or fetch tool availability
2. **Search Repositories** → Use best available method to find GitHub repositories
3. **Extract Repositories** → Map results to owner/repo format (skip if gh CLI used)
4. **Query DeepWiki** → Ask questions about detected repositories
5. **Return Results** → Present authoritative answers from repository documentation

## Documentation

- [Installation](INSTALLATION.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Troubleshooting

### "deepWiki unavailable"

- Verify deepWiki MCP server is configured in opencode.json
- Check MCP server status with `/mcp status`

### "Plugin not loading"

- Check OpenCode logs: `~/.local/share/opencode/log/`
- Verify plugin is in `opencode.json` plugins array
- Ensure Bun is installed and in PATH

## Development

```bash
# Install dependencies
bun install

# Type check
bun run check

# Run unit tests
bun test

# Run E2E tests
bun test:e2e

# Link for local testing
bun link && bun link opencode-intellisearch --cwd ~/.cache/opencode/node_modules/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development instructions.

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- [DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki-mcp) - Repository intelligence
- [OpenCode](https://opencode.ai) - AI coding environment
- [Bun](https://bun.sh) - Fast JavaScript runtime
