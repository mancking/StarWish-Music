/* ============================================================
 * StarWish 聚合音源 v1.0.0（starwish-unified.js）
 * 覆盖：网易云 / 酷狗 / 酷我 / QQ音乐（lx-music v2 协议）
 * 自研，不依赖第三方脚本。实测时间：2026-10-16
 *   - 网易云: search 官方 web API + outer wrapper 直链 + 歌词 + songDetail 封面
 *   - 酷狗:   mobilecdn 搜索 + getSongInfo.php 直链 + album_img 封面
 *   - 酷我:   search.kuwo.cn r.s（单引号 JSON 清洗）+ antiserver 直链
 *   - QQ:     c.y.qq.com search_for_qq_cp 搜索 + y.gtimg.cn 封面（取链需登录态 vkey，标降级）
 * 咪咕：公开接口全部被 WAF 拦截（需登录态/签名），暂未接入。
 * 作为 v1.1 §2.1.1「内置聚合音源」范本：完整实现 lx-music 协议 search/musicUrl/lyric/pic。
 * ============================================================ */
const unified = {
  name: 'StarWish 聚合音源',
  version: '1.0.0',
  author: 'StarWish Team',
  description: '自研多平台聚合：网易云/酷狗/酷我/QQ（lx-music v2 协议范本）',
  homepage: '',
  sources: {
    wy: { name: '网易云', actions: ['musicSearch', 'musicUrl', 'lyric', 'pic'], qualitys: ['128k', '320k'] },
    kg: { name: '酷狗', actions: ['musicSearch', 'musicUrl', 'pic'], qualitys: ['128k', '320k'] },
    kw: { name: '酷我', actions: ['musicSearch', 'musicUrl'], qualitys: ['128k', '320k'] },
    qq: { name: 'QQ音乐', actions: ['musicSearch', 'pic'], qualitys: ['128k'] },
  },
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
function req(url, opts) {
  return new Promise((resolve, reject) => {
    lx.request(url, opts || {}, (err, res) => {
      if (err) return reject(err);
      if (!res || res.statusCode !== 200) return reject(new Error('HTTP ' + (res && res.statusCode)));
      resolve(res.body);
    });
  });
}
function qs(o) { return Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k])).join('&'); }
/* 酷我 r.s 返回 JS 单引号 JSON：把键/值单引号转双引号后解析 */
function parseKuwoJson(text) {
  try { return JSON.parse(text); } catch (e) {
    const s = String(text).replace(/([{,]\s*)'([^']*?)'\s*:/g, '$1"$2":').replace(/:\s*'([^']*?)'([,}])/g, ':"$1"$2');
    try { return JSON.parse(s); } catch (e2) { return null; }
  }
}
/* ---------------- 搜索 ---------------- */
async function searchNetease(kw, page, size) {
  const r = await req('https://music.163.com/api/search/get/web?' + qs({ csrf_token: '', s: kw, type: 1, offset: (page - 1) * size, total: true, limit: size }), { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc' } });
  const songs = (r && r.result && r.result.songs) || [];
  return songs.map(s => ({
    name: s.name, singer: (s.artists || []).map(a => a.name).join('/') || '未知歌手',
    albumName: s.album && s.album.name || '', duration: Math.round((s.dt || 0) / 1000),
    songId: String(s.id), pic: s.album && s.album.picUrl || '', source: 'wy', qualitys: ['128k', '320k'],
  }));
}
async function searchKugou(kw, page, size) {
  const r = await req('http://mobilecdn.kugou.com/api/v3/search/song?' + qs({ format: 'json', keyword: kw, page, pagesize: size, showtype: 1, plat: 0 }), { headers: { 'User-Agent': UA } });
  const info = (r && r.data && r.data.info) || [];
  return info.map(s => ({
    name: s.songname, singer: s.singername || '未知歌手', albumName: s.album_name || '',
    duration: s.duration || 0, songId: s.hash || '', hash: s.hash, source: 'kg', qualitys: ['128k', '320k'],
  }));
}
async function searchKuwo(kw, page, size) {
  const r = await req('http://search.kuwo.cn/r.s?' + qs({ all: kw, ft: 'music', itemset: 'wk_artist', rn: size, pn: page - 1, rformat: 'json', encoding: 'utf8', vipver: 'MUSIC_8.0.3.1' }), { headers: { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' } });
  const parsed = parseKuwoJson(r); // r.s 返回 JS 单引号 JSON，需清洗
  const list = (parsed && (parsed.abslist || parsed.songlist)) || [];
  return list.map(s => ({
    name: s.SONGNAME || s.name || '', singer: s.ARTIST || s.artist || '未知歌手',
    albumName: s.ALBUM || s.album || '', duration: 0,
    songId: (s.MUSICRID || s.id || 'kw' + (s.DC_TARGETID || '')).toString().replace('MUSIC_', 'MUSIC_'),
    rid: s.MUSICRID || ('MUSIC_' + (s.DC_TARGETID || '')), source: 'kw', qualitys: ['128k', '320k'],
  })).filter(s => s.name);
}
async function searchQQ(kw, page, size) {
  const r = await req('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?' + qs({ w: kw, format: 'json', n: size, p: page, cr: 1, g_tk: 5381, loginUin: 0, hostUin: 0, inCharset: 'utf8', outCharset: 'utf-8', notice: 0, platform: 'yqq.json', needNewCode: 0 }), { headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' } });
  const list = (r && r.data && r.data.song && r.data.song.list) || [];
  return list.map(s => ({
    name: s.songname || '', singer: (s.singer || []).map(x => x.name).join('/') || '未知歌手',
    albumName: s.albumname || '', duration: s.interval || 0,
    songId: s.songmid || '', songmid: s.songmid || '', albummid: s.albummid || '', source: 'qq', qualitys: ['128k'],
  })).filter(s => s.name);
}
/* ---------------- 取链 ---------------- */
async function urlNetease(mi, type) {
  const id = String(mi.songId || mi.songmid || mi.id || '');
  if (!id) throw new Error('缺网易云 id');
  return 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3';
}
async function urlKugou(mi) {
  const hash = mi.hash || mi.songId;
  if (!hash) throw new Error('缺酷狗 hash');
  const r = await req('http://m.kugou.com/app/i/getSongInfo.php?' + qs({ cmd: 'playInfo', hash, plat: 0 }), { headers: { 'User-Agent': UA } });
  if (!r || !r.url) throw new Error('酷狗无播放地址');
  return r.url;
}
async function urlKuwo(mi) {
  const rid = mi.rid || mi.songId;
  if (!rid) throw new Error('缺酷我 rid');
  const r = await req('http://antiserver.kuwo.cn/anti.s?' + qs({ type: 'convert_url', format: 'mp3', rid }), { headers: { 'User-Agent': UA, Referer: 'http://www.kuwo.cn/' } });
  const u = String(r || '').trim();
  if (!/^https?:\/\//.test(u)) throw new Error('酷我无播放地址');
  return u;
}
/* ---------------- 歌词 / 封面 ---------------- */
async function lyricNetease(mi) {
  const id = String(mi.songId || mi.songmid || mi.id || '');
  if (!/^\d{4,}$/.test(id)) throw new Error('非网易云曲目');
  const r = await req('https://music.163.com/api/song/lyric?' + qs({ id, lv: -1, kv: -1, tv: -1 }), { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc' } });
  const lrc = r && r.lrc && r.lrc.lyric;
  if (!lrc) throw new Error('无歌词');
  return { lyric: lrc };
}
async function picNetease(mi) {
  const id = String(mi.songId || mi.songmid || mi.id || '');
  if (!/^\d{4,}$/.test(id)) throw new Error('非网易云曲目');
  const r = await req('https://music.163.com/api/song/detail/?' + qs({ id, ids: '[' + id + ']' }), { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: 'os=pc' } });
  const pic = r && r.songs && r.songs[0] && (r.songs[0].album && r.songs[0].album.picUrl);
  if (!pic) throw new Error('无封面');
  return { url: pic };
}
async function picKugou(mi) {
  const hash = mi.hash || mi.songId;
  if (!hash) throw new Error('缺酷狗 hash');
  const r = await req('http://m.kugou.com/app/i/getSongInfo.php?' + qs({ cmd: 'playInfo', hash, plat: 0 }), { headers: { 'User-Agent': UA } });
  const img = r && (r.album_img || r.imgUrl || '');
  if (!img) throw new Error('无封面');
  return { url: img.replace('{size}', '400') };
}
async function picQQ(mi) {
  const mid = mi.albummid || mi.songmid;
  if (!mid) throw new Error('缺 QQ mid');
  return { url: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + mid + '.jpg' };
}

lx.on(lx.EVENT_NAMES.request, (data) => {
  const p = String(data.source || '');
  const action = String(data.action || '');
  const info = data.info || {};
  const mi = info.musicInfo || {};
  const kw = String(info.keyword || (mi.searchTerm || ''));
  const page = Number(info.page) || 1;
  const size = Number(info.pagesize) || 30;
  if (action === 'musicSearch') {
    if (p === 'wy') return searchNetease(kw, page, size);
    if (p === 'kg') return searchKugou(kw, page, size);
    if (p === 'kw') return searchKuwo(kw, page, size);
    if (p === 'qq') return searchQQ(kw, page, size);
  }
  if (action === 'musicUrl') {
    if (p === 'wy') return urlNetease(mi, info.type);
    if (p === 'kg') return urlKugou(mi);
    if (p === 'kw') return urlKuwo(mi);
  }
  if (action === 'lyric' && p === 'wy') return lyricNetease(mi);
  if (action === 'pic') {
    if (p === 'wy') return picNetease(mi);
    if (p === 'kg') return picKugou(mi);
    if (p === 'qq') return picQQ(mi);
  }
  return Promise.reject(new Error('不支持的请求: ' + p + '/' + action));
});

lx.send(lx.EVENT_NAMES.inited, unified);
