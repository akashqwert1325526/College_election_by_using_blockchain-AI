param(
  [int]$Port = 5500,
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "dev_https_server.py"
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Could not find dev_https_server.py next to this script."
}

Set-Location $Root
python $scriptPath $Port
