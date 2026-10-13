[CmdletBinding()]
param([int]$StartupTimeoutSeconds = 35)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pythonPath = Join-Path $repoRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Missing .venv. Install the project Python requirements first.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.env.local'))) {
    throw 'Missing .env.local. Do not reinitialize an existing database; check the local runbook.'
}
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'apps/web/dist/index.html'))) {
    throw 'Missing frontend build. At repository root, run npm ci and npm run build first.'
}
if ($StartupTimeoutSeconds -lt 1 -or $StartupTimeoutSeconds -gt 60) { throw 'StartupTimeoutSeconds must be 1-60.' }
Push-Location $repoRoot
try {
    $containers = @(& docker ps -a --format '{{.ID}} {{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready. Start Docker Desktop and retry.' }
    foreach ($row in $containers) {
        $parts = $row -split ' ', 2
        if ($parts.Count -eq 2 -and $parts[1] -match '^(lifeflow-integration-postgis(-\d+)?|lifeflow-postgis|lifeflow-routing-local-.+)$') {
            & docker start $parts[0] | Out-Null
            if ($LASTEXITCODE -ne 0) { throw ('Could not start container ' + $parts[1]) }
        }
    }
    # Only a read-only check. Schema migration/import requires a separate explicit command.
    $schemaReady = $false
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        & $pythonPath scripts/local-integration.py check
        if ($LASTEXITCODE -eq 0) { $schemaReady = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $schemaReady) { throw 'Database/schema preflight failed. Follow the message above; no service was started.' }

    $logsRoot = Join-Path $repoRoot 'data/local-mvp-logs'
    New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $services = @(
        @{ Name = 'location'; Port = 4300; Health = '/readyz'; Expected = 'ready' },
        @{ Name = 'platform'; Port = 4100; Health = '/health'; Expected = 'ok' },
        @{ Name = 'moving'; Port = 4400; Health = '/ready'; Expected = 'ok' },
        @{ Name = 'moving-api'; Port = 4200; Health = '/ready'; Expected = 'ok' },
        @{ Name = 'flight'; Port = 8765; Health = '/health'; Expected = 'ok' },
        @{ Name = 'payment'; Port = 8766; Health = '/health'; Expected = 'ok' },
        @{ Name = 'api'; Port = 8000; Health = '/health'; Expected = 'ok' },
        @{ Name = 'ui'; Port = 8503; Health = '/health'; Expected = 'ok' }
    )
    foreach ($service in $services) {
        $url = 'http://127.0.0.1:' + $service.Port + $service.Health
        $listeners = @(Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            try {
                $health = Invoke-RestMethod -Uri $url -TimeoutSec 3
                if ($health.status -ne $service.Expected) { throw 'Unexpected response' }
                # main's SQLite readiness contract is {status:ok}; older local builds
                # additionally identify service. Do not require the obsolete field.
                if ($service.Name -eq 'ui' -and $health.service -and $health.service -ne 'siu-web') { throw 'Unexpected service' }
            } catch { throw ('Port ' + $service.Port + ' is occupied but service readiness failed. Check that terminal; no process was killed.') }
            Write-Host ($service.Name + ': already running (restart its terminal after code changes).')
            continue
        }
        $stdoutPath = Join-Path $logsRoot ($runStamp + '-' + $service.Name + '.stdout.log')
        $stderrPath = Join-Path $logsRoot ($runStamp + '-' + $service.Name + '.stderr.log')
        $started = Start-Process -FilePath $pythonPath -ArgumentList @('-u', 'scripts/local-integration.py', $service.Name) `
            -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
        $ready = $false
        do {
            $started.Refresh()
            if ($started.HasExited) { break }
            try {
                $health = Invoke-RestMethod -Uri $url -TimeoutSec 2
                $ready = $health.status -eq $service.Expected
                if ($service.Name -eq 'ui' -and $health.service) { $ready = $ready -and $health.service -eq 'siu-web' }
            } catch { $ready = $false }
            if (-not $ready) { Start-Sleep -Milliseconds 300 }
        } while (-not $ready -and (Get-Date) -lt $deadline)
        if (-not $ready) {
            throw ($service.Name + ' did not become ready. Logs: ' + $stderrPath + ' and ' + $stdoutPath + '. No database was reset.')
        }
        Write-Host ($service.Name + ': ready; launcher PID ' + $started.Id)
    }
    Write-Host 'Open http://127.0.0.1:8503. Read-only mode; no booking or payment was submitted.'
    Write-Host ('Logs: ' + $logsRoot)
} finally { Pop-Location }
