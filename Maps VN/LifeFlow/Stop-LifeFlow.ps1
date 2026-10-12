$ErrorActionPreference = 'Stop'

$rootPath = $PSScriptRoot
$apiPidPath = Join-Path $rootPath '.runtime\platform-api.pid'
$mapPidPath = Join-Path $rootPath '.runtime\map-app.pid'
$containers = @(
    'lifeflow-osrm-hcm-driving', 'lifeflow-osrm-hanoi-driving', 'lifeflow-osrm-danang-driving',
    'lifeflow-osrm-hcm-walking', 'lifeflow-osrm-hanoi-walking', 'lifeflow-osrm-danang-walking',
    'lifeflow-osrm-hcm-motorcycle', 'lifeflow-osrm-hanoi-motorcycle', 'lifeflow-osrm-danang-motorcycle'
)

if (Test-Path -LiteralPath $apiPidPath) {
    $apiPid = [int](Get-Content -LiteralPath $apiPidPath -Raw)
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $apiPid" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.CommandLine -like '*platform-api*dist*server.js*') {
        Stop-Process -Id $apiPid
        Write-Host 'Stopped LifeFlow Platform API.' -ForegroundColor Green
    }
    elseif ($processInfo) {
        Write-Warning "PID $apiPid no longer belongs to the LifeFlow API; it was not stopped."
    }
    Remove-Item -LiteralPath $apiPidPath -Force
}

if (Test-Path -LiteralPath $mapPidPath) {
    $mapPid = [int](Get-Content -LiteralPath $mapPidPath -Raw)
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $mapPid" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.CommandLine -like '*vite*') {
        Stop-Process -Id $mapPid
        Write-Host 'Stopped LifeFlow Map frontend.' -ForegroundColor Green
    }
    elseif ($processInfo) {
        Write-Warning "PID $mapPid no longer belongs to the LifeFlow Map; it was not stopped."
    }
    Remove-Item -LiteralPath $mapPidPath -Force
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        foreach ($container in $containers) {
            docker inspect $container *> $null
            if ($LASTEXITCODE -eq 0) {
                docker stop $container | Out-Null
            }
        }
        Set-Location -LiteralPath $rootPath
        docker compose --env-file ../../.env.local -f infra/compose.yaml stop postgis
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to stop the LifeFlow PostGIS container.'
        }
        Write-Host 'Stopped LifeFlow OSRM and PostGIS containers. No data was deleted.' -ForegroundColor Green
    }
    else {
        Write-Warning 'Docker Engine is not available; Docker containers were not changed.'
    }
}
