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
$existing = @{}
if (Test-Path $out) {
  try {
    $old = Get-Content $out -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($g in $old.games) { $existing[$g.path] = $g }
  } catch { Write-Host "  Couldn't read the old games.json, starting fresh." -ForegroundColor Yellow }
}

$imageExt = '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico'
$priority = 'cover', 'icon', 'thumb', 'splash', 'logo', 'images', 'teaser', 'screenshot'

function Find-Icon($dir) {
  $gname = ((Split-Path $dir -Leaf).ToLower() -replace '[ \-_]', '')
  $best = $null; $bestScore = [double]::MaxValue
  $files = Get-ChildItem -LiteralPath $dir -Recurse -File -Depth 2 -ErrorAction SilentlyContinue |
    Where-Object { $imageExt -contains $_.Extension.ToLower() }
  foreach ($f in $files) {
    $name = $f.Name.ToLower()
    $base = ([IO.Path]::GetFileNameWithoutExtension($name) -replace '[ \-_]', '')
    $rel = $f.FullName.Substring($dir.Length + 1)
    $depth = ($rel.Split('\').Count - 1)
    if ($name.StartsWith('favicon')) { $p = 50 }
    elseif ($base -eq $gname) { $p = 0.5 }
    else {
      $p = 99
      for ($i = 0; $i -lt $priority.Count; $i++) { if ($name.Contains($priority[$i])) { $p = $i; break } }
    }
    if ($p -eq 99) { continue }
    $score = $p * 10 + $depth + $(if ($name.EndsWith('.ico') -or $name.EndsWith('.gif')) { 0.5 } else { 0 })
    if ($score -lt $bestScore) { $bestScore = $score; $best = $rel }
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
      # If the saved icon file is gone, pick a new one.
      if ($g.icon -and -not (Test-Path -LiteralPath (Join-Path $d.FullName ($g.icon -replace '/', '\')))) { $g.icon = Find-Icon $d.FullName }
      [void]$list.Add([ordered]@{ name = $g.name; path = $rel; icon = $g.icon })
    } else {
      $name = if ($d -eq $top) { Pretty $top.Name } else { "$(Pretty $top.Name): $(Pretty $d.Name)" }
      [void]$list.Add([ordered]@{ name = $name; path = $rel; icon = (Find-Icon $d.FullName) })
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
Write-Host "  To rename a game or change its picture, edit Games\games.json, then run this again."
Write-Host "  Commit and push in GitHub Desktop to put the changes online."
Write-Host ""
Read-Host "Press Enter to close"
