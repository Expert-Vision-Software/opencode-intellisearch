#!/usr/bin/env pwsh
# Isolated E2E Test Runner for IntelliSearch Plugin
# Usage: ./run-isolated-test.ps1 -Runs 3 -Model "minimax/MiniMax-M2.5" -PluginSource "C:/path/to/plugin"

param(
    [int]$Runs = 3,
    [string]$PluginSource = $PWD,
    [string]$ProjectDir = $PWD,
    [string]$QueryFile = "./tests/e2e/test-queries/graph-db-search.md",
    [string]$Model = "minimax/MiniMax-M2.5"
)

$ErrorActionPreference = "Stop"

# Get timestamp for this test batch
$BatchTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ResultsBaseDir = Join-Path $ProjectDir "tests/e2e/results"
$BatchDir = Join-Path $ResultsBaseDir $BatchTimestamp

Write-Host "=== IntelliSearch E2E Test Runner ===" -ForegroundColor Cyan
Write-Host "Batch: $BatchTimestamp"
Write-Host "Runs: $Runs"
Write-Host "Model: $Model"
Write-Host "Plugin: $PluginSource"
Write-Host ""

# Read test query
$QueryPath = Join-Path $ProjectDir $QueryFile
if (-not (Test-Path $QueryPath)) {
    Write-Error "Query file not found: $QueryPath"
    exit 1
}
$Query = Get-Content $QueryPath -Raw

# Create batch directory
New-Item -ItemType Directory -Force -Path $BatchDir | Out-Null

# Run tests
for ($i = 1; $i -le $Runs; $i++) {
    $RunTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $RunDir = Join-Path $BatchDir "run-$i-$RunTimestamp"
    $TestDir = Join-Path $env:TEMP "opencode-test-$RunTimestamp"
    
    Write-Host "Run $i/$Runs..." -ForegroundColor Yellow
    
    # Create minimal isolated cache dir (for version marker only)
    # Keep XDG_DATA_HOME and XDG_CONFIG_HOME pointing to real dirs for sessions/auth
    $XDG_CACHE_HOME = Join-Path $TestDir "cache"
    New-Item -ItemType Directory -Force -Path $XDG_CACHE_HOME | Out-Null

    # Skip database migration by writing version marker
    $VersionFile = Join-Path $XDG_CACHE_HOME "opencode/version"
    $VersionDir = Split-Path $VersionFile -Parent
    New-Item -ItemType Directory -Force -Path $VersionDir | Out-Null
    Set-Content -Path $VersionFile -Value "21" -NoNewline -Encoding UTF8

    # Verify before running
    Write-Host "  Version file: $VersionFile"

    # Create run output directory
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

    # Only override cache dir - keep real data/config for sessions and auth
    $env:XDG_CACHE_HOME = $XDG_CACHE_HOME
    
    # Disable features that might interfere with testing
    $env:OPENCODE_DISABLE_DEFAULT_PLUGINS = "true"
    $env:OPENCODE_DISABLE_LSP_DOWNLOAD = "true"
    $env:OPENCODE_DISABLE_SHARE = "true"
    $env:OPENCODE_DISABLE_AUTOUPDATE = "true"

    # Point to plugin source via config content (no file copy needed)
    $ConfigJson = '{"plugin": ["' + $PluginSource.Replace('\', '/') + '"]}'
    $env:OPENCODE_CONFIG_CONTENT = $ConfigJson
    
    $OutputFile = Join-Path $RunDir "output.json"
    $LogFile = Join-Path $RunDir "opencode.log"
    
    Write-Host "  Running opencode..."
    
    Push-Location $ProjectDir
    try {
        opencode run $Query --format json --model $Model 2>&1 | Tee-Object -FilePath $LogFile | Out-File -FilePath $OutputFile
    }
    catch {
        Write-Warning "Run $i failed: $_"
        $_ | Out-File -FilePath (Join-Path $RunDir "error.log")
    }
    finally {
        Pop-Location
    }
    
    Write-Host "  Output: $RunDir" -ForegroundColor Green
    
    # Cleanup temp directory
    Remove-Item -Path $TestDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "=== Collecting Metrics ===" -ForegroundColor Cyan

# Run metrics collection
Push-Location $ProjectDir
try {
    bun run tests/e2e/metrics/collect-tokens.ts $BatchDir
    bun run tests/e2e/metrics/compare-runs.ts $BatchDir
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Green
Write-Host "Results: $BatchDir"
Write-Host "  - token-metrics.json"
Write-Host "  - consistency-report.json"
