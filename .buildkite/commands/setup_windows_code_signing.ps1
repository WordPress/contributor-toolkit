# Configures Windows code signing via Azure Trusted Signing.
#
# `setup_azure_trusted_signing.ps1` (a8c-ci-toolkit) installs signtool + the Azure DLib and
# exports the env vars that `scripts/azure-sign.cjs` reads during `npm run dist:win`. It also runs
# a signing smoke test that fails here, with diagnostics, if the Azure credentials are wrong.
# Host prep (native compilation tools, Python, Windows 10 SDK) is pre-provisioned in the custom
# Windows AMI as of a8c-ci-toolkit 6.0.0, so there is no separate host-preparation step.

$ErrorActionPreference = "Stop"

& "setup_azure_trusted_signing.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
