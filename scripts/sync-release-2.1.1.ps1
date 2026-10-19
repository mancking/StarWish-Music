# 向 v2.1.1 Release 上传全部构建产物（Windows/Android 本地 + Linux/macOS 来自 CI run 39234663413）
$ErrorActionPreference = 'Stop'
$repo = 'mancking/StarWish-Music'
$runId = 39234663413
$V = '2.1.1'
$tag = "v$V"

$cred = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
$pat = ($cred | Select-String '^password=').Line.Substring(9)
$h = @{ Authorization = "Bearer $pat"; Accept = 'application/vnd.github+json' }

$staging = Join-Path $env:TEMP "sw-release-sync-$V"
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# 1) 下载 3 个 CI artifact 并解压（取 302 直链，curl 重试/断点续传）
$art = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/actions/runs/$runId/artifacts"
foreach ($a in $art.artifacts) {
  $dest = Join-Path $staging $a.name
  if ((Test-Path $dest) -and (Get-ChildItem $dest -Recurse -File | Select-Object -First 1)) {
    Write-Host "== skip download $($a.name) (already extracted)"; continue
  }
  $zip = Join-Path $staging "$($a.name).zip"
  Write-Host "== downloading $($a.name) ($($a.size_in_bytes) bytes)"
  $u = "https://api.github.com/repos/$repo/actions/artifacts/$($a.id)/zip"
  $dump = & curl.exe --ssl-no-revoke -sS -D - -o NUL -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" $u
  if ($LASTEXITCODE -ne 0) { throw "redirect fetch failed for $($a.name)" }
  $line = $dump | Where-Object { $_ -match '^location:' } | Select-Object -First 1
  if (-not $line) { throw "no redirect location for $($a.name)" }
  $loc = $line.Substring(9).Trim()
  & curl.exe --ssl-no-revoke -L -C - --retry 8 --retry-delay 3 --retry-all-errors -f -o $zip "$loc"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    & curl.exe --ssl-no-revoke -L --retry 8 --retry-delay 3 --retry-all-errors -f -o $zip "$loc"
    if ($LASTEXITCODE -ne 0) { throw "curl failed for $($a.name)" }
  }
  Expand-Archive -Path $zip -DestinationPath $dest -Force
  Remove-Item $zip -Force
}

# 2) 本地 3 个改名拷入 staging（便携版 + Setup 安装版 + Android release/debug）
Copy-Item "D:\music\app\dist\release\星河音乐-$V-便携版.exe" (Join-Path $staging "StarWish-$V-win-portable.exe") -Force
Copy-Item "D:\music\app\dist\release\StarWish-$V-Setup.exe" (Join-Path $staging "StarWish-$V-Setup.exe") -Force
Copy-Item 'D:\music\app\android\app\build\outputs\apk\release\app-release.apk' (Join-Path $staging "StarWish-$V-android.apk") -Force
Copy-Item 'D:\music\app\android\app\build\outputs\apk\debug\app-debug.apk' (Join-Path $staging "StarWish-$V-android-debug.apk") -Force

# 3) CI 4 个按最终名拷入（AppImage/deb 来自 linux，2 个 zip 来自 mac，按通配选择）
function Stage([string]$pattern, [string]$destName, [string]$notLike = '') {
  $dest = Join-Path $staging $destName
  if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) { return }
  $src = Get-ChildItem $staging -Recurse -File |
    Where-Object { $_.Name -like $pattern -and $_.FullName -ne $dest -and ($notLike -eq '' -or $_.Name -notlike $notLike) } |
    Select-Object -First 1
  if (-not $src) { throw "not found in artifacts: $pattern" }
  Copy-Item $src.FullName $dest -Force
}
Stage '*.AppImage' "StarWish-$V-x86_64.AppImage"
Stage '*amd64.deb' "starwish-music_${V}_amd64.deb"
Stage '*arm64*.zip' "StarWish-$V-arm64-mac.zip"
Stage '*.zip' "StarWish-$V-x64-mac.zip" -notLike '*arm*'

# 4) 汇总 8 个最终文件
$uploads = @(
  "StarWish-$V-win-portable.exe",
  "StarWish-$V-Setup.exe",
  "StarWish-$V-android.apk",
  "StarWish-$V-android-debug.apk",
  "StarWish-$V-x86_64.AppImage",
  "starwish-music_${V}_amd64.deb",
  "StarWish-$V-arm64-mac.zip",
  "StarWish-$V-x64-mac.zip"
)
foreach ($f in $uploads) {
  $p = Join-Path $staging $f
  if (-not (Test-Path $p)) { throw "staging missing: $f" }
  "staged: {0}  {1:N0} bytes" -f $f, (Get-Item $p).Length
}

# 5) 创建 Release（若不存在）
$rel = $null
try { $rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" } catch { }
if (-not $rel) {
  $body = @'
## 🔧 修复与增强（v2.1.1）

### 插件市场
- 修复部分插件因缺少依赖（`he`、`big-integer`）导致加载失败的问题
- 插件改为**默认关闭**，需在「设置 → 音源与插件」手动启用，避免新装插件自动参与聚合搜索
- 插件市场目录改为走后端拉取，修复渲染层直连导致的 `fetch failed` 错误

### 设置
- 歌词来源显示改为**动态来源**，列出当前歌曲实际参与查询的所有来源（优先来源以「·当前」标注）
- 日志目录支持**自定义更改**：可选择新目录、恢复默认，旧日志自动迁移

### 插件库
- `Star-Wish-Plugin-Library` 分支补充**插件开发指南**（模块结构、可用依赖、manifest 格式、运行环境说明）

### 多端同步
- 桌面端（Windows/Linux/macOS）与移动端（Android）同步适配以上全部改动

## 📦 安装包
- Windows 便携版 / 安装版（Setup.exe）/ Android APK（含 debug）/ Linux AppImage & deb / macOS（arm64 & x64）
'@
  $rel = Invoke-RestMethod -Method Post -Headers $h -Uri "https://api.github.com/repos/$repo/releases" -Body (@{
    tag_name = $tag; name = $tag; body = $body; draft = $false; prerelease = $false
  } | ConvertTo-Json)
  Write-Host "== created release id=$($rel.id)"
}
$relId = $rel.id

# 6) 删掉 Release 上同名旧 asset（同名不能并存；404 视为已删，幂等）
$rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/$relId"
foreach ($a in $rel.assets) {
  if ($uploads -contains $a.name) {
    Write-Host "== deleting old asset $($a.name) (id=$($a.id))"
    try { Invoke-RestMethod -Method Delete -Headers $h -Uri "https://api.github.com/repos/$repo/releases/assets/$($a.id)" | Out-Null }
    catch { Write-Host "  (delete ignored: $($_.Exception.Message))" }
  }
}

# 7) 上传 8 个新 asset（重试；已存在则跳过）
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
Write-Host 'UPLOAD DONE'

# 8) 终验：重新拉取 asset 清单
$rel = Invoke-RestMethod -Headers $h -Uri "https://api.github.com/repos/$repo/releases/$relId"
Write-Host "=== FINAL ASSETS on $tag ==="
$rel.assets | ForEach-Object { "final: {0}  {1:N0} bytes" -f $_.name, $_.size }
