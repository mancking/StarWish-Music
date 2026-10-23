package com.starwish.music;

import android.Manifest;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 移动端系统能力桥（v2.3.1）。
 *
 * 2.3.0 真机反馈「部分系统能力受限 / 下载需要跳浏览器」，此插件补齐：
 *  - openExternal：用系统浏览器/应用商店打开链接（更新页、market:// 升级 WebView）
 *  - downloadAndInstall：应用内下载升级 APK 到私有目录并拉起系统安装器，
 *    不再跳浏览器手动下载（FileProvider 授权，manifest 已注册）
 *  - saveToMedia：把 JS 侧已拉取的音频字节写入公共音乐目录
 *    Music/星河音乐/（MediaStore，API 29+ 无需存储权限；低版本退回
 *    应用外部私有目录）——移动端「下载歌曲到本地」由此落地
 *  - deleteMedia：按 uri 删除已保存的条目（下载管理「同时删除文件」）
 *  - scanLocal（v2.3.5）：查询系统媒体库（MediaStore.Audio），把本机音乐曲目
 *    交给 JS 侧入库，配合 SwMediaClient 的 /swlocal/ 流式回放，
 *    移动端「本地音乐扫描」由此落地（规格书 3.4 / 4.4）
 *
 * JS 侧统一走 Capacitor.nativePromise('SwBridge', ...)（见 src/mobile/bridge）。
 */
@CapacitorPlugin(
        name = "SwBridge",
        permissions = {
                @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
                @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
        }
)
public class SwBridgePlugin extends Plugin {

    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    /** 公共音乐库子目录（MediaStore RELATIVE_PATH = Music/<REL_DIR>） */
    private static final String REL_DIR = "星河音乐";

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少 url");
            return;
        }
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开链接：" + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("http")) {
            call.reject("缺少有效的下载地址");
            return;
        }
        final Context ctx = getContext();
        // 下载在后台线程执行，完成（或失败）后再回到调用结果
        new Thread(() -> {
            try {
                File dir = new File(ctx.getFilesDir(), "update");
                if (!dir.exists()) dir.mkdirs();
                File apk = new File(dir, "starwish-update.apk");
                downloadToFile(url, apk, getActivity());
                Intent it = new Intent(Intent.ACTION_VIEW);
                Uri uri;
                if (Build.VERSION.SDK_INT >= 24) {
                    uri = androidx.core.content.FileProvider.getUriForFile(
                            ctx, ctx.getPackageName() + ".fileprovider", apk);
                    it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } else {
                    uri = Uri.fromFile(apk);
                }
                it.setDataAndType(uri, "application/vnd.android.package-archive");
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(it);
                JSObject ret = new JSObject();
                ret.put("path", apk.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("下载安装包失败：" + e.getMessage());
            }
        }, "sw-update-dl").start();
    }

    /**
     * 是否已获得「安装未知应用」授权（Android 8+ 必需）。
     * 未授权时前端应引导用户到系统设置开启，否则安装器会直接失败。
     */
    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = true;
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                ok = getContext().getPackageManager().canRequestPackageInstalls();
            } catch (Exception e) {
                ok = false;
            }
        }
        ret.put("allowed", ok);
        call.resolve(ret);
    }

    /** 拉起「允许安装未知应用」的系统设置页 */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            Intent it = new Intent();
            if (Build.VERSION.SDK_INT >= 26) {
                it.setAction("android.settings.MANAGE_UNKNOWN_APP_SOURCES");
                it.setData(Uri.parse("package:" + getContext().getPackageName()));
            } else {
                it.setAction(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                it.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(it);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }

    @PluginMethod
    public void saveToMedia(PluginCall call) {
        String name = call.getString("name");
        String mime = call.getString("mime", "audio/mpeg");
        String data = call.getString("data");
        if (name == null || name.isEmpty() || data == null || data.isEmpty()) {
            call.reject("缺少文件名或数据");
            return;
        }
        try {
            byte[] bytes = android.util.Base64.decode(data, android.util.Base64.NO_WRAP | android.util.Base64.DEFAULT);
            JSObject ret = new JSObject();
            ContentResolver cr = getContext().getContentResolver();

            if (Build.VERSION.SDK_INT >= 29) {
                boolean audio = mime != null && mime.startsWith("audio");
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_MUSIC + "/" + REL_DIR);
                if (audio) v.put(MediaStore.Audio.Media.IS_PENDING, 1);
                Uri collection = audio
                        ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                Uri uri = cr.insert(collection, v);
                if (uri == null) throw new IllegalStateException("系统拒绝了媒体库写入");
                try (OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) throw new IllegalStateException("媒体库输出流打开失败");
                    os.write(bytes);
                    os.flush();
                }
                if (audio) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Audio.Media.IS_PENDING, 0);
                    cr.update(uri, done, null, null);
                }
                ret.put("uri", uri.toString());
                ret.put("path", Environment.DIRECTORY_MUSIC + "/" + REL_DIR + "/" + name);
            } else {
                // API 29 以下：写入应用外部私有目录（无需权限，音乐类 App 可读取）
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                File sub = new File(dir, REL_DIR);
                if (!sub.exists()) sub.mkdirs();
                File out = new File(sub, name);
                try (FileOutputStream os = new FileOutputStream(out)) {
                    os.write(bytes);
                }
                ret.put("uri", Uri.fromFile(out).toString());
                ret.put("path", out.getAbsolutePath());
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("保存到音乐库失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void moveTaskToBack(PluginCall call) {
        // 「退出」= 退到后台（保留播放），符合国内音乐 App 惯例；不杀进程
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    @PluginMethod
    public void deleteMedia(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("缺少 uri");
            return;
        }
        try {
            Uri u = Uri.parse(uri);
            if ("content".equals(u.getScheme())) {
                getContext().getContentResolver().delete(u, null, null);
            } else {
                String path = u.getPath();
                if (path != null) new File(path).delete();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("删除失败：" + e.getMessage());
        }
    }

    /**
     * 扫描系统媒体库里的音乐（规格书 3.4 / 4.4）。
     *
     * 只读取 MediaStore 索引（不遍历文件系统），返回曲目元数据；音频字节由
     * SwMediaClient 的 /swlocal/?id=<mediaId> 按 Range 流式回放，避免整曲进内存。
     * 权限：API 33+ 用 READ_MEDIA_AUDIO，之前用 READ_EXTERNAL_STORAGE。
     */
    @PluginMethod
    public void scanLocal(PluginCall call) {
        String alias = audioPermissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "afterAudioPermission");
            return;
        }
        runScanLocal(call);
    }

    @PermissionCallback
    private void afterAudioPermission(PluginCall call) {
        if (getPermissionState(audioPermissionAlias()) == PermissionState.GRANTED) {
            runScanLocal(call);
        } else {
            call.reject("未获得读取本地音乐权限，请在 系统设置 → 应用 → 星河音乐 → 权限 中允许「音乐和音频」后重试");
        }
    }

    private static String audioPermissionAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage";
    }

    private void runScanLocal(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray arr = new JSArray();
                ContentResolver cr = getContext().getContentResolver();
                String[] proj = {
                        MediaStore.Audio.Media._ID,
                        MediaStore.Audio.Media.TITLE,
                        MediaStore.Audio.Media.ARTIST,
                        MediaStore.Audio.Media.ALBUM,
                        MediaStore.Audio.Media.DURATION,
                        MediaStore.Audio.Media.SIZE,
                        MediaStore.Audio.Media.MIME_TYPE,
                        MediaStore.Audio.Media.DISPLAY_NAME,
                };
                String where = MediaStore.Audio.Media.IS_MUSIC + " != 0";
                try (Cursor c = cr.query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, proj, where, null,
                        MediaStore.Audio.Media.TITLE + " ASC")) {
                    if (c != null) {
                        while (c.moveToNext() && arr.length() < 5000) {
                            long id = c.getLong(0);
                            String name = c.getString(1);
                            String singer = c.getString(2);
                            String album = c.getString(3);
                            long ms = c.getLong(4);
                            long size = c.getLong(5);
                            String mime = c.getString(6);
                            String display = c.getString(7);
                            if (name == null || name.trim().isEmpty()) name = display;
                            JSObject o = new JSObject();
                            o.put("id", String.valueOf(id));
                            o.put("name", name == null ? "未知歌曲" : name);
                            o.put("singer", singer == null || singer.trim().isEmpty() ? "未知歌手" : singer);
                            o.put("album", album == null ? "" : album);
                            o.put("duration", ms > 0 ? ms / 1000 : 0);
                            o.put("size", size);
                            o.put("mime", mime == null ? "audio/mpeg" : mime);
                            o.put("uri", Uri.withAppendedPath(
                                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, String.valueOf(id)).toString());
                            arr.put(o);
                        }
                    }
                }
                JSObject ret = new JSObject();
                ret.put("songs", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("扫描本地音乐失败：" + e.getMessage());
            }
        }).start();
    }

    /** HttpURLConnection 下载（跟随同协议跳转），用于升级包；带进度回调 */
    private void downloadToFile(String url, File out, android.app.Activity act) throws Exception {
        HttpURLConnection conn = null;
        long lastNotify = 0;
        try {
            String target = url;
            for (int hop = 0; hop <= 5; hop++) {
                conn = (HttpURLConnection) new URL(target).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("User-Agent", UA);
                int status = conn.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc == null || loc.isEmpty()) break;
                    conn.disconnect();
                    target = new URL(new URL(target), loc).toString();
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new IllegalStateException("HTTP " + status);
                }
                break;
            }
            long total = conn.getContentLengthLong();
            long received = 0;
            try (InputStream is = conn.getInputStream(); FileOutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    received += n;
                    // 每 300ms 通知一次进度，避免高频 IPC 拖慢下载
                    long now = System.currentTimeMillis();
                    if (act != null && now - lastNotify > 300) {
                        lastNotify = now;
                        JSObject p = new JSObject();
                        p.put("received", received);
                        p.put("total", total > 0 ? total : 0);
                        p.put("percent", total > 0 ? (int) (received * 100 / total) : 0);
                        p.put("phase", "downloading");
                        act.runOnUiThread(() -> notifyListeners("swUpdateProgress", p));
                    }
                }
                os.flush();
            }
            if (act != null) {
                JSObject p = new JSObject();
                p.put("received", received);
                p.put("total", total > 0 ? total : 0);
                p.put("percent", 100);
                p.put("phase", "downloaded");
                act.runOnUiThread(() -> notifyListeners("swUpdateProgress", p));
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
