/**
 * 规格书 v2.8 · 0.6 模块拆分：
 * player-core/ = 播放内核（AudioContext、播放状态机、进度调度），音乐和视频共用。
 *
 * 这里只做“公共出口”，不写业务：
 *
 * * - eq.ts      5 段 EQ + 6 预设（Web Audio BiquadFilter）
 *  - spectrum.ts 频谱数据通道（桌面走主进程 AnalyserNode，移动端走本地 Web Audio）
 */
export * from './eq'
export * from './spectrum'
