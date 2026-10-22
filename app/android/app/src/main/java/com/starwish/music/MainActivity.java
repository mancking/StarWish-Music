package com.starwish.music;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        super.load();
        // 系统能力桥：外链打开 / APK 应用内下载安装 / 歌曲写入公共音乐库
        registerPlugin(SwBridgePlugin.class);
        // 挂载媒体代理拦截器：WebView 请求 /swmedia/?u=... 时由原生带防盗链头拉流，
        // 等价桌面 Electron 的 swmedia:// 协议（app/electron/core/media.ts），
        // 解决真机 <audio>/视频 直连 CDN 缺 Referer/UA 被 403 拒载的问题。
        bridge.setWebViewClient(new SwMediaClient(bridge));
    }
}
