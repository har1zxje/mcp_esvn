param()

$ErrorActionPreference = 'Stop'

function Import-ProjectEnv([string]$path) {
  foreach ($line in Get-Content -LiteralPath $path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $parts = $trimmed -split '=', 2
    if ($parts.Count -ne 2 -or $parts[0] -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      throw "Invalid environment entry in $path"
    }
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Import-ProjectEnv (Join-Path $projectRoot 'hrm-server/.env')
Import-ProjectEnv (Join-Path $projectRoot 'be/.env')
$env:MCP_ENABLED_SERVERS = 'hrm'

foreach ($name in 'MCP_INTERNAL_TOKEN', 'HRM_INTERNAL_TOKEN') {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
    throw "Missing required configuration: $name"
  }
}

dotnet run --project (Join-Path $PSScriptRoot 'HrmMCPServer.csproj')
