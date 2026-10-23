package com.starwish.music;

import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 移动端媒体代理（对应桌面 app/electron/core/media.ts 的 swmedia:// 协议）。
 *
 * WebView 里 <audio>/<video> 直连各音乐 CDN 会因缺 Referer/UA 被 403 拒载，
 * 这里拦截相对路径 /swmedia/?u=... 并在原生侧（无 CORS/明文限制）注入防盗链
 * 头后拉流，响应状态码与 Range 原样回传，支持 206 断点续传与 302 跨协议跳转
 * （http→https 交给 WebView 跟随 Location 再次进入本拦截器）。
 *
 * ponytail: B 站 Cookie 未注入——桌面在主进程可读 db 里的 B 站登录态，
 * 移动端原生层拿不到；B 站 MV/音频在真机可能仍 403。
 * 升级路径：把 getBiliCookie 的值经 Capacitor 插件桥暴露给原生层。
 */
public class SwMediaClient extends BridgeWebViewClient {

    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    private final Bridge bridge;

    public SwMediaClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            String path = request.getUrl().getPath();
            if ("/swlocal/".equals(path) || "/swlocal".equals(path)) {
                return serveLocal(request);
            }
            if ("/swmedia/".equals(path) || "/swmedia".equals(path)) {
                String target = request.getUrl().getQueryParameter("u");
                if (target != null && target.startsWith("http")) {
                    return proxy(target, request);
                }
            }
        } catch (Throwable t) {
            // 代理失败不阻断页面：回退 Capacitor 本地服务
        }
        return super.shouldInterceptRequest(view, request);
    }

    /**
     * 本地音乐回放（规格书 3.4 / 4.4）：/swlocal/?id=<mediaId>。
     *
     * WebView 的 &lt;audio&gt; 不能直接吃 content:// URI，这里用 ContentResolver
     * 打开 MediaStore 音频流并按 Range 返回 206，支持拖动进度与边下边播。
     */
    private WebResourceResponse serveLocal(WebResourceRequest request) {
        String id = request.getUrl().getQueryParameter("id");
        if (id == null || id.isEmpty()) {
            return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
        try {
            Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
            AssetFileDescriptor afd = bridge.getContext().getContentResolver()
                    .openAssetFileDescriptor(uri, "r");
            if (afd == null) throw new IllegalStateException("媒体库条目不可读");
            long total = afd.getLength();
            long start = 0;
            long end = total > 0 ? total - 1 : -1;
            String range = request.getRequestHeaders().get("Range");
            boolean partial = false;
            if (range != null && range.startsWith("bytes=") && total > 0) {
                String spec = range.substring(6).split(",")[0];
                int dash = spec.indexOf('-');
                if (dash >= 0) {
                    String a = spec.substring(0, dash).trim();
                    String b = spec.substring(dash + 1).trim();
                    if (!a.isEmpty()) start = Long.parseLong(a);
                    if (!b.isEmpty()) end = Math.min(Long.parseLong(b), total - 1);
                    partial = true;
                }
            }
            InputStream is = afd.createInputStream();
            if (start > 0) {
                long skipped = 0;
                while (skipped < start) {
                    long n = is.skip(start - skipped);
                    if (n <= 0) break;
                    skipped += n;
                }
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Accept-Ranges", "bytes");
            if (total > 0) {
                long len = end - start + 1;
                headers.put("Content-Length", String.valueOf(len));
                if (partial) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
            }
            String mime = queryMime(id);
            return new WebResourceResponse(mime, "", partial ? 206 : 200,
                    partial ? "Partial Content" : "OK", headers, is);
        } catch (Exception e) {
            byte[] msg = ("local error: " + e.getMessage()).getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(msg));
        }
    }

    /** 读 MediaStore 里该条目的 MIME，拿不到时按 mp3 兜底。 */
    private String queryMime(String id) {
        try (Cursor c = bridge.getContext().getContentResolver().query(
                Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id),
                new String[] { MediaStore.Audio.Media.MIME_TYPE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String m = c.getString(0);
                if (m != null && !m.isEmpty()) return m;
            }
        } catch (Exception ignore) {
        }
        return "audio/mpeg";
    }

    /** 与 media.ts refererFor() 保持一致的防盗链 Referer 表。 */
    private static String refererFor(String target) {
        try {
            String h = new URL(target).getHost();
            if (h.contains("126.net") || h.contains("163.com")) return "https://music.163.com/";
            if (h.contains("gtimg.cn") || h.contains("qq.com")) return "https://y.qq.com/";
            if (h.contains("kugou.com")) return "https://www.kugou.com/";
            if (h.contains("kuwo.cn")) return "http://www.kuwo.cn/";
            if (h.contains("bilibili.com") || h.contains("hdslb.com") || h.contains("bilivideo")) return "https://www.bilibili.com/";
            if (h.contains("migu.cn")) return "https://music.migu.cn/";
        } catch (Exception ignore) {
        }
        return "";
    }

    private WebResourceResponse proxy(String target, WebResourceRequest request) {
        try {
            // HttpURLConnection 不跟随跨协议（http↔http s）重定向，各音乐 CDN 常 302 到
            // http 地址；WebView 也不会跟随 shouldInterceptRequest 返回的 3xx（会把 302 的
            // 空/HTML 响应体当最终内容喂给 <audio>，导致 ffmpeg demuxer 打不开）。故在此
            // 手动跟随 Location 直到拿到最终 2xx/4xx 响应，绝不把 3xx 交回 WebView。
            String range = request.getRequestHeaders().get("Range");
            HttpURLConnection conn = null;
            int status = 0;
            for (int hop = 0; hop <= 5; hop++) {
                conn = (HttpURLConnection) new URL(target).openConnection();
                conn.setInstanceFollowRedirects(false); // 手动跟随，覆盖跨协议跳转
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("User-Agent", UA);
                conn.setRequestProperty("Accept", "*/*");
                String referer = refererFor(target);
                if (!referer.isEmpty()) conn.setRequestProperty("Referer", referer);
                if (range != null) conn.setRequestProperty("Range", range);

                status = conn.getResponseCode();
                if (status == 301 || status == 302 || status == 303
                        || status == 307 || status == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc == null || loc.isEmpty()) break;
                    conn.disconnect();
                    target = new URL(new URL(target), loc).toString();
                    continue;
                }
                break;
            }
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);

            String rawType = conn.getContentType();
            String mime = "application/octet-stream";
            String encoding = "";
            if (rawType != null && !rawType.isEmpty()) {
                String[] parts = rawType.split(";");
                if (!parts[0].trim().isEmpty()) mime = parts[0].trim();
                for (String p : parts) {
                    int eq = p.indexOf('=');
                    if (eq > 0 && p.trim().toLowerCase().startsWith("charset")) {
                        encoding = p.substring(eq + 1).trim().replace("\"", "");
                    }
                }
            }

            Map<String, String> headers = new HashMap<>();
            for (Map.Entry<String, java.util.List<String>> e : conn.getHeaderFields().entrySet()) {
                String key = e.getKey();
                if (key == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                // WebResourceResponse 自行处理传输编码，重复头会让 WebView 拒收
                if ("transfer-encoding".equalsIgnoreCase(key) || "content-encoding".equalsIgnoreCase(key)) continue;
                headers.put(key, e.getValue().get(0));
            }
            String reason = status >= 400 ? "Bad Gateway" : "OK";
            return new WebResourceResponse(mime, encoding, status, reason, headers, stream);
        } catch (Exception e) {
            byte[] msg = ("proxy error: " + e.getMessage()).getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("text/plain", "UTF-8", 502, "Bad Gateway",
                    new HashMap<String, String>(), new ByteArrayInputStream(msg));
        }
    }
}
