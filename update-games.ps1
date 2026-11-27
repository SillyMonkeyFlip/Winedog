# WineDog - rebuild the games list (Games\games.json)
# Run by double-clicking "Update Games.bat" after adding or removing games.
#
# A game is any folder in Games that has an index.html. If a folder has no index.html,
# each folder inside it that does is a game (like "Baldis Basics\1.4.5").
# Names and icons you've edited in games.json are kept.

$ErrorActionPreference = 'Continue'
$root  = Split-Path -Parent $MyInvocation.MyCommand.Path
$games = Join-Path $root 'Games'
$out   = Join-Path $games 'games.json'

if (-not (Test-Path $games)) { Write-Host "No Games folder found at $games" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

# Keep anything already in games.json (custom names and icons).
# Pictures this script picked itself are marked "iconAuto" and get picked again each run,
# so dropping a new picture into a game's folder is enough. A picture you set by hand
# in games.json (remove "iconAuto" or set it to false) is always kept.
$existing = @{}
$firstAutoRun = $false
if (Test-Path $out) {
  try {
    $old = Get-Content $out -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($g in $old.games) { $existing[$g.path] = $g }
    # Older lists had no "iconAuto" marks; every picture in them was picked by this script.
    $firstAutoRun = -not ($old.games | Where-Object { $_.PSObject.Properties.Name -contains 'iconAuto' })
  } catch { Write-Host "  Couldn't read the old games.json, starting fresh." -ForegroundColor Yellow }
}

$imageExt = '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif'
$keywords = 'cover', 'icon', 'thumb', 'logo', 'splash', 'banner', 'poster', 'title', 'teaser', 'preview', 'card', 'capsule', 'header', 'screenshot'
# Pictures that are part of a game engine's loading screen, never the game's own picture.
$junk = 'gears|progress|loading|loader|spinner|y8-logo|unity-logo|sprite|atlas|tileset|tilesheet|font|button|btn|arrow|cursor|fullscreen|webgl-logo'

# Picks the best picture for a game. Lower score wins:
#   1. A picture you dropped straight into the game's folder (any name) beats anything deeper.
#   2. Within that, a file named like the game, then names like cover/icon/thumb/logo,
#      then favicons, then any other picture (largest first).
#   3. Pictures inside engine folders (TemplateData, Build) only win if nothing else exists.
function Find-Icon($dir) {
  $gname = ((Split-Path $dir -Leaf).ToLower() -replace '[^a-z0-9]', '')
  $best = $null; $bestScore = [double]::MaxValue; $bestSize = -1
  $files = Get-ChildItem -LiteralPath $dir -Recurse -File -Depth 2 -ErrorAction SilentlyContinue |
    Where-Object { $imageExt -contains $_.Extension.ToLower() }
  foreach ($f in $files) {
    $name = $f.Name.ToLower()
    $base = ([IO.Path]::GetFileNameWithoutExtension($name) -replace '[^a-z0-9]', '')
    $rel = $f.FullName.Substring($dir.Length + 1)
    $depth = ($rel.Split('\').Count - 1)
    if ($name -match $junk) { continue }
    if ($f.Length -lt 800) { continue }   # tiny files are dots and arrows, not covers

    if ($gname -and $base -eq $gname) { $tier = 1 }
    else {
      $tier = 5
      for ($i = 0; $i -lt $keywords.Count; $i++) { if ($name.Contains($keywords[$i])) { $tier = 2 + $i * 0.01; break } }
      if ($tier -eq 5 -and $name.StartsWith('favicon')) { $tier = 4 }
    }
    $score = $tier * 10
    # Favicons are tiny tab icons, so even in the top folder they rank like a deeper picture.
    $isFav = $name.StartsWith('favicon') -or $name.EndsWith('.ico')
    if ($depth -gt 0 -or $isFav) { $score += 50 + $depth }
    if ($rel.ToLower() -match '(^|\\)(templatedata\d*|build|lib|libs|node_modules|vendor)\\') { $score += 30 }
    if ($name.EndsWith('.ico') -or $name.EndsWith('.gif')) { $score += 1 }

    if ($score -lt $bestScore -or ($score -eq $bestScore -and $f.Length -gt $bestSize)) {
      $bestScore = $score; $bestSize = $f.Length; $best = $rel
    }
  }
  if ($best) { return ($best -replace '\\', '/') }
  return $null
}

function Pretty($folder) {
  $n = $folder -replace '[-_]', ' '
  if ($n -ceq $n.ToLower()) { $n = (Get-Culture).TextInfo.ToTitleCase($n) }
  return $n
}

$list = New-Object System.Collections.ArrayList
$found = 0; $added = 0

foreach ($top in Get-ChildItem -LiteralPath $games -Directory | Sort-Object Name) {
  $dirs = @()
  if (Test-Path -LiteralPath (Join-Path $top.FullName 'index.html')) { $dirs = @($top) }
  else { $dirs = Get-ChildItem -LiteralPath $top.FullName -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'index.html') } | Sort-Object Name }

  foreach ($d in $dirs) {
    $rel = $d.FullName.Substring($games.Length + 1) -replace '\\', '/'
    $found++
    if ($existing.ContainsKey($rel)) {
      $g = $existing[$rel]
      $icon = $g.icon
      $auto = $firstAutoRun -or ($g.PSObject.Properties.Name -contains 'iconAuto' -and $g.iconAuto)
      $missing = -not $icon -or -not (Test-Path -LiteralPath (Join-Path $d.FullName ($icon -replace '/', '\')))
      if ($auto -or $missing) {
        $newIcon = Find-Icon $d.FullName
        if ($newIcon -ne $icon) { Write-Host "  * $($g.name): picture $(if ($icon) { $icon } else { '(none)' }) -> $(if ($newIcon) { $newIcon } else { '(none)' })" -ForegroundColor DarkCyan }
        $icon = $newIcon; $auto = $true
      }
      [void]$list.Add([ordered]@{ name = $g.name; path = $rel; icon = $icon; iconAuto = $auto })
    } else {
      $name = if ($d -eq $top) { Pretty $top.Name } else { "$(Pretty $top.Name): $(Pretty $d.Name)" }
      [void]$list.Add([ordered]@{ name = $name; path = $rel; icon = (Find-Icon $d.FullName); iconAuto = $true })
      Write-Host "  + $name" -ForegroundColor Green
      $added++
    }
  }
}

$sorted = $list | Sort-Object { $_.name }
$json = [ordered]@{ games = @($sorted) } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding $false))

$gone = @($existing.Keys | Where-Object { $p = $_; -not ($list | Where-Object { $_.path -eq $p }) })
foreach ($p in $gone) { Write-Host "  - $($existing[$p].name) (folder no longer there)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  $found games listed ($added new, $($gone.Count) removed)." -ForegroundColor Cyan
Write-Host "  Pictures: drop an image straight into a game's folder and run this again; it's picked first."
Write-Host "  To rename a game or force a picture, edit Games\games.json (set iconAuto to false to keep your picture)."

Write-Host "  Commit and push in GitHub Desktop to put the changes online."
Write-Host ""
Read-Host "Press Enter to close"
