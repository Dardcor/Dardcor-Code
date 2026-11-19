





[CmdletBinding()]
param(
    [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path,
    [string]$OutDir = 'C:\temp\oss-local',
    [string]$CgNotice = '',
    [switch]$SkipScan
)

$ErrorActionPreference = 'Stop'

$ossDir     = Join-Path $RepoRoot 'build\azure-pipelines\oss'
$cglicenses = Join-Path $RepoRoot 'cglicenses.json'
$extNotices = Join-Path $OutDir 'ext-notices.txt'
$presence   = "$extNotices.presence.json"
$newNotice  = Join-Path $OutDir 'ThirdPartyNotices.new.txt'
$runLog     = Join-Path $OutDir 'run.log'

if (-not (Test-Path $ossDir))     { throw "OSS scripts not found at $ossDir" }
if (-not (Test-Path $cglicenses)) { throw "cglicenses.json not found at $cglicenses" }
if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
    Write-Warning "No node_modules at $RepoRoot - run 'npm i' there first or the presence index will be empty."
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Invoke-OssScript {
    param([string]$Script, [string[]]$ScriptArgs)
    Push-Location $ossDir
    try {
        Write-Host "==> tsx $Script $($ScriptArgs -join ' ')" -ForegroundColor Cyan
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & npx --yes tsx $Script @ScriptArgs 2>&1 | Tee-Object -FilePath $runLog -Append
        $code = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($code -ne 0) { throw "$Script exited with code $code" }
    }
    finally { Pop-Location }
}

Remove-Item $runLog -ErrorAction SilentlyContinue

if (-not $SkipScan) {
    $scanArgs = @('--repo', $RepoRoot, '--output', $extNotices)
    if ($CgNotice -and (Test-Path $CgNotice)) {
        $scanArgs += @('--cg', $CgNotice)
    }
    Invoke-OssScript -Script 'scan-licenses.ts' -ScriptArgs $scanArgs
}
else {
    Write-Host "Skipping scan (reusing $extNotices)" -ForegroundColor Yellow
    if (-not (Test-Path $presence)) { Write-Warning "No presence file at $presence - merge cannot detect stale overrides." }
}

$mergeArgs = @('--extensions', $extNotices, '--cglicenses', $cglicenses, '--output', $newNotice)
if ($CgNotice -and (Test-Path $CgNotice)) {
    $mergeArgs += @('--cg', $CgNotice)
    Write-Host "Using CG base: $CgNotice" -ForegroundColor Green
}
else {
    Write-Warning "No CG cache (-CgNotice) - merging without a CG base. Inject/stale logic still validated."
}
$mergeArgs += '--provenance'
Invoke-OssScript -Script 'merge-notices.ts' -ScriptArgs $mergeArgs

Write-Host "`n===== LOCAL RUN SUMMARY =====" -ForegroundColor Magenta
$patterns = 'Presence index:|\+ injected:|\? stale:|\? unmatched:|overrides injected:|overrides stale|overrides unmatched|Total packages:'
Select-String -Path $runLog -Pattern $patterns | ForEach-Object { Write-Host "  $($_.Line.Trim())" }

if (Test-Path $presence) {
    $presenceCount = (Get-Content $presence -Raw | ConvertFrom-Json).Count
    Write-Host "`n  Presence file: $presence ($presenceCount packages)"
}
Write-Host "  NOTICE output: $newNotice"
Write-Host "  Full log:      $runLog"
Write-Host "=============================" -ForegroundColor Magenta
