# Usage:
#   .\watch-css-copy.ps1 -Source "C:\\path\\to\\source.css" -Destination "C:\\path\\to\\dest.css"
# Watches the source file and copies it to destination on changes.

param(
  [Parameter(Mandatory=$true)]
  [string]$Source,
  [Parameter(Mandatory=$true)]
  [string]$Destination
)

function Copy-With-Retry {
  param([string]$src, [string]$dst, [int]$retries = 5, [int]$delayMs = 200)
  for($i=0; $i -lt $retries; $i++){
    try {
      if(!(Test-Path (Split-Path -Parent $dst))){ New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null }
      Copy-Item -Path $src -Destination $dst -Force
      Write-Host (Get-Date -Format HH:mm:ss) "Copied" $src "->" $dst
      return
    } catch {
      Start-Sleep -Milliseconds $delayMs
    }
  }
  Write-Warning "Failed to copy after $retries attempts: $src -> $dst"
}

if(!(Test-Path $Source)){
  Write-Error "Source not found: $Source"; exit 1
}

# Initial copy
Copy-With-Retry -src $Source -dst $Destination

$srcDir = Split-Path -Parent $Source
$srcName = Split-Path -Leaf $Source

$fsw = New-Object IO.FileSystemWatcher $srcDir, $srcName
$fsw.IncludeSubdirectories = $false
$fsw.EnableRaisingEvents = $true

$action = {
  param($src, $dst)
  Start-Sleep -Milliseconds 150  # slight debounce
  if(Test-Path $src){ Copy-With-Retry -src $src -dst $dst }
}

$handlers = @()
$handlers += Register-ObjectEvent $fsw Changed -Action { & $action $using:Source $using:Destination }
$handlers += Register-ObjectEvent $fsw Created -Action { & $action $using:Source $using:Destination }
$handlers += Register-ObjectEvent $fsw Renamed -Action { & $action $using:Source $using:Destination }

Write-Host "Watching $Source -> $Destination (Ctrl+C to stop)"
try {
  while ($true) { Wait-Event -Timeout 5 | Out-Null }
} finally {
  foreach($h in $handlers){ Unregister-Event -SourceIdentifier $h.Name -ErrorAction SilentlyContinue }
  $fsw.Dispose()
}

