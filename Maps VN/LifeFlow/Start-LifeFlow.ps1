$ErrorActionPreference = 'Stop'

$rootPath = $PSScriptRoot
$mapPath = Join-Path $rootPath 'map-app'
$runtimePath = Join-Path $rootPath '.runtime'
$apiPidPath = Join-Path $runtimePath 'platform-api.pid'
$apiOutLog = Join-Path $runtimePath 'platform-api.out.log'
$apiErrorLog = Join-Path $runtimePath 'platform-api.error.log'
$apiHealthUrl = 'http://127.0.0.1:4100/health'
$containers = @('osrm-hcm', 'osrm-hanoi', 'osrm-danang')

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

function Test-PlatformApi {
    try {
        $health = Invoke-RestMethod -Uri $apiHealthUrl -TimeoutSec 2
        return $health.status -eq 'ok'
    }
    catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $mapPath)) {
    throw "LifeFlow map project not found: $mapPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $rootPath '.env'))) {
    throw "Missing $rootPath\.env. Create it from .env.example first."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker command not found. Start Docker Desktop and check WSL integration.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js and npm are required to start LifeFlow.'
}
if (-not (Test-Path -LiteralPath (Join-Path $rootPath 'node_modules'))) {
    throw "Backend dependencies are missing. Run npm install in $rootPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $mapPath 'node_modules'))) {
    throw "Frontend dependencies are missing. Run npm install in $mapPath"
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Desktop Engine is not running. Start Docker Desktop, then run this script again.'
}

Write-Host '[1/5] Starting isolated LifeFlow PostGIS...' -ForegroundColor Cyan
Set-Location -LiteralPath $rootPath
Invoke-Checked docker compose --env-file .env -f infra/compose.yaml up -d --wait postgis

Write-Host '[2/5] Starting the three existing OSRM containers...' -ForegroundColor Cyan
foreach ($container in $containers) {
    docker inspect $container *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Required OSRM container not found: $container"
    }
    Invoke-Checked docker start $container | Out-Null
}

Write-Host '[3/5] Building backend and applying checksum-protected migrations...' -ForegroundColor Cyan
Invoke-Checked npm run build
Invoke-Checked npm run db:migrate

Write-Host '[4/5] Starting Platform API at http://127.0.0.1:4100/ ...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
if (-not (Test-PlatformApi)) {
    $nodePath = (Get-Command node).Source
    $serverPath = Join-Path $rootPath 'platform-api\dist\server.js'
    $quotedServerPath = '"' + $serverPath + '"'
    $apiProcess = Start-Process -FilePath $nodePath -ArgumentList $quotedServerPath -WorkingDirectory $rootPath -WindowStyle Hidden -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrorLog -PassThru
    Set-Content -LiteralPath $apiPidPath -Value $apiProcess.Id -Encoding ascii

    $apiReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        if ($apiProcess.HasExited) {
            $details = if (Test-Path -LiteralPath $apiErrorLog) {
                Get-Content -LiteralPath $apiErrorLog -Raw
            } else {
                'No API error log was produced.'
            }
            throw "Platform API exited during startup. $details"
        }
        if (Test-PlatformApi) {
            $apiReady = $true
            break
        }
    }
    if (-not $apiReady) {
        throw "Platform API did not become healthy. See $apiErrorLog"
    }
}
else {
    Write-Host 'Platform API is already healthy; reusing it.' -ForegroundColor DarkGray
}

Write-Host '[5/5] Starting LifeFlow Map at http://127.0.0.1:5173/' -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop the frontend. Run Stop-LifeFlow.ps1 to stop API, OSRM and PostGIS.' -ForegroundColor DarkGray
Set-Location -LiteralPath $mapPath
Invoke-Checked npm run dev:lifeflow
