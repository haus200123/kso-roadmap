param([Parameter(Mandatory=$true)][string]$Dest)
# Скачивает переносной Node.js (ветка 22 LTS) с nodejs.org и кладёт node.exe в $Dest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$arch = 'x64'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
elseif ($env:PROCESSOR_ARCHITECTURE -eq 'x86' -and -not $env:PROCESSOR_ARCHITEW6432) { $arch = 'x86' }

$base = 'https://nodejs.org/dist/latest-v22.x/'
$name = $null; $sums = $null
try {
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri ($base + 'SHASUMS256.txt')).Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
  $m = [regex]::Match($sums, "node-v[\d\.]+-win-$arch\.zip")
  if ($m.Success) { $name = $m.Value }
} catch { }
if (-not $name) {
  $base = 'https://nodejs.org/dist/v22.20.0/'
  $name = "node-v22.20.0-win-$arch.zip"
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri ($base + 'SHASUMS256.txt')).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
  } catch { $sums = $null }
}

$tmp = Join-Path $env:TEMP ('kso-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$zip = Join-Path $tmp $name
try {
  Write-Host "  Скачиваю $name ..."
  Invoke-WebRequest -UseBasicParsing -Uri ($base + $name) -OutFile $zip

  if ($sums) {
    $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1
    if ($line) {
      $expected = ($line.Trim() -split '\s+')[0].ToLower()
      $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
      if ($expected -ne $actual) { throw "Контрольная сумма не совпала — файл повреждён." }
      Write-Host "  Контрольная сумма совпала."
    }
  }

  Write-Host "  Распаковываю..."
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $exe = Get-ChildItem -Path $tmp -Recurse -Filter node.exe | Select-Object -First 1
  if (-not $exe) { throw "В архиве нет node.exe" }
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  Copy-Item -Path $exe.FullName -Destination (Join-Path $Dest 'node.exe') -Force
  Write-Host "  Готово: Node.js сохранён в $Dest"
} catch {
  Write-Host ("  Ошибка: " + $_.Exception.Message)
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
