# Android 签名与产物说明

## 产物（`npm run dist:android`）

产物 `versionName` 与桌面端同步为 `2.0.0`（`android/app/build.gradle` 的 `versionName`）。

| 文件 | 用途 |
| --- | --- |
| `android/app/build/outputs/apk/release/app-release.apk` | 已签名发布版，**手机端 + 车机端通用** |
| `android/app/build/outputs/apk/debug/app-debug.apk` | 调试版（调试签名，可直接装） |

车机兼容在 `android/app/src/main/AndroidManifest.xml` 里声明：
`android.hardware.type.automotive required=false`、`touchscreen required=false`、
`screen.landscape required=false`、`screen.portrait required=false`。

## 本仓库自签名 keystore

- 文件：`android/app/starwish-release.keystore`
- alias：`starwish`
- storePassword / keyPassword：`starwish2026`
- 证书：CN=StarWish Music, OU=StarWish, O=StarWish, C=CN（RSA 2048，有效期 9125 天）
- `android/app/build.gradle` 的 `release` 块在该文件存在时自动套用；不存在则退回 `app-release-unsigned.apk`（GitHub Actions 上找不到 keystore 时的默认产物，见 `.github/workflows/build-desktop.yml`）。

重新生成（换证书时）：

```powershell
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore starwish-release.keystore `
  -alias starwish -keyalg RSA -keysize 2048 -validity 9125 -storepass <你的口令> -keypass <你的口令>
```

校验签名：

```powershell
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

## ⚠️ 已知边界

自签名 APK 不能覆盖已安装的、用其他证书签名的同名 APK（`applicationId com.starwish.music`）。
卸载旧版再装即可。要上 Google Play 需换成正式签名证书，并把 `applicationId` 与版本号改成实际发布值。
