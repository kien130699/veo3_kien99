$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $Root "vendor\gflow-cli"
$Tag = "v0.49.0"
$ExpectedCommit = "127c3cc873ca777d5744b0e94dc3dec22337efe9"

if (Test-Path $Vendor) {
  Write-Host "Removing existing vendor checkout: $Vendor"
  Remove-Item -Recurse -Force $Vendor
}

git clone --branch $Tag --depth 1 https://github.com/ffroliva/gflow-cli.git $Vendor
$Actual = (git -C $Vendor rev-parse HEAD).Trim()
if ($Actual -ne $ExpectedCommit) {
  throw "Pinned gflow-cli commit mismatch. Expected $ExpectedCommit, got $Actual"
}
Write-Host "Pinned gflow-cli $Tag at $Actual" -ForegroundColor Green
Write-Host "The web app uses its own Edge-9223 adapter; vendor source is retained for audit/reference."
