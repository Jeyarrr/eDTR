$ErrorActionPreference = 'Stop'
$credential = Read-Host 'Enter the PostgreSQL 18 password for postgres (typing is hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
try {
  $env:EDTR_TARGET_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  node scripts/move-database.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. See the message above.' }
} finally {
  Remove-Item Env:EDTR_TARGET_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
