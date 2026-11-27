# WineDog - Cloudflare setup
# Run by double-clicking "Setup Cloudflare.bat". Safe to run again: it skips what's already done.

# 'Continue' because Windows PowerShell treats normal tool output on stderr as errors under 'Stop'.
$ErrorActionPreference = 'Continue'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$worker   = Join-Path $root 'worker'
$toml     = Join-Path $worker 'wrangler.toml'
$config   = Join-Path $root 'docs\assets\config.js'

function Step($n, $text) { Write-Host ""; Write-Host "[$n/7] $text" -ForegroundColor Cyan }
function Ok($text)       { Write-Host "  OK  $text" -ForegroundColor Green }
function Warn($text)     { Write-Host "  !   $text" -ForegroundColor Yellow }
function Fail($text)     { Write-Host ""; Write-Host "  X   $text" -ForegroundColor Red; Write-Host ""; Read-Host "Press Enter to close"; exit 1 }

function Wrangler {
  # Runs wrangler and returns its output as text, failing loudly on errors.
  $out = & npx.cmd --yes wrangler @args 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $out; Fail "wrangler $($args -join ' ') failed (see above)." }
  return $out
}

function ReadSecret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

function PutSecret($name, $value) {
  $out = $value | & npx.cmd --yes wrangler secret put $name 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $out; Fail "Could not save the $name secret." }
}

Write-Host ""
Write-Host "  WineDog - Cloudflare setup" -ForegroundColor White
Write-Host "  ---------------------------"

# 1. Node.js -------------------------------------------------------------------
Step 1 "Checking for Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Warn "Node.js is not installed."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $a = Read-Host "  Install it now with winget? (Y/n)"
    if ($a -eq '' -or $a -match '^[Yy]') {
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    }
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Install Node.js LTS from https://nodejs.org, then run this again."
  }
}
Ok "Node.js $(node -v)"

Set-Location $worker

# 2. Packages -----------------------------------------------------------------
Step 2 "Installing Cloudflare tools (first time takes a minute)"
& npm.cmd install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
Ok "Installed"

# 3. Login --------------------------------------------------------------------
Step 3 "Signing in to Cloudflare"
& npx.cmd --yes wrangler whoami 2>&1 | Out-String | Set-Variable who
if ($who -match 'not authenticated|You are not logged in') {
  Write-Host "  Your browser will open. Sign in to Cloudflare and click Allow."
  & npx.cmd --yes wrangler login
  if ($LASTEXITCODE -ne 0) { Fail "Cloudflare sign-in did not finish." }
}
Ok "Signed in"

# 4. Database -----------------------------------------------------------------
Step 4 "Setting up the database"
function FindDb {
  $list = Wrangler d1 list --json
  $i = $list.IndexOf('[')
  if ($i -lt 0) { Write-Host $list; Fail "Could not read your database list." }
  $json = $list.Substring($i)
  return ($json | ConvertFrom-Json) | Where-Object { $_.name -eq 'winedog' } | Select-Object -First 1
}
$db = FindDb
if (-not $db) {
  Wrangler d1 create winedog | Out-Null
  $db = FindDb
  if (-not $db) { Fail "The database was not created." }
  Ok "Created database"
} else {
  Ok "Database already exists"
}
$text = Get-Content $toml -Raw
$text = $text -replace 'database_id = "[^"]*"', "database_id = `"$($db.uuid)`""
Set-Content -Path $toml -Value $text -NoNewline
Wrangler d1 execute winedog --remote --file=schema.sql --yes | Out-Null
Ok "Tables ready"

# 5. Deploy -------------------------------------------------------------------
Step 5 "Publishing the Worker"
Write-Host "  (If Cloudflare asks you to pick a workers.dev name, type one and press Enter.)"
$outFile = Join-Path $env:TEMP 'winedog-deploy.json'
Remove-Item $outFile -ErrorAction SilentlyContinue
$env:WRANGLER_OUTPUT_FILE_PATH = $outFile
& npx.cmd --yes wrangler deploy
$code = $LASTEXITCODE
Remove-Item Env:WRANGLER_OUTPUT_FILE_PATH
if ($code -ne 0) { Fail "Publishing failed (see above)." }
$url = $null
if (Test-Path $outFile) {
  foreach ($line in Get-Content $outFile) {
    try { $entry = $line | ConvertFrom-Json } catch { continue }
    if ($entry.type -eq 'deploy' -and $entry.targets) {
      $url = @($entry.targets) | Where-Object { $_ -match 'workers\.dev' } | Select-Object -First 1
    }
  }
}
if (-not $url) { $url = (Read-Host "  Paste the https://...workers.dev address shown above").Trim() }
if ($url -notmatch '^https://') { $url = "https://$url" }
$url = $url.TrimEnd('/')
Ok "Live at $url"

# 6. Secrets ------------------------------------------------------------------
Step 6 "Passwords and keys"
$secrets = (Wrangler secret list)
if ($secrets -match '"ADMIN_PASSWORD"') {
  $a = Read-Host "  An admin password is already set. Change it? (y/N)"
  $setPw = $a -match '^[Yy]'
} else { $setPw = $true }
if ($setPw) {
  while ($true) {
    $p1 = ReadSecret "  Choose your /dev admin password"
    if ($p1.Length -lt 8) { Warn "Use at least 8 characters."; continue }
    $p2 = ReadSecret "  Type it again"
    if ($p1 -ne $p2) { Warn "Those didn't match. Try again."; continue }
    break
  }
  PutSecret 'ADMIN_PASSWORD' $p1
  Ok "Admin password saved"
}

$hasResend = $secrets -match '"RESEND_API_KEY"'
$msg = if ($hasResend) { "  Resend key is set. Paste a new one to replace it, or press Enter to keep it" } else { "  Paste your Resend API key to turn on emailing codes, or press Enter to skip" }
$key = ReadSecret $msg
if ($key) { PutSecret 'RESEND_API_KEY' $key; Ok "Email key saved" }
elseif (-not $hasResend) { Warn "Skipped. You can run this again later to add it." }

# 7. Point the site at the Worker -------------------------------------------------
Step 7 "Connecting the website to the Worker"
$c = Get-Content $config -Raw
$c = $c -replace "window\.WINEDOG_API = 'https://[^']*';", "window.WINEDOG_API = '$url';"
Set-Content -Path $config -Value $c -NoNewline
Ok "docs\assets\config.js now uses $url"

Write-Host ""
Write-Host "  All done." -ForegroundColor Green
Write-Host "  Next: commit and push in GitHub Desktop so the website picks up the new address."
Write-Host ""
Read-Host "Press Enter to close"
