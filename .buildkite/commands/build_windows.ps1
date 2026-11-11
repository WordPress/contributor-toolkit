$ErrorActionPreference = "Stop"

$signWindows = @("1", "true") -contains "$env:SIGN_WINDOWS_BUILD".Trim().ToLower()

if ($signWindows) {
  Write-Host "~~~ Setup code signing"
  & .buildkite/commands/setup_windows_code_signing.ps1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "~~~ SIGN_WINDOWS_BUILD is not set, building unsigned"
}

Write-Host "~~~ Install dependencies"
bash .buildkite/commands/install_node_dependencies.sh
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "~~~ Build Windows artifact"
npm run dist:win
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($signWindows) {
  Write-Host "~~~ Verify Azure Trusted Signing signature"
  Get-ChildItem dist\*.exe | ForEach-Object {
    & $env:SIGNTOOL_PATH verify /pa /v $_.FullName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
}
