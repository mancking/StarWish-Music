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

    /**
     * 系统返回（含手势返回）接管：不再让默认行为直接退出应用。
     * 统一转成 window 上的 backButton 事件交给前端路由栈处理——
     * 有关闭弹层则关弹层、能回退则回退、根页双击才退到后台
     * （见 src/mobile/back-handler.ts，v2.3.1 真机「手势直接退出应用」的根因修复）。
     */
    @Override
    public void onBackPressed() {
        if (bridge == null) {
            super.onBackPressed();
            return;
        }
        bridge.triggerJSEvent("backButton", "window");
    }
}
