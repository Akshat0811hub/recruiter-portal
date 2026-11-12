$ErrorActionPreference = "SilentlyContinue"

$workDir = "c:\Users\D552266\Desktop\Recruiter-portal"
$nodeCmd = "C:\Users\D552266\AppData\Roaming\Antigravity\bin\agy-node.cmd"
$logFile = Join-Path $workDir "data\server-autostart.log"

Set-Location $workDir
$env:PORT = "3000"

while ($true) {
  $listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "[$ts] Auto-starting Recruitment CRM Server on port 3000..."
    & $nodeCmd "$workDir\server.js" *>> $logFile
  }
  Start-Sleep -Seconds 5
}
