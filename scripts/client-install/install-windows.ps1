# MusicStreamService — установка desktop (исходники GitHub Release + локальная сборка)
param(
    [string]$Tag = "",
    [switch]$Update,
    [string]$ApiUrl = "",
    [switch]$RunInstaller
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"

$installRoot = Get-MssInstallRoot
$workDir = Join-Path $installRoot "work"
New-Item -ItemType Directory -Force -Path $installRoot, $workDir | Out-Null

if (-not $ApiUrl -and $env:API_PUBLIC_URL) { $ApiUrl = $env:API_PUBLIC_URL }
if (-not $ApiUrl) {
    $ApiUrl = Read-Host "URL API (например https://example.com/MusicStreamService или http://localhost:3001)"
}
$ApiUrl = $ApiUrl.TrimEnd('/')

Write-Step "MusicStreamService — установка для Windows"
Ensure-Node
Ensure-Pnpm

$release = Get-ReleaseInfo $(if ($Tag) { $Tag } else { $null })
$tagName = $release.tag_name
$srcDir = Join-Path $installRoot "src\$tagName"

if ((Test-Path $srcDir) -and -not $Update) {
    Write-Host "Уже есть $srcDir — используйте -Update для пересборки" -ForegroundColor Yellow
} else {
    $zip = Download-ReleaseZipball $release $workDir
    if (Test-Path $srcDir) { Remove-Item -Recurse -Force $srcDir }
    $extracted = Expand-Zipball $zip (Join-Path $workDir "extract-$tagName")
    Move-Item -Force $extracted $srcDir
}

Write-Step "Зависимости (pnpm install)"
Push-Location $srcDir
try {
    $env:API_PUBLIC_URL = $ApiUrl
    pnpm install --frozen-lockfile
    Write-Step "Сборка monorepo"
    pnpm build
    Write-Step "Сборка установщика Windows (electron-builder)"
    Push-Location (Join-Path $srcDir "apps\desktop")
    try {
        $env:PACK_SKIP_RELEASES = "1"
        node scripts/pack-win.cjs
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}

$exe = Join-Path $srcDir "apps\desktop\release\MusicStreamService-setup.exe"
if (-not (Test-Path $exe)) {
    $fallback = Get-ChildItem (Join-Path $srcDir "apps\desktop\release") -Filter "*.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "uninstall" } |
        Select-Object -First 1
    if ($fallback) { $exe = $fallback.FullName }
}
if (-not (Test-Path $exe)) { throw "Установщик не найден после сборки" }

$bootstrapDest = Join-Path $installRoot "bootstrap"
New-Item -ItemType Directory -Force -Path $bootstrapDest | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "*") -Destination $bootstrapDest -Recurse -Force

Save-InstalledMeta $installRoot @{
    tag       = $tagName
    apiUrl    = $ApiUrl
    sourceDir = $srcDir
    installer = $exe
    updatedAt = (Get-Date).ToString("o")
}

Write-Host ""
Write-Host "Готово: $exe" -ForegroundColor Green
if ($RunInstaller -or ((Read-Host "Запустить установщик сейчас? [Y/n]") -ne "n")) {
    Start-Process -FilePath $exe -Wait
}
