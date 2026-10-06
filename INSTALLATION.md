# Installation Guide

Detailed installation instructions for intellisearch extension for OpenCode.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [MCP Server Setup](#mcp-server-setup)
- [Verification](#verification)
- [Uninstallation](#uninstallation)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required

- [OpenCode](https://opencode.ai) installed and running
- [Bun](https://bun.sh/) - Fast JavaScript runtime

### Optional

- [GitHub CLI (`gh`)](https://cli.github.com/) - For direct GitHub repository search
  - Run `gh auth login` to authenticate
  - To opt out: deny `gh` tool permission in OpenCode

### MCP Servers

- **deepwiki** - Repository Q&A ([docs](https://docs.devin.ai/work-with-devin/deepwiki-mcp))

## Installation

### Option 1: CLI (Recommended)

The easiest way—runs the installer which handles everything:

```bash
# Interactive installer (asks for preferences)
bunx opencode-intellisearch install

# Non-interactive, global (all projects)
bunx opencode-intellisearch install --scope global

# Non-interactive, local (current project only)
bunx opencode-intellisearch install --scope local

# Skip confirmation prompts
bunx opencode-intellisearch install --scope global --force
```

The installer will:
- Copy skill and command files to `.opencode/`
- Configure skill permission (`permission.skill.intellisearch: "allow"`)
- Add MCP server configuration (deepwiki)
- Add plugin to opencode.json

### Option 2: npm/bun Package

Install globally or locally, then configure manually:

```bash
# Global install
bun add -g opencode-intellisearch

# Local install (project only)
bun add -d opencode-intellisearch
```

Then add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-intellisearch@latest"],
  "mcp": {
    "deepwiki": {
      "url": "https://mcp.deepwiki.com/mcp"
    }
  }
}
```

### Option 3: Local Development

For development and testing:

```bash
# Clone repository
git clone https://github.com/expert-vision-software/opencode-intellisearch.git
cd opencode-intellisearch

# Install dependencies
bun install

# Link globally
bun link

# Use in test project
cd /path/to/test-project
bun link opencode-intellisearch --cwd ~/.cache/opencode/node_modules/
```

Or use path-based plugin loading in `opencode.json`:

```json
{
  "plugin": ["file:///C:/dev/projects/github/opencode-intellisearch"]
}
```

## MCP Server Setup

Configure in `~/.config/opencode/opencode.json` or project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "deepwiki": {
      "url": "https://mcp.deepwiki.com/mcp"
    }
  }
}
```

## Verification

### Check Installation

**Bash:**
```bash
# Global installation
ls ~/.cache/opencode/node_modules/opencode-intellisearch/

# Local installation
ls node_modules/opencode-intellisearch/
```

**PowerShell:**
```powershell
# Global installation
Get-ChildItem $env:USERPROFILE\.cache\opencode\node_modules\opencode-intellisearch

# Local installation
Get-ChildItem node_modules\opencode-intellisearch
```

### Test in OpenCode

1. Start or restart OpenCode
2. Run a test query:

```bash
/search-intelligently How does React useEffect work?
```

### Check MCP Server Status

In OpenCode TUI:
```bash
/mcp status
```

Verify `deepwiki` server is running.

## Uninstallation

### CLI

```bash
# Interactive (asks for scope and confirmation)
bunx opencode-intellisearch uninstall

# Non-interactive, local scope
bunx opencode-intellisearch uninstall --scope local --force

# Also remove the package-managed config entries
bunx opencode-intellisearch uninstall --scope local --purge-config
```

By default, uninstall is conservative: it removes the manifest-recorded skill and command
files and the `opencode-intellisearch` entry from the `plugin` array, leaving an empty
`"plugin": []` behind (the documented manual state). The `permission.skill.intellisearch`
permission and the `deepwiki` MCP server entry are left untouched since they may hold
consumer edits.

Pass `--purge-config` to also remove those package-managed config entries: the
`opencode-intellisearch` plugin entry, `permission.skill.intellisearch`, and the
`mcp.deepwiki` server. Unrelated keys (other plugins, other permissions, other MCP
servers, comments, formatting) are never touched, and a config file that fails to parse
is preserved byte-for-byte.

### Manual

Remove from `opencode.json`:

```json
{
  "plugin": []
}
```

Or for local installs:

```bash
bun remove opencode-intellisearch
```

## Troubleshooting

### "bun command not found"

Install Bun from [bun.sh](https://bun.sh/):

```bash
# Linux/macOS
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

### "Plugin not loading"

1. Check OpenCode logs: `~/.local/share/opencode/log/`
2. Verify plugin is in `opencode.json` plugin array
3. Ensure Bun is installed and in PATH

### "deepWiki unavailable"

1. Verify deepWiki MCP server is configured in opencode.json
2. Check MCP server status with `/mcp status`
3. Restart OpenCode

### "All tools failed"

1. Rephrase your query
2. Check internet connectivity
3. Verify MCP server status

## Getting Help

- Check [GitHub Issues](https://github.com/expert-vision-software/opencode-intellisearch/issues)
- Review [OpenCode Documentation](https://opencode.ai/docs)
