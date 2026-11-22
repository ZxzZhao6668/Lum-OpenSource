param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $workspacePath 'runtime\launcher'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null
function Test-LocalService([int]$Port) {
  try { $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2; return $response.StatusCode -eq 200 } catch { return $false }
}
if (!(Test-Path -LiteralPath (Join-Path $workspacePath 'app\dist\index.html'))) { throw 'Missing writing app build: run npm run build in app.' }
if (!(Test-LocalService 5181)) {
  $scriptPath = Join-Path $PSScriptRoot 'startLum.ps1'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$scriptPath+'"')) -WindowStyle Hidden -WorkingDirectory $workspacePath -RedirectStandardOutput (Join-Path $logPath 'lum.out.log') -RedirectStandardError (Join-Path $logPath 'lum.err.log') | Out-Null
}
if (!(Test-LocalService 5178)) {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  Start-Process -FilePath $nodePath -ArgumentList @('--max-old-space-size=256','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5178','--strictPort') -WindowStyle Hidden -WorkingDirectory (Join-Path $workspacePath 'app') -RedirectStandardOutput (Join-Path $logPath 'writing.out.log') -RedirectStandardError (Join-Path $logPath 'writing.err.log') | Out-Null
}
for($attempt=0;$attempt -lt 30;$attempt++) {
  if((Test-LocalService 5178) -and (Test-LocalService 5181)){break}
  Start-Sleep -Milliseconds 500
}
if (!(Test-LocalService 5178) -or !(Test-LocalService 5181)) { throw "Startup failed. See logs: $logPath" }
if(!$NoBrowser){
  $edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  if(Test-Path -LiteralPath $edgePath){Start-Process -FilePath $edgePath -ArgumentList '--app=http://127.0.0.1:5178/'}else{Start-Process 'http://127.0.0.1:5178/'}
}
Write-Output 'Writing workspace ready: http://127.0.0.1:5178/'
