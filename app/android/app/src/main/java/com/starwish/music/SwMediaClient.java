package com.starwish.music;

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

    public SwMediaClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            String path = request.getUrl().getPath();
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
            HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "*/*");
            String referer = refererFor(target);
            if (!referer.isEmpty()) conn.setRequestProperty("Referer", referer);
            String range = request.getRequestHeaders().get("Range");
            if (range != null) conn.setRequestProperty("Range", range);

            int status = conn.getResponseCode();
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
