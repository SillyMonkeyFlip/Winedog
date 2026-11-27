# WineDog - rebuild the tab presets list ("Tab Presets\presets.json")
# Run by double-clicking "Update Tab Presets.bat" after adding or removing presets.
#
# Each folder inside "Tab Presets" is one preset:
#   the folder name is the tab name, and the picture inside is the tab icon.

$ErrorActionPreference = 'Continue'
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$presets = Join-Path $root 'Tab Presets'
$out     = Join-Path $presets 'presets.json'

if (-not (Test-Path -LiteralPath $presets)) {
  New-Item -ItemType Directory -Path $presets | Out-Null
  Write-Host "  Made the 'Tab Presets' folder. Add a folder in it for each preset, then run this again." -ForegroundColor Yellow
}

$imageExt = '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif'
# Best picture first: png/svg/webp look sharpest as tab icons, then the biggest file.
$extRank = @{ '.png' = 0; '.svg' = 0; '.webp' = 1; '.ico' = 2; '.jpg' = 3; '.jpeg' = 3; '.avif' = 3; '.gif' = 4 }

$list = New-Object System.Collections.ArrayList
$skipped = 0
foreach ($d in Get-ChildItem -LiteralPath $presets -Directory | Sort-Object Name) {
  $img = Get-ChildItem -LiteralPath $d.FullName -File -Recurse -Depth 1 -ErrorAction SilentlyContinue |
    Where-Object { $imageExt -contains $_.Extension.ToLower() } |
    Sort-Object @{ Expression = { $extRank[$_.Extension.ToLower()] } }, @{ Expression = { $_.Length }; Descending = $true } |
    Select-Object -First 1
  if (-not $img) {
    Write-Host "  ! $($d.Name): no picture in this folder, skipped" -ForegroundColor Yellow
    $skipped++
    continue
  }
  $rel = $img.FullName.Substring($presets.Length + 1) -replace '\\', '/'
  [void]$list.Add([ordered]@{ name = $d.Name; icon = $rel })
  Write-Host "  + $($d.Name)  ($rel)" -ForegroundColor Green
}

$json = [ordered]@{ presets = @($list) } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "  $($list.Count) presets listed$(if ($skipped) { ", $skipped skipped (no picture)" })." -ForegroundColor Cyan
Write-Host "  They show up in Settings > Tab look. Commit and push in GitHub Desktop to put them online."
Write-Host ""
Read-Host "Press Enter to close"
