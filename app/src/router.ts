import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    // 移动端首页是全新模板（横滑卡片流），与桌面页头网格完全异构
    component: () => (__MOBILE__ ? import('@/pages/mobile/Home.vue') : import('@/pages/Home.vue')),
    meta: { title: '个性推荐' },
  },
  {
    path: '/discover',
    name: 'discover',
    // 移动端发现页为模板级独立实现（分段 tab + 2 列大卡），与桌面三栏布局异构
    component: () => (__MOBILE__ ? import('@/pages/mobile/Discover.vue') : import('@/pages/Discover.vue')),
    meta: { title: '发现音乐' },
  },
  {
    path: '/mv',
    name: 'mv',
    // 移动端视频页为模板级独立实现（大搜索框 + 2 列封面卡 + 滚动加载）
    component: () => (__MOBILE__ ? import('@/pages/mobile/Mv.vue') : import('@/pages/Mv.vue')),
    meta: { title: '视频 / MV' },
  },
  { path: '/mv/:bvid', name: 'mv-player', component: () => import('@/pages/MvPlayer.vue'), meta: { title: '视频播放' } },
  { path: '/search', name: 'search', component: () => import('@/pages/Search.vue'), meta: { title: '搜索' } },
  { path: '/playlist/:id', name: 'playlist', component: () => import('@/pages/Playlist.vue'), meta: { title: '歌单' } },
  { path: '/podcast/:id', name: 'podcast', component: () => import('@/pages/Playlist.vue'), meta: { title: '播客' } },
  { path: '/toplist/:platform/:id', name: 'toplist', component: () => import('@/pages/Playlist.vue'), meta: { title: '排行榜' } },
  { path: '/favorites', name: 'favorites', component: () => import('@/pages/Favorites.vue'), meta: { title: '我喜欢的音乐' } },
  { path: '/local', name: 'local', component: () => import('@/pages/Local.vue'), meta: { title: '本地音乐' } },
  { path: '/history', name: 'history', component: () => import('@/pages/History.vue'), meta: { title: '最近播放' } },
  {
    path: '/downloads',
    name: 'downloads',
    // 下载管理：桌面是密集列表，移动端是大卡片，按端各有一套实现
    component: () => (__MOBILE__ ? import('@/pages/mobile/Downloads.vue') : import('@/pages/Downloads.vue')),
    meta: { title: '下载管理' },
  },
  // 移动端「我的」二级中枢（底栏 4 tab 之一），二级入口都从这里跳
  // 移动端「我的」二级中枢（底栏 4 tab 之一）：模板级独立实现（资料卡 + 分组条目）
  { path: '/mine', name: 'mine', component: () => (__MOBILE__ ? import('@/pages/mobile/Mine.vue') : import('@/pages/Mine.vue')), meta: { title: '我的' } },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue'), meta: { title: '设置' } },
  {
    path: '/player',
    name: 'player',
    // 桌面与移动端各有一套播放页：功能一致，交互与布局按端重写
    component: () => (__MOBILE__ ? import('@/pages/mobile/Player.vue') : import('@/pages/Player.vue')),
    meta: { title: '正在播放', fullscreen: true },
  },
  {
    path: '/lyric',
    name: 'lyric',
    component: () => import('@/pages/LyricWindow.vue'),
    meta: { title: '桌面歌词', fullscreen: true, lyric: true },
  },
  {
    path: '/taskbar-lyric',
    name: 'taskbar-lyric',
    component: () => import('@/pages/TaskbarLyric.vue'),
    meta: { title: '任务栏歌词', fullscreen: true, lyric: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.afterEach(to => {
  const title = (to.meta?.title as string) || '星河音乐'
  document.title = title === '星河音乐' ? '星河音乐' : `${title} · 星河音乐`
})
