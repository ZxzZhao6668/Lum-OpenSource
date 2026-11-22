$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $workspaceRoot 'vendor\lum'
if (!(Test-Path -LiteralPath (Join-Path $sourceRoot 'build\web\index.html'))) {
  throw 'Lum 画布尚未构建，请先构建 Web。'
}
if (!$env:LUM_DATA_DIR) {
  if ($env:TOONFLOW_DATA_DIR) { $env:LUM_DATA_DIR = $env:TOONFLOW_DATA_DIR }
  elseif (Test-Path -LiteralPath (Join-Path $workspaceRoot 'runtime\toonflow')) { $env:LUM_DATA_DIR = Join-Path $workspaceRoot 'runtime\toonflow' }
  else { $env:LUM_DATA_DIR = Join-Path $workspaceRoot 'runtime\lum' }
}
if (!$env:LUM_SERVER_PORT) { $env:LUM_SERVER_PORT = if ($env:TOONFLOW_SERVER_PORT) { $env:TOONFLOW_SERVER_PORT } else { '5181' } }
if (!$env:LUM_SERVER_HOST) { $env:LUM_SERVER_HOST = if ($env:TOONFLOW_SERVER_HOST) { $env:TOONFLOW_SERVER_HOST } else { '127.0.0.1' } }
$env:TOONFLOW_DATA_DIR = $env:LUM_DATA_DIR
$env:TOONFLOW_SERVER_HOST = $env:LUM_SERVER_HOST
$env:TOONFLOW_SERVER_PORT = $env:LUM_SERVER_PORT
$env:NODE_ENV = 'dev'
& bun run (Join-Path $sourceRoot 'apps\server\src\index.ts')
exit $LASTEXITCODE
