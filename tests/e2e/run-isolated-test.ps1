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
    
    # Create isolated XDG directories
    $XDG_DATA_HOME = Join-Path $TestDir "data"
    $XDG_CACHE_HOME = Join-Path $TestDir "cache"
    $XDG_CONFIG_HOME = Join-Path $TestDir "config"
    $XDG_STATE_HOME = Join-Path $TestDir "state"
    $OPENCODE_TEST_HOME = Join-Path $TestDir "home"
    
    @($XDG_DATA_HOME, $XDG_CACHE_HOME, $XDG_CONFIG_HOME, $XDG_STATE_HOME, $OPENCODE_TEST_HOME) | ForEach-Object {
        New-Item -ItemType Directory -Force -Path $_ | Out-Null
    }
    
    # Create plugin directory and copy plugin
    $PluginDir = Join-Path $XDG_CONFIG_HOME "opencode/plugins"
    New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
    
    Write-Host "  Copying plugin to isolated environment..."
    Copy-Item -Path $PluginSource -Destination $PluginDir -Recurse -Force
    
    # Create run output directory
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    
    # Set environment and run opencode
    $env:XDG_DATA_HOME = $XDG_DATA_HOME
    $env:XDG_CACHE_HOME = $XDG_CACHE_HOME
    $env:XDG_CONFIG_HOME = $XDG_CONFIG_HOME
    $env:XDG_STATE_HOME = $XDG_STATE_HOME
    $env:OPENCODE_TEST_HOME = $OPENCODE_TEST_HOME
    
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
