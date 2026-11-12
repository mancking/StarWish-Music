/* ============================================================
 * StarWish 聚合音源 v1.2.0（starwish-unified.js）
 * 覆盖：网易云 / 酷狗 / 酷我 / QQ音乐（lx-music v2 协议）
 * 自研，不依赖第三方脚本。
 *   - 网易云: search 官方 web API + GD Studio 聚合直链（320k/FLAC/Hi-Res，公开可达）
 *     + outer wrapper 兜底 + 歌词 + songDetail 封面
 *   - 酷狗:   mobilecdn 搜索 + getSongInfo.php 直链 + album_img 封面
 *   - 酷我:   search.kuwo.cn r.s（单引号 JSON 清洗）+ antiserver 直链
 *   - QQ:     c.y.qq.com 搜索 + fcg_music_express_mobile3 登录态 vkey 取链
 *     （凭据经宿主 __swCredentials.qq 注入：设置→账号 登录 QQ 后生效）
 *   - 跨平台兜底: 歌名+歌手在 wy/kg/kw/tx 搜同曲换链（单曲失败不锁死单一平台）
 * 音质档位按通道如实声明（GD netease 支持 320k/FLAC/Hi-Res；QQ 登录态支持
 * 128k/320k；kw/kg 公开直链支持 128k/320k）。
 * ============================================================ */
const unified = {
  name: 'StarWish 聚合音源',
  version: '1.2.0',
  author: 'StarWish Team',
  description: '自研多平台聚合：网易云(FLAC/Hi-Res)/酷狗/酷我/QQ（lx-music v2 协议）',
  homepage: '',
  sources: {
    wy: { name: '网易云', actions: ['musicSearch', 'musicUrl', 'lyric', 'pic'], qualitys: ['128k', '320k', 'flac', 'hires'] },
    kg: { name: '酷狗', actions: ['musicSearch', 'musicUrl', 'pic'], qualitys: ['128k', '320k'] },
    kw: { name: '酷我', actions: ['musicSearch', 'musicUrl'], qualitys: ['128k', '320k'] },
    qq: { name: 'QQ音乐', actions: ['musicSearch', 'musicUrl', 'pic'], qualitys: ['128k', '320k'] },
  },
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
function req(url, opts) {
  return new Promise((resolve, reject) => {
    lx.request(url, opts || {}, (err, res) => {
      if (err) return reject(err);
      const code = res && (res.statusCode || res.status);
      if (!res || code !== 200) return reject(new Error('HTTP ' + (res ? code : 'no-res')));
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
  const r = await req('https://mobiles.kugou.com/api/v3/search/song?' + qs({ format: 'json', keyword: kw, page, pagesize: size, showtype: 1, plat: 0 }), { headers: { 'User-Agent': UA } });
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
  // GD Studio 聚合直链：宿主音质经 QUALITY_MAP 映射为 lx 生态名（flac24bit=Hi-Res 24bit），
  // br 对齐星海源 GD_BR_MAP（740=FLAC / 999=Hi-Res）；失败回落 outer wrapper
  const brMap = { '128k': '128', '320k': '320', flac: '740', flac24bit: '999' };
  const br = brMap[type];
  if (br) {
    try {
      const r = await req('https://music-api.gdstudio.xyz/api.php?' + qs({ use_xbridge3: 'true', loader_name: 'forest', need_sec_link: '1', sec_link_scene: 'im', theme: 'light', types: 'url', source: 'netease', id, br }) + '&', { headers: { 'User-Agent': 'LX-Music-Mobile' } });
      if (r && r.url && /^https?:\/\//.test(r.url)) return r.url;
    } catch (e) { /* 回落 outer */ }
  }
  return 'https://music.163.com/song/media/outer/url?id=' + id + '.mp3';
}
async function urlQQ(mi) {
  const mid = mi.songmid || mi.songId;
  if (!mid) throw new Error('缺 QQ songmid');
  // 登录态 vkey：凭据经宿主 __swCredentials.qq 注入（设置→账号 登录 QQ 后生效）；
  // 未登录时报错并引导（匿名请求服务端一律拒绝）
  const cred = (globalThis.__swCredentials && globalThis.__swCredentials.qq) || {};
  const uin = String(cred.uin || '').replace(/^o/, '') || '0';
  if (!cred.skey) throw new Error('QQ 取链需要登录态：到「设置 → 账号」登录 QQ 音乐后再试');
  const guid = 'sw' + Math.floor(Math.random() * 1e8);
  const filename = 'M800' + mid + '.mp3';
  const r = await req('https://c.y.qq.com/base/fcgi-bin/fcg_music_express_mobile3.fcg?' + qs({ format: 'json', platform: 'yqq', cid: '205361747', songmid: mid, filename, guid, uin }), { headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', Cookie: 'uin=o' + uin + '; skey=' + cred.skey + (cred.ptcz ? '; ptcz=' + cred.ptcz : '') } });
  const vkey = r && r.data && r.data.items && r.data.items[0] && r.data.items[0].vkey;
  if (!vkey) throw new Error('QQ 未返回 vkey（登录态可能过期，请重新登录）');
  return 'https://dl.stream.qqmusic.qq.com/' + filename + '?vkey=' + vkey + '&guid=' + guid + '&uin=' + uin + '&fromtag=66';
}
async function urlKugou(mi) {
  const hash = mi.hash || mi.songId;
  if (!hash) throw new Error('缺酷狗 hash');
  let r = null;
  try {
    r = await req('http://m.kugou.com/app/i/getSongInfo.php?' + qs({ cmd: 'playInfo', hash, plat: 0 }), { headers: { 'User-Agent': UA } });
  } catch (e) {
    r = await req('http://m3ws.kugou.com/getSongInfo.php?' + qs({ cmd: 'playInfo', hash, plat: 0 }), { headers: { 'User-Agent': UA } });
  }
  if (!r || !r.url) throw new Error(r && r.status === 0 ? '酷狗该曲目为付费内容' : '酷狗无播放地址');
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
    // 原平台直链优先；失败走跨平台关键词取链兜底（歌曲不再锁死单一平台）
    const direct = (async () => {
      if (p === 'wy') return urlNetease(mi, info.type);
      if (p === 'kg') return urlKugou(mi);
      if (p === 'kw') return urlKuwo(mi);
      if (p === 'qq') return urlQQ(mi);
      throw new Error('不支持的平台取链: ' + p);
    })();
    const keyword = String(info.keyword || (mi.name && (mi.name + ' ' + (mi.singer || ''))) || '').trim();
    if (!keyword) return direct;
    return direct.catch(e => urlCross(keyword, p, String(info.type || '128k')).then(u => {
      lx.console && lx.console.log && console.log('[unified] 跨平台换链成功:', keyword, '->', u.slice(0, 60));
      return u;
    }).catch(() => { throw e; }));
  }
  if (action === 'lyric' && p === 'wy') return lyricNetease(mi);
  if (action === 'pic') {
    if (p === 'wy') return picNetease(mi);
    if (p === 'kg') return picKugou(mi);
    if (p === 'qq') return picQQ(mi);
  }
  return Promise.reject(new Error('不支持的请求: ' + p + '/' + action));
});

/* ---------------- 跨平台取链兜底：歌名+歌手 在 wy/kg/kw 搜同曲，返回首个可用直链 ---------------- */
const crossCache = new Map();
function urlCross(keyword, originPlatform, quality) {
  const key = quality + '|' + keyword;
  const hit = crossCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return Promise.resolve(hit.url);
  const order = ['wy', 'kg', 'kw'].filter(x => x !== originPlatform);  const tryOne = async plat => {
    let songs = [];
    if (plat === 'wy') songs = await searchNetease(keyword, 1, 6);
    else if (plat === 'kg') songs = await searchKugou(keyword, 1, 6);
    else if (plat === 'kw') songs = await searchKuwo(keyword, 1, 6);
    for (const s of songs) {
      if (!s.name) continue;
      const mi = Object.assign({}, s, { musicInfo: s });
      try {
        let u = '';
        if (plat === 'wy') u = await urlNetease(mi, quality);
        else if (plat === 'kg') u = await urlKugou(mi);
        else if (plat === 'kw') u = await urlKuwo(mi);
        if (u && /^https?:\/\//.test(u)) return u;
      } catch (e) { /* 该曲目不可播，下一首 */ }
    }
    throw new Error(plat + ' 无可播同曲');
  };
  return (async () => {
    const errs = [];
    for (const plat of order) {
      try {
        const u = await tryOne(plat);
        if (crossCache.size > 120) crossCache.clear();
        crossCache.set(key, { at: Date.now(), url: u });
        return u;
      } catch (e) { errs.push(e.message); }
    }
    throw new Error('跨平台取链失败: ' + errs.join('；'));
  })();
}

lx.send(lx.EVENT_NAMES.inited, unified);
