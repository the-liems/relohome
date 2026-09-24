$ErrorActionPreference = 'Stop'

$rootPath = $PSScriptRoot
$apiPidPath = Join-Path $rootPath '.runtime\platform-api.pid'
$containers = @('osrm-hcm', 'osrm-hanoi', 'osrm-danang')

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
        docker compose --env-file .env -f infra/compose.yaml stop postgis
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to stop the LifeFlow PostGIS container.'
        }
        Write-Host 'Stopped LifeFlow OSRM and PostGIS containers. No data was deleted.' -ForegroundColor Green
    }
    else {
        Write-Warning 'Docker Engine is not available; Docker containers were not changed.'
    }
}
