function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-MssInstallRoot {
    Join-Path $env:LOCALAPPDATA "MusicStreamService"
}

function Get-GithubRepo {
    if ($env:MSS_GITHUB_REPO) { return $env:MSS_GITHUB_REPO.Trim() }
    return "mss/MusicStreamService"
}

function Invoke-GithubApi([string]$Path) {
    $headers = @{
        Accept        = "application/vnd.github+json"
        "User-Agent"  = "MusicStreamService-Installer"
    }
    if ($env:GITHUB_TOKEN) {
        $headers.Authorization = "Bearer $env:GITHUB_TOKEN"
    }
    Invoke-RestMethod -Uri "https://api.github.com/$Path" -Headers $headers
}

function Get-ReleaseInfo([string]$Tag) {
    $repo = Get-GithubRepo
    if ($Tag) {
        return Invoke-GithubApi "repos/$repo/releases/tags/$Tag"
    }
    return Invoke-GithubApi "repos/$repo/releases/latest"
}

function Save-InstalledMeta([string]$Root, [hashtable]$Meta) {
    $path = Join-Path $Root "installed.json"
    $Meta | ConvertTo-Json | Set-Content -Path $path -Encoding UTF8
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Node {
    if (Test-Command node) {
        $ver = (node -v) -replace '^v', ''
        $major = [int]($ver.Split('.')[0])
        if ($major -ge 20) { return }
    }
    Write-Host "Node.js 20+ не найден. Установите: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    throw "Node.js 20+ required"
}

function Ensure-Pnpm {
    if (Test-Command pnpm) { return }
    Write-Step "Включаем pnpm через Corepack"
    corepack enable
    corepack prepare pnpm@latest --activate
    if (-not (Test-Command pnpm)) { throw "pnpm не установлен" }
}

function Expand-Zipball([string]$ZipPath, [string]$DestDir) {
    Write-Step "Распаковка исходников"
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
    $inner = Get-ChildItem -Path $DestDir -Directory | Select-Object -First 1
    if (-not $inner) { throw "Пустой архив" }
    return $inner.FullName
}

function Download-ReleaseZipball([object]$Release, [string]$WorkDir) {
    Write-Step "Скачивание $($Release.tag_name)"
    $zipUrl = $Release.zipball_url
    $zipPath = Join-Path $WorkDir "source.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    return $zipPath
}
