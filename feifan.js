// 非凡（苹果 CMS V10）片源适配。
// 搜索/详情走用户自建的 Cloudflare Worker 代理（CMS 接口无 CORS）；
// 视频 m3u8 由浏览器直连源站（播放域名已开放 CORS）。

const DEFAULT_PROXY = 'https://pianke-proxy.zhxu98.workers.dev'; // 自建 Cloudflare Worker 代理（见 README）
let proxyBase = DEFAULT_PROXY;

export function setProxyUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error();
    proxyBase = parsed.origin + parsed.pathname.replace(/\/$/, '');
  } catch { throw new Error('代理地址必须是 https:// 开头的有效网址。'); }
}
export function getProxyUrl() { return proxyBase; }
export function isProxyConfigured() { return !!proxyBase; }

async function request(params, signal) {
  if (!proxyBase) throw new Error('请先配置代理地址（见 README 的部署步骤）。');
  const url = new URL(proxyBase);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetch(url.toString(), {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) throw new Error(`非凡代理暂时不可用（${response.status}）。`);
    const body = await response.json();
    if (body.error || body.code !== 1) throw new Error('非凡接口返回异常，请稍后重试。');
    return body;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error.name === 'AbortError'
      ? new Error('连接非凡代理超时，请检查网络后重试。')
      : error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function parsePlayUrl(item) {
  const fromRaw = item.vod_play_from || '';
  const urlRaw = item.vod_play_url || '';
  const sources = fromRaw.split('$$$');
  const blocks = urlRaw.split('$$$');
  const candidates = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i]) continue;
    const episodes = [];
    for (const piece of blocks[i].split('#')) {
      if (!piece) continue;
      const sep = piece.indexOf('$');
      const title = sep === -1 ? '' : decode(piece.slice(0, sep));
      const url = (sep === -1 ? piece : piece.slice(sep + 1)).trim();
      if (/^https:\/\//i.test(url)) episodes.push({ title, url });
    }
    if (episodes.length) {
      const name = (sources[i] || '').toLowerCase();
      candidates.push({ name, episodes });
    }
  }
  // 优先带 m3u8/iFrame 标识的线路，避免落到 share 分享页；其次取第一集为 m3u8 的线路。
  const ranked = candidates.slice().sort((a, b) => scoreLine(b) - scoreLine(a));
  return ranked[0]?.episodes || [];
}
function scoreLine(line) {
  let score = 0;
  if (line.name.includes('m3u8')) score += 100;
  if (line.episodes[0]?.url.includes('.m3u8')) score += 50;
  return score;
}

function toMovie(item) {
  const episodes = parsePlayUrl(item);
  return {
    id: item.vod_id,
    name: item.vod_name || '未命名',
    year: item.vod_year || '',
    area: item.vod_area || '',
    typeIdName: item.type_name || '',
    lang: item.vod_lang || '',
    score: item.vod_score || item.vod_douban_score || '',
    remarks: item.vod_remarks || '',
    pic: item.vod_pic || '',
    urls: episodes.map((episode, index) => ({ index: index + 1, title: episode.title || `第 ${index + 1} 集`, url: episode.url, vip: false })),
  };
}

export async function searchMovies(query, page = 1, signal) {
  const body = await request({ wd: query, pg: page, pagesize: 20 }, signal);
  const list = body.list || [];
  const total = Number(body.total || 0);
  return { items: list.map(toMovie), total, page };
}

export async function movieDetails(id, signal) {
  if (!/^\d+$/.test(String(id))) throw new Error('片源编号无效。');
  const body = await request({ ac: 'detail', ids: id }, signal);
  const item = (body.list || [])[0];
  if (!item) throw new Error('没有找到这个片源，请返回重新搜索。');
  const movie = toMovie(item);
  if (!movie.urls.length) throw new Error('这个片源没有可用的 HTTPS 播放地址。');
  return movie;
}

export function imageUrl(item) {
  const value = item.pic;
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

export function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}
