# Stop script execution when a non-terminating error occurs
$ErrorActionPreference = "Stop"

& "prepare_windows_host_for_app_distribution.ps1" # via CI toolkit plugin. Amongst other things, it decrypts the certificate.pfx file.

Write-Host "--- :windows: Configure Windows code signing"

########################################################
# Set CSC_KEY_PASSWORD env var
########################################################
$windowsCertPassword = $env:WINDOWS_CODE_SIGNING_CERT_PASSWORD
If ([string]::IsNullOrEmpty($windowsCertPassword)) {
    Write-Host "[!] WINDOWS_CODE_SIGNING_CERT_PASSWORD env var is not set."
    Exit 1
} 
# set both System.Environment (for system access) and $env for node access
[System.Environment]::SetEnvironmentVariable('CSC_KEY_PASSWORD', $windowsCertPassword, [System.EnvironmentVariableTarget]::Machine)
$env:CSC_KEY_PASSWORD = $windowsCertPassword
Write-Host "Environment variable CSC_KEY_PASSWORD set to the value of WINDOWS_CODE_SIGNING_CERT_PASSWORD."


########################################################
# Set CSC_LINK env var
########################################################
$certPath = (Convert-Path .\certificate.pfx) # The pfx file was downloaded during `prepare_windows_host_for_app_distribution.ps1` script above.
If (-Not (Test-Path $certPath)) {
    Write-Host "[!] certificate.pfx file does not exist."
    Exit 1
}
# set both System.Environment (for system access) and $env for node access
[System.Environment]::SetEnvironmentVariable('CSC_LINK', $certPath, [System.EnvironmentVariableTarget]::Machine)
$env:CSC_LINK = $certPath
Write-Host "Environment variable CSC_LINK set to $certPath"


########################################################
# Import Pfx certificate in CI machine's cert store.
########################################################
Import-PfxCertificate -FilePath $certPath -CertStoreLocation Cert:\LocalMachine\Root -Password (ConvertTo-SecureString -String $env:WINDOWS_CODE_SIGNING_CERT_PASSWORD -AsPlainText -Force)
