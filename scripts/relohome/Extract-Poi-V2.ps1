$ErrorActionPreference = 'Stop'

$repoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

$rawPath = [System.IO.Path]::GetFullPath((Join-Path $repoPath 'Maps VN\Raw\vietnam-260922.osm.pbf'))
$filterPath = Join-Path $repoPath 'config\location\poi-tags-filter.txt'
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $repoPath 'Maps VN\Extracts\POI\vietnam-260922'))
$extractPath = Join-Path $outputDirectory 'vietnam-pois-v2.osm.pbf'
$sequencePath = Join-Path $outputDirectory 'vietnam-pois-v2.geojsonseq'

if (-not (Test-Path -LiteralPath $rawPath)) { throw "Raw PBF missing: $rawPath" }
if (-not (Test-Path -LiteralPath $filterPath)) { throw "POI filter missing: $filterPath" }
if ((Test-Path -LiteralPath $extractPath) -or (Test-Path -LiteralPath $sequencePath)) {
    throw "Output already exists in $outputDirectory. Inspect it before rerunning."
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function Convert-ToWslPath([string]$windowsPath) {
    $result = & wsl -d Ubuntu-24.04 -- wslpath -a -u $windowsPath
    if ($LASTEXITCODE -ne 0) { throw "Cannot resolve WSL path: $windowsPath" }
    return ($result | Select-Object -First 1).Trim()
}

$rawWsl = Convert-ToWslPath $rawPath
$filterWsl = Convert-ToWslPath $filterPath
$extractWsl = Convert-ToWslPath $extractPath
$sequenceWsl = Convert-ToWslPath $sequencePath

& wsl -d Ubuntu-24.04 -- osmium tags-filter --expressions $filterWsl $rawWsl -o $extractWsl
if ($LASTEXITCODE -ne 0) { throw 'Osmium tags-filter failed.' }

& wsl -d Ubuntu-24.04 -- osmium export -f geojsonseq -u type_id $extractWsl -o $sequenceWsl
if ($LASTEXITCODE -ne 0) { throw 'Osmium export failed; inspect the extract before retrying.' }

Get-Item -LiteralPath $extractPath, $sequencePath | ForEach-Object {
    Write-Output ("$($_.FullName) $($_.Length) bytes")
}
Get-FileHash -Algorithm SHA256 -LiteralPath $rawPath, $extractPath, $sequencePath | ForEach-Object {
    Write-Output ("$($_.Path) SHA256=$($_.Hash)")
}
