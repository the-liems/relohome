param(
    [Parameter(Mandatory=$true)][string]$ArchivePath,
    [string]$Destination = 'data/teammate-snapshot'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$targetRoot = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $targetRoot) {
    throw 'Destination already exists. Choose a new empty destination; existing data is never overwritten.'
}
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
try {
    $manifest = @($archive.Entries | Where-Object { $_.FullName -match '^[^/]+/SHA256SUMS.txt$' })
    if ($manifest.Count -ne 1) { throw 'Expected one root checksum manifest' }
    $prefix = $manifest[0].FullName.Substring(0, $manifest[0].FullName.LastIndexOf('/') + 1)
    $reader = [IO.StreamReader]::new($manifest[0].Open())
    try { $manifestText = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $hashes = @{}
    foreach ($line in ($manifestText -split "`n")) {
        if ($line.Trim() -match '^([a-fA-F0-9]{64})\s+\*?(.+)$') {
            $hashes[$Matches[2].Trim()] = $Matches[1]
        }
    }
    $selected = @($archive.Entries | Where-Object {
        $_.FullName.StartsWith($prefix) -and $_.Length -gt 0 -and
        $_.FullName.Substring($prefix.Length) -match '^(database/|Routing/|SHA256SUMS.txt$|README.md$|UPDATE-DATA.md$|source/.+/migrations/.+\.sql$)'
    })
    # Validate every destination before writing anything (zip-slip protection).
    foreach ($entry in $selected) {
        $relative = $entry.FullName.Substring($prefix.Length)
        $resolved = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
        if (-not $resolved.StartsWith($targetRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Unsafe archive path'
        }
        if ($relative -ne 'SHA256SUMS.txt' -and -not $hashes.ContainsKey($relative)) {
            throw "Missing checksum: $relative"
        }
    }
    New-Item -ItemType Directory -Path $targetRoot | Out-Null
    $verified = 0
    foreach ($entry in $selected) {
        $relative = $entry.FullName.Substring($prefix.Length)
        $resolved = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($resolved)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $resolved, $false)
        if ($relative -ne 'SHA256SUMS.txt') {
            if ((Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash -ne $hashes[$relative]) {
                throw "Checksum mismatch: $relative. Do not restore this snapshot."
            }
            $verified++
        }
    }
    Write-Output "Verified $verified files. Snapshot extracted without replacing current source code."
} finally { $archive.Dispose() }
