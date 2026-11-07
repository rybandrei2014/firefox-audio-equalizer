# Builds dist/firefox-audio-equalizer-<version>.xpi from the repo-root add-on.
#
# The add-on lives at the repo root (manifest.json, background.js, common/, content/, ui/,
# icons/), so this stages ONLY the runtime files into dist/staging/ (skipping test/, tools/,
# docs/, *.md, and the icon generator) and zips that. This keeps dev files out of the xpi and
# out of whatever web-ext submits to AMO.
#
# xpi = zip with forward-slash entry names; System.IO.Compression gives that control
# (Compress-Archive writes backslashes that some zip readers mishandle).
param(
  [switch]$SkipChecks
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw 'manifest.json has no version' }

if (-not $SkipChecks) {
  $js = @(
    'background.js', 'common/messages.js', 'common/eq.js',
    'content/eq-main.js', 'content/bridge.js',
    'ui/eq-widget.js', 'ui/popup.js', 'ui/options.js'
  )
  foreach ($f in $js) {
    node --check (Join-Path $root $f)
    if (-not $?) { throw "syntax error in $f" }
  }
  node (Join-Path $root 'test\eq-smoke.cjs')
  if (-not $?) { throw 'eq-smoke failed' }
}

if (Test-Path (Join-Path $root 'CHANGELOG.md')) {
  $hasEntry = Select-String -Path (Join-Path $root 'CHANGELOG.md') -Pattern "^\#\# \[v$version\]" -Quiet
  if (-not $hasEntry) { Write-Warning "CHANGELOG.md has no [v$version] section yet" }
}

# --- stage runtime files only ---
$stage = Join-Path $root 'dist\staging'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

foreach ($f in @('manifest.json', 'background.js')) {
  Copy-Item (Join-Path $root $f) (Join-Path $stage $f)
}
foreach ($dir in @('common', 'content', 'ui')) {
  Get-ChildItem -Recurse -File (Join-Path $root $dir) | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $dst = Join-Path $stage $rel
    New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
    Copy-Item $_.FullName $dst
  }
}
# icons: ship the PNGs the manifest references, not the generator script
New-Item -ItemType Directory -Force (Join-Path $stage 'icons') | Out-Null
Get-ChildItem (Join-Path $root 'icons') -Filter '*.png' | Copy-Item -Destination (Join-Path $stage 'icons')

# --- zip staging into the xpi ---
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist "firefox-audio-equalizer-$version.xpi"
Remove-Item $out -ErrorAction SilentlyContinue

$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Recurse -File $stage | ForEach-Object {
    $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel)
  }
} finally {
  $zip.Dispose()
}

"built $out ($([math]::Round((Get-Item $out).Length / 1KB, 1)) KB)"
