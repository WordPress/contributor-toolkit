$ErrorActionPreference = "Stop"

$signWindows = @("1", "true") -contains "$env:SIGN_WINDOWS_BUILD".Trim().ToLower()
$canShip = $env:BUILDKITE_BRANCH -eq "trunk" -or $env:BUILDKITE_BRANCH -like "release/*"

if ($canShip -and -not $signWindows) {
  Write-Host "Error: trunk and release/* builds can ship, so they must be signed. Set SIGN_WINDOWS_BUILD." -ForegroundColor Red
  exit 1
}

if ($signWindows) {
  Write-Host "~~~ Setup code signing"
  & .buildkite/commands/setup_windows_code_signing.ps1
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} else {
  Write-Host "~~~ SIGN_WINDOWS_BUILD is not set, building unsigned"
}

Write-Host "~~~ Install dependencies"
bash .buildkite/commands/install_node_dependencies.sh
if ($LASTEXITCODE) { exit $LASTEXITCODE }

Write-Host "~~~ Build Windows artifact"
npm run dist:win
if ($LASTEXITCODE) { exit $LASTEXITCODE }

if ($signWindows) {
  Write-Host "~~~ Verify Azure Trusted Signing signature"
  Get-ChildItem dist\*.exe | ForEach-Object {
    & $env:SIGNTOOL_PATH verify /pa /v $_.FullName
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
  }
}
