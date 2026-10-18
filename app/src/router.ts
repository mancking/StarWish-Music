import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('@/pages/Home.vue'), meta: { title: '个性推荐' } },
  { path: '/discover', name: 'discover', component: () => import('@/pages/Discover.vue'), meta: { title: '发现音乐' } },
  { path: '/mv', name: 'mv', component: () => import('@/pages/Mv.vue'), meta: { title: '视频 / MV' } },
  { path: '/mv/:bvid', name: 'mv-player', component: () => import('@/pages/MvPlayer.vue'), meta: { title: '视频播放' } },
  { path: '/search', name: 'search', component: () => import('@/pages/Search.vue'), meta: { title: '搜索' } },
  { path: '/playlist/:id', name: 'playlist', component: () => import('@/pages/Playlist.vue'), meta: { title: '歌单' } },
  { path: '/podcast/:id', name: 'podcast', component: () => import('@/pages/Playlist.vue'), meta: { title: '播客' } },
  { path: '/toplist/:platform/:id', name: 'toplist', component: () => import('@/pages/Playlist.vue'), meta: { title: '排行榜' } },
  { path: '/favorites', name: 'favorites', component: () => import('@/pages/Favorites.vue'), meta: { title: '我喜欢的音乐' } },
  { path: '/local', name: 'local', component: () => import('@/pages/Local.vue'), meta: { title: '本地音乐' } },
  { path: '/history', name: 'history', component: () => import('@/pages/History.vue'), meta: { title: '最近播放' } },
  // 移动端「我的」二级中枢（底栏 4 tab 之一），二级入口都从这里跳
  { path: '/mine', name: 'mine', component: () => import('@/pages/Mine.vue'), meta: { title: '我的' } },
  { path: '/settings', name: 'settings', component: () => import('@/pages/Settings.vue'), meta: { title: '设置' } },
  {
    path: '/player',
    name: 'player',
    component: () => import('@/pages/Player.vue'),
    meta: { title: '正在播放', fullscreen: true },
  },
  {
    path: '/lyric',
    name: 'lyric',
    component: () => import('@/pages/LyricWindow.vue'),
    meta: { title: '桌面歌词', fullscreen: true, lyric: true },
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
