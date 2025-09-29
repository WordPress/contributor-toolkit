# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"


& "prepare_windows_host_for_app_distribution.ps1" # via CI toolkit plugin. Amongst other things, it decrypts the certificate.pfx file.

Write-Host "--- :windows: Configure Windows code signing"
# First try to get the env var from the process environment
$windowsCertPassword = [System.Environment]::GetEnvironmentVariable('WINDOWS_CODE_SIGNING_CERT_PASSWORD', [System.EnvironmentVariableTarget]::Process)
If ([string]::IsNullOrEmpty($windowsCertPassword)) {
    # If it fails, try from the machine-wide environment
    $windowsCertPassword = [System.Environment]::GetEnvironmentVariable('WINDOWS_CODE_SIGNING_CERT_PASSWORD', [System.EnvironmentVariableTarget]::Machine)
}
If ([string]::IsNullOrEmpty($windowsCertPassword)) {
    Write-Host "[!] WINDOWS_CODE_SIGNING_CERT_PASSWORD is not set in either process or machine environments."
    Exit 1
} else {
    # set both System.Environment (for system access) and $env for node access
    [System.Environment]::SetEnvironmentVariable('CSC_KEY_PASSWORD', $windowsCertPassword, [System.EnvironmentVariableTarget]::Machine)
    $env:CSC_KEY_PASSWORD = $windowsCertPassword
    Write-Host "Environment variable CSC_KEY_PASSWORD set to the value of WINDOWS_CODE_SIGNING_CERT_PASSWORD."
}

# The pfx path comes from the `prepare_windows_host_for_app_distribution.ps1` script above.
# TODO: Move the set instruction in the script at the plugin level?
$certPath = (Convert-Path .\certificate.pfx)
If (Test-Path $certPath) {
    # set both System.Environment (for system access) and $env for node access
    [System.Environment]::SetEnvironmentVariable('CSC_LINK', $certPath, [System.EnvironmentVariableTarget]::Machine)
    $env:CSC_LINK = $certPath
    Write-Host "Environment variable CSC_LINK set to $certPath"
} else {
    Write-Host "[!] certificate.pfx file does not exist."
    Exit 1
}

# Import Pfx certificate in CI machine's cert store.
Import-PfxCertificate -FilePath $certPath -CertStoreLocation Cert:\LocalMachine\Root -Password (ConvertTo-SecureString -String $env:WINDOWS_CODE_SIGNING_CERT_PASSWORD -AsPlainText -Force)
