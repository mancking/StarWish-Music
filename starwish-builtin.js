/*!
 * @name 星愿内置音源
 * @description StarWish Music 官方内置音源：国际曲库（iTunes 官方 API，浏览器直连可用）+ 酷我直链（溯音）。
 *   作者：StarWish Music 开发组
 *   协议：lx-music v2（globalThis.lx）
 */
const { EVENT_NAMES, request, on, send, utils } = globalThis.lx;

const HTTP_URL_REGEX = /^https?:\/\//i;

/* ---------------- HTTP 工具 ---------------- */
function httpRequest(url, options = { method: 'GET' }) {
  return new Promise((resolve, reject) => {
    request(url, { timeout: 12000, ...options }, (err, res) => {
      if (err) return reject(new Error('请求错误: ' + (err && err.message || err)));
      let body = res && res.body;
      if (typeof body === 'string') {
        const t = body.trim();
        if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) {
          try { body = JSON.parse(t); } catch (e) { /* 保留原文 */ }
        }
      }
      resolve({ statusCode: res ? res.statusCode : 0, headers: (res && res.headers) || {}, body });
    });
  });
}

async function httpGet(url, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  const full = url + (qs ? (url.includes('?') ? '&' : '?') + qs : '');
  const res = await httpRequest(full, { method: 'GET' });
  if (res.statusCode >= 400) throw new Error('HTTP错误: ' + res.statusCode);
  return res.body;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/* ---------------- 国际曲库（iTunes） ---------------- */
const ITUNES_API = 'https://itunes.apple.com/search';

async function itunesSearch(keyword, page = 1, pageSize = 30) {
  const limit = Math.min(Math.max(Number(pageSize) || 30, 1), 200);
  const offset = Math.max(Number(page) || 1, 1) - 1;
  const res = await httpGet(ITUNES_API, {
    term: keyword, media: 'music', entity: 'song', limit, offset: offset * limit, country: 'US'
  });
  const items = Array.isArray(res && res.results) ? res.results : [];
  const list = items.map(t => {
    const duration = Math.round((t.trackTimeMillis || 0) / 1000);
    return {
      songId: 'it' + t.trackId,
      songmid: 'it' + t.trackId,
      id: 'it' + t.trackId,
      name: t.trackName || '未知歌曲',
      singer: t.artistName || '未知歌手',
      albumName: t.collectionName || '',
      duration,
      pic: (t.artworkUrl100 || '').replace(/100x100/, '600x600'),
      source: 'it',
      qualitys: ['128k'],
      _interval: duration,
      _url: t.previewUrl || '',
      _trackId: t.trackId
    };
  });
  return { isEnd: list.length < limit, total: res && res.resultCount || list.length, list };
}

async function itunesGetUrl(songInfo) {
  if (songInfo && songInfo._url && HTTP_URL_REGEX.test(songInfo._url)) return songInfo._url;
  if (!songInfo || !songInfo._trackId) throw new Error('iTunes 缺少 trackId');
  const res = await httpGet(ITUNES_API, { term: songInfo._trackId, media: 'music', entity: 'song', limit: 1, country: 'US' });
  const first = Array.isArray(res && res.results) ? res.results[0] : null;
  if (first && first.previewUrl) return first.previewUrl;
  throw new Error('iTunes 未返回试听链接');
}

/* ---------------- 酷我直链（溯音） ---------------- */
const SUYIN_KUWO_API = 'https://oiapi.net/api/Kuwo';

function parseMessageSongInfo(message) {
  if (!message) return null;
  const r = {};
  for (const line of String(message).split('\n')) {
    if (line.startsWith('歌名：')) r.song = line.slice(3).trim();
    if (line.startsWith('歌手：')) r.singer = line.slice(3).trim();
    if (line.startsWith('专辑：')) r.album = line.slice(3).trim();
  }
  return r.song ? r : null;
}

async function kuwoSearch(keyword) {
  const res = await httpGet(SUYIN_KUWO_API, { msg: keyword, n: 1, br: 1 });
  const message = typeof res === 'object' && typeof res.message === 'string' ? res.message : '';
  const url = (res && res.data && res.data.url) || (message.match(/音乐链接[：:](\S+)/) || [])[1] || '';
  if (!url) throw new Error('溯音酷我无结果');
  const parsed = parseMessageSongInfo(message);
  return [{
    songId: 'kw_' + String(url).slice(0, 40),
    songmid: 'kw_' + String(url).slice(0, 40),
    id: 'kw_' + String(url).slice(0, 40),
    name: (parsed && parsed.song) || keyword,
    singer: (parsed && parsed.singer) || '未知歌手',
    albumName: (parsed && parsed.album) || '',
    pic: (message.match(/img=(\S+)/) || [])[1] || '',
    source: 'kw',
    qualitys: ['flac', '320k', '128k'],
    _url: url
  }];
}

/* ---------------- 搜索 ---------------- */
async function search(keyword, page = 1, pageSize = 30) {
  if (!keyword) return { isEnd: true, list: [] };
  const errors = [];
  try {
    return await itunesSearch(keyword, page, pageSize);
  } catch (e) { errors.push('iTunes:' + (e && e.message || e)); }
  try {
    const list = await kuwoSearch(keyword);
    if (list.length) return { isEnd: true, total: list.length, list };
  } catch (e) { errors.push('酷我:' + (e && e.message || e)); }
  return { isEnd: true, list: [], total: 0, error: errors.join('；') };
}

/* ---------------- URL / 歌词 ---------------- */
async function getUrl(source, songInfo, quality) {
  if (!songInfo || typeof songInfo !== 'object') throw new Error('请求参数不完整');
  if (source === 'it') return itunesGetUrl(songInfo);
  if (source === 'kw' && songInfo._url && HTTP_URL_REGEX.test(songInfo._url)) return songInfo._url;
  throw new Error('星愿内置音源不支持该平台: ' + source);
}

/* ---------------- 注册 ---------------- */
const sourceConfig = {
  it: { name: '国际曲库(iTunes)', type: 'music', actions: ['musicSearch', 'musicUrl'], qualitys: ['128k'] },
  kw: { name: '酷我直链', type: 'music', actions: ['musicSearch', 'musicUrl'], qualitys: ['128k', '320k', 'flac'] }
};

on(EVENT_NAMES.request, ({ action, source, info }) => {
  if (action === 'musicSearch' || action === 'search') {
    const mi = (info && info.musicInfo) || {};
    const keyword = String(mi.searchTerm || mi.keyword || info && info.keyword || '').trim();
    const page = Number((info && info.page) || 1);
    const pageSize = Number((info && info.pagesize) || 30);
    return search(keyword, page, pageSize);
  }
  if (action === 'musicUrl') {
    return getUrl(source, (info && info.musicInfo), (info && info.type) || '128k');
  }
  return Promise.reject(new Error('action not support'));
});

send(EVENT_NAMES.inited, { sources: sourceConfig });

console.log('星愿内置音源 已加载');
