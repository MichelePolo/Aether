#requires -Version 5
# Aether installer (Windows). Usage:
#   powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"
$ErrorActionPreference = 'Stop'
$Tarball = 'https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz'
$MinNode = 20

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "aether-install: Node.js >= $MinNode is required but was not found. Install it (e.g. 'winget install OpenJS.NodeJS.LTS') then re-run."
  exit 1
}
$major = [int](((node -v) -replace '^v','') -split '\.')[0]
if ($major -lt $MinNode) {
  Write-Error "aether-install: Node.js >= $MinNode required, found $(node -v)."
  exit 1
}

Write-Host "Installing Aether ..."
npm install -g $Tarball
if ($LASTEXITCODE -ne 0) { Write-Error "aether-install: npm install failed."; exit 1 }

Write-Host "Starting Aether ..."
aether daemon start --open
