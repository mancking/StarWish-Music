# 向既有 v2.0.0 Release 刷新全部 7 个构建产物（幂等可续跑：已下载/已删除/已上传的步骤自动跳过）
$ErrorActionPreference = 'Stop'
$repo = 'mancking/StarWish-Music'
$relId = 416324698
$runId = 39134009061

$cred = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
$pat = ($cred | Select-String '^password=').Line.Substring(9)
$h = @{ Authorization = "Bearer $pat"; Accept = 'application/vnd.github+json' }

$staging = Join-Path $env:TEMP 'sw-release-sync'
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# 1) 下载 3 个 CI artifact 并解压（先取 302 直链，curl 带重试/断点续传，避免 IWR 单流中断）
$art = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/actions/runs/$runId/artifacts"
foreach ($a in $art.artifacts) {
  $dest = Join-Path $staging $a.name
  if ((Test-Path $dest) -and (Get-ChildItem $dest -Recurse -File | Select-Object -First 1)) {
    Write-Host "== skip download $($a.name) (already extracted)"
    continue
  }
  $zip = Join-Path $staging "$($a.name).zip"
  Write-Host "== downloading $($a.name) ($($a.size_in_bytes) bytes)"
  # 取 302 直链：curl 不跟随重定向，只读 Location（避免把 PAT 转发到签名存储域名）
  $u = "https://api.github.com/repos/$repo/actions/artifacts/$($a.id)/zip"
  $dump = & curl.exe --ssl-no-revoke -sS -D - -o NUL -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" $u
  if ($LASTEXITCODE -ne 0) { throw "redirect fetch failed for $($a.name)" }
  $line = $dump | Where-Object { $_ -match '^location:' } | Select-Object -First 1
  if (-not $line) { throw "no redirect location for $($a.name): $($dump -join ' ')" }
  $loc = $line.Substring(9).Trim()
  # 断点续传 + 网络抖动自动重试；416/残段等异常则清空重来一次
  & curl.exe --ssl-no-revoke -L -C - --retry 8 --retry-delay 3 --retry-all-errors -f -o $zip "$loc"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  resume attempt failed (exit $LASTEXITCODE), restarting clean"
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    & curl.exe --ssl-no-revoke -L --retry 8 --retry-delay 3 --retry-all-errors -f -o $zip "$loc"
    if ($LASTEXITCODE -ne 0) { throw "curl failed for $($a.name)" }
  }
  Expand-Archive -Path $zip -DestinationPath $dest -Force
  Remove-Item $zip -Force
  Get-ChildItem $dest -Recurse -File | ForEach-Object { "  extracted: $($_.FullName.Substring($staging.Length+1)) ($($_.Length))" }
}

# 2) 汇总 7 个最终文件（本地 3 个改名拷入 + CI 4 个按最终名拷入）
#    CI artifact 内部文件名带中文前缀（星河音乐-…），故按通配选择
function Stage([string]$pattern, [string]$destName, [string]$notLike = '') {
  $dest = Join-Path $staging $destName
  if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) { return }
  $src = Get-ChildItem $staging -Recurse -File |
    Where-Object { $_.Name -like $pattern -and $_.FullName -ne $dest -and ($notLike -eq '' -or $_.Name -notlike $notLike) } |
    Select-Object -First 1
  if (-not $src) { throw "not found in artifacts: $pattern" }
  Copy-Item $src.FullName $dest -Force
}
Copy-Item 'D:\music\app\dist\release\星河音乐-2.0.0-便携版.exe' (Join-Path $staging 'StarWish-2.0.0-win-portable.exe') -Force
Copy-Item 'D:\music\app\android\app\build\outputs\apk\release\app-release.apk' (Join-Path $staging 'StarWish-2.0.0-android.apk') -Force
Copy-Item 'D:\music\app\android\app\build\outputs\apk\debug\app-debug.apk' (Join-Path $staging 'StarWish-2.0.0-android-debug.apk') -Force
Stage '*.AppImage' 'StarWish-2.0.0-x86_64.AppImage'
Stage '*amd64.deb' 'starwish-music_2.0.0_amd64.deb'
Stage '*arm64-mac.zip' 'StarWish-2.0.0-arm64-mac.zip'
Stage '*-mac.zip' 'StarWish-2.0.0-x64-mac.zip' -notLike '*arm*'

$uploads = @(
  'StarWish-2.0.0-win-portable.exe',
  'StarWish-2.0.0-android.apk',
  'StarWish-2.0.0-android-debug.apk',
  'StarWish-2.0.0-x86_64.AppImage',
  'starwish-music_2.0.0_amd64.deb',
  'StarWish-2.0.0-arm64-mac.zip',
  'StarWish-2.0.0-x64-mac.zip'
)
foreach ($f in $uploads) {
  $p = Join-Path $staging $f
  if (-not (Test-Path $p)) { throw "staging missing: $f" }
  "staged: {0}  {1} bytes" -f $f, (Get-Item $p).Length
}

# 3) 删掉 Release 上同名旧 asset（同名不能并存；404 视为已删，幂等）
$rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/$relId"
foreach ($a in $rel.assets) {
  if ($uploads -contains $a.name) {
    Write-Host "== deleting old asset $($a.name) (id=$($a.id))"
    try {
      Invoke-RestMethod -Method Delete -Headers $h -Uri "https://api.github.com/repos/$repo/releases/assets/$($a.id)" | Out-Null
    } catch { Write-Host "  (delete ignored: $($_.Exception.Message))" }
  }
}

# 4) 上传 7 个新 asset（uploads.github.com 官方端点；curl 重试；已存在则跳过）
$rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/$relId"
$existing = @($rel.assets | ForEach-Object name)
foreach ($f in $uploads) {
  if ($existing -contains $f) { Write-Host "== skip upload $f (already on release)"; continue }
  $p = Join-Path $staging $f
  $ct = 'application/octet-stream'
  if ($f.EndsWith('.apk')) { $ct = 'application/vnd.android.package-archive' }
  $url = "https://uploads.github.com/repos/$repo/releases/$relId/assets?name=$([uri]::EscapeDataString($f))"
  Write-Host "== uploading $f ($((Get-Item $p).Length) bytes)"
  $out = & curl.exe --ssl-no-revoke -sS -L --retry 5 --retry-delay 3 --retry-all-errors -X POST `
    -H "Authorization: Bearer $pat" -H "Content-Type: $ct" --data-binary "@$p" $url
  if ($LASTEXITCODE -ne 0) { throw "upload failed: $f" }
  if ($out -notmatch '"id"') { throw "upload rejected: $f -> $out" }
  "  ok: $f"
}
Write-Host 'ALL DONE'

# 5) 终验：重新拉取 asset 清单
$rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/$relId"
$rel.assets | ForEach-Object { "final: {0}  {1} bytes  {2}" -f $_.name, $_.size, $_.created_at }
