/* ============================================================
 * StarWish B 站音源 v1.0.0（starwish-bilibili.js）
 * 覆盖：B 站（视频分P解析，lx-music v2 协议）
 * 参考 v1.1 文档 §2.1.1 音源 B：
 *   - 歌单 = 视频合集（ugc_season），歌曲 = 视频分 P
 *   - 播放必须指定 cid（分 P ID），不能只用 bvid
 * 登录态：未登录可用公开搜索 + 低清晰度播放流；扫码授权（SESSDATA）后解锁 720P+ 与个人内容。
 * ============================================================ */
const bili = {
  name: 'B 站音源',
  version: '1.0.0',
  author: 'StarWish Team',
  description: 'B 站视频分P解析音源（未登录：公开搜索+低清流；扫码登录解锁高清）',
  homepage: '',
  sources: {
    bili: { name: 'B站', actions: ['musicSearch', 'musicUrl', 'pic', 'video'], qualitys: ['128k'] },
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
const COOKIE = 'buvid3=' + Math.random().toString(36).slice(2, 12) + 'infoc; b_nut=' + Date.now();

/* ---------------- 搜索（B 站公开搜索） ---------------- */
async function searchBili(kw, page, size) {
  const r = await req('https://api.bilibili.com/x/web-interface/wbi/search/type?' + qs({ search_type: 'video', keyword: kw, page: page || 1, page_size: size || 20 }), { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: COOKIE } });
  const list = (r && r.data && r.data.result) || [];
  const songs = [];
  for (const v of list) {
    if (!v.bvid) continue;
    try {
      const parts = await req('https://api.bilibili.com/x/player/pagelist?' + qs({ bvid: v.bvid }), { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
      const pages = (parts && parts.data) || [];
      if (!pages.length) {
        songs.push({
          name: v.title || '', singer: v.author || 'B站UP主', albumName: 'B站音乐区',
          duration: v.duration || 0, songId: v.bvid + '-p1', bvid: v.bvid, cid: 0,
          pic: (v.pic || '').replace(/^\/\//, 'https://'), source: 'bili', qualitys: ['128k'],
        });
        continue;
      }
      pages.forEach(p => songs.push({
        name: p.part || v.title, singer: v.author || 'B站UP主', albumName: 'B站音乐区 · ' + v.title,
        duration: p.duration || 0, songId: v.bvid + '-p' + p.page, bvid: v.bvid, cid: p.cid,
        pic: (v.pic || '').replace(/^\/\//, 'https://'), source: 'bili', qualitys: ['128k'],
      }));
    } catch (e) { /* 单个视频分P失败跳过 */ }
  }
  return songs;
}

/* ---------------- 播放流（未登录低清；登录后高清） ---------------- */
async function urlBili(mi) {
  const bvid = mi.bvid || mi.songId && mi.songId.split('-p')[0];
  const cid = mi.cid;
  if (!bvid || !cid) throw new Error('缺 bvid/cid');
  const r = await req('https://api.bilibili.com/x/player/playurl?' + qs({ bvid, cid, fnval: 16, fourk: 1, qn: 64 }), { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
  const d = r && r.data;
  const durl = d && d.durl && d.durl[0];
  if (!durl || !durl.url) throw new Error('无播放流（可能需要登录）');
  return durl.url.replace(/^\/\//, 'https://');
}

/* ---------------- 歌词（B 站无歌词，标空） ---------------- */
async function lyricBili() { throw new Error('B站无歌词'); }
/* ---------------- 封面（视频封面即专辑图） ---------------- */
async function picBili(mi) {
  if (!mi.pic) throw new Error('无封面');
  return { url: mi.pic };
}
/* ---------------- 视频流（MV 页用） ---------------- */
async function videoBili(mi) { return urlBili(mi); }

lx.on(lx.EVENT_NAMES.request, (data) => {
  const p = String(data.source || '');
  const action = String(data.action || '');
  const info = data.info || {};
  const mi = info.musicInfo || {};
  const kw = String(info.keyword || (mi.searchTerm || ''));
  const page = Number(info.page) || 1;
  const size = Number(info.pagesize) || 20;
  if (p !== 'bili') return Promise.reject(new Error('不支持的平台: ' + p));
  if (action === 'musicSearch') return searchBili(kw, page, size);
  if (action === 'musicUrl') return urlBili(mi);
  if (action === 'pic') return picBili(mi);
  if (action === 'video') return videoBili(mi);
  return Promise.reject(new Error('不支持的请求: ' + action));
});

lx.send(lx.EVENT_NAMES.inited, bili);
