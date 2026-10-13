param(
    [ValidateSet('all', 'driving', 'walking', 'motorcycle')]
    [string] $Profile = 'all'
)

$ErrorActionPreference = 'Stop'

$repoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$rootPath = $repoPath
$mapRoot = Join-Path $repoPath 'Maps VN'
$routingRoot = Join-Path $mapRoot 'Routing'
$buildImage = 'ghcr.io/project-osrm/osrm-backend:v6.0.0'
$legacyDrivingImage = 'ghcr.io/project-osrm/osrm-backend@sha256:8a1b1bc938412f15f9b5b32d794c4ec6bf4a85dfbbabfa0a014b70b187edb53b'
$motorcycleProfile = Join-Path $repoPath 'deploy\location\osrm\profiles\motorcycle.lua'

$cities = @(
    @{ Id = 'hcm'; Data = 'hcm'; DrivingPort = 5000; WalkingPort = 5010; MotorcyclePort = 5020; TestRoute = '106.7009,10.7769;106.7218,10.7952' },
    @{ Id = 'hanoi'; Data = 'hanoi'; DrivingPort = 5001; WalkingPort = 5011; MotorcyclePort = 5021; TestRoute = '105.8432,21.0278;105.8542,21.0350' },
    @{ Id = 'danang'; Data = 'danang'; DrivingPort = 5002; WalkingPort = 5012; MotorcyclePort = 5022; TestRoute = '108.2208,16.0678;108.2350,16.0600' }
)

$profiles = if ($Profile -eq 'all') { @('driving', 'walking', 'motorcycle') } else { @($Profile) }

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

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker command not found. Start Docker Desktop first.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Desktop Engine is not running.'
}
if (-not (Test-Path -LiteralPath $motorcycleProfile)) {
    throw "Motorcycle profile not found: $motorcycleProfile"
}

foreach ($city in $cities) {
    foreach ($routeProfile in $profiles) {
        $cityDirectory = Join-Path $routingRoot $city.Id
        $sourceDirectory = Join-Path $cityDirectory 'driving'
        $sourcePbf = Join-Path $sourceDirectory "$($city.Data).osm.pbf"
        $targetDirectory = Join-Path $cityDirectory $routeProfile
        $targetPbf = Join-Path $targetDirectory "$($city.Data).osm.pbf"
        $graphPath = Join-Path $targetDirectory "$($city.Data).osrm"

        if (-not (Test-Path -LiteralPath $sourcePbf)) {
            throw "Source PBF not found: $sourcePbf"
        }

        if ($routeProfile -ne 'driving' -and -not (Test-Path -LiteralPath "$graphPath.partition")) {
            if (Test-Path -LiteralPath $targetDirectory) {
                if (-not (Test-Path -LiteralPath $targetPbf)) {
                    throw "Incomplete target has no source PBF: $targetDirectory"
                }
                $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePbf).Hash
                $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetPbf).Hash
                if ($sourceHash -ne $targetHash) {
                    throw "Incomplete target uses a different PBF: $targetDirectory"
                }
                Write-Host "Resuming verified incomplete graph: $targetDirectory" -ForegroundColor Yellow
            }
            else {
                New-Item -ItemType Directory -Path $targetDirectory | Out-Null
                Copy-Item -LiteralPath $sourcePbf -Destination $targetPbf
            }

            Write-Host "Building $routeProfile graph for $($city.Id)..." -ForegroundColor Cyan

            $dataMount = "type=bind,source=$targetDirectory,target=/data"
            if ($routeProfile -eq 'walking') {
                Invoke-Checked -Command docker -Arguments @(
                    'run', '--rm', '-t', '--mount', $dataMount, $buildImage,
                    'osrm-extract', '-p', '/opt/foot.lua', "/data/$($city.Data).osm.pbf"
                )
            }
            else {
                $profileMount = "type=bind,source=$motorcycleProfile,target=/opt/motorcycle.lua,readonly"
                Invoke-Checked -Command docker -Arguments @(
                    'run', '--rm', '-t', '--mount', $dataMount, '--mount', $profileMount, $buildImage,
                    'osrm-extract', '-p', '/opt/motorcycle.lua', "/data/$($city.Data).osm.pbf"
                )
            }
            Invoke-Checked -Command docker -Arguments @(
                'run', '--rm', '-t', '--mount', $dataMount, $buildImage,
                'osrm-partition', "/data/$($city.Data).osrm"
            )
            Invoke-Checked -Command docker -Arguments @(
                'run', '--rm', '-t', '--mount', $dataMount, $buildImage,
                'osrm-customize', "/data/$($city.Data).osrm"
            )
        }
        elseif (Test-Path -LiteralPath "$graphPath.partition") {
            Write-Host "Reusing existing graph: $targetDirectory" -ForegroundColor DarkGray
        }
        else {
            throw "Driving graph not found: $graphPath.partition"
        }

        $container = "lifeflow-osrm-$($city.Id)-$routeProfile"
        $port = switch ($routeProfile) {
            'driving' { $city.DrivingPort }
            'walking' { $city.WalkingPort }
            'motorcycle' { $city.MotorcyclePort }
        }
        $existingContainer = docker container ls -a --filter "name=^/${container}$" --format '{{.Names}}'
        if ($existingContainer -ne $container) {
            $readOnlyMount = "type=bind,source=$targetDirectory,target=/data,readonly"
            $runtimeImage = if ($routeProfile -eq 'driving') { $legacyDrivingImage } else { $buildImage }
            Invoke-Checked -Command docker -Arguments @(
                'create', '--name', $container, '-p', "${port}:5000", '--mount', $readOnlyMount,
                $runtimeImage, 'osrm-routed', '--algorithm', 'mld', "/data/$($city.Data).osrm"
            )
        }
        Invoke-Checked -Command docker -Arguments @('start', $container) | Out-Null

        $ready = $false
        $healthUrl = "http://127.0.0.1:$port/route/v1/$routeProfile/$($city.TestRoute)?overview=false"
        for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
            try {
                $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
                if ($health.code -eq 'Ok') {
                    $ready = $true
                    break
                }
            }
            catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $ready) {
            throw "OSRM container did not become healthy: $container. Check: docker logs $container"
        }
        Write-Host "Ready: $container at http://127.0.0.1:$port" -ForegroundColor Green
    }
}

Write-Host 'All requested routing profiles are built and running. Existing graph files were not overwritten.' -ForegroundColor Green
