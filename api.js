// Public endpoints used by olevod.com's web client. No cookies or accounts are sent.
const API = 'https://api.olelive.com';
export const IMAGE_BASE = 'https://static.olelive.com/';
const md5 = text => globalThis.CryptoJS.MD5(text).toString();

export function requestStamp(timestamp = Math.floor(Date.now() / 1000)) {
  const text = String(timestamp);
  const columns = ['', '', '', ''];
  for (const digit of text) {
    const bits = digit.charCodeAt(0).toString(2);
    columns[0] += bits.slice(2, 3);
    columns[1] += bits.slice(3, 4);
    columns[2] += bits.slice(4, 5);
    columns[3] += bits.slice(5);
  }
  const parts = columns.map(bits => parseInt(bits, 2).toString(16).padStart(3, '0'));
  const digest = md5(text);
  return digest.slice(0, 3) + parts[0] + digest.slice(6, 11) + parts[1] +
    digest.slice(14, 19) + parts[2] + digest.slice(22, 27) + parts[3] + digest.slice(30);
}

export function decodePayload(data, serverDate) {
  if (typeof data !== 'string') return data;
  const base = serverDate ? new Date(serverDate) : new Date();
  const dates = new Set();
  // The source rotates its public response key daily. Accommodate timezone edges.
  for (const delta of [0, -1, 1]) {
    const date = new Date(base.getTime() + delta * 86400000);
    dates.add(date.toISOString().slice(0, 10));
    dates.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  }
  for (const date of dates) {
    try {
      const crypto = globalThis.CryptoJS;
      const key = crypto.enc.Utf8.parse(md5(date).slice(8, 24));
      const decoded = crypto.AES.decrypt(data, key, { iv: key, mode: crypto.mode.CBC, padding: crypto.pad.Pkcs7 });
      return JSON.parse(crypto.enc.Utf8.stringify(decoded));
    } catch { /* Try the adjacent source date. */ }
  }
  throw new Error('欧乐返回的数据格式已变化，请稍后重试。');
}

async function request(path, signal) {
  if (!globalThis.CryptoJS) throw new Error('播放器组件未加载，请刷新页面。');
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), 16000);
    try {
      const response = await fetch(`${API}${path}?_vv=${requestStamp()}`, {
        mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`欧乐接口暂时不可用（${response.status}），请稍后重试。`);
      const body = await response.json();
      if (body.code !== 0) throw new Error(body.code === 12 ? '这个片源需要在欧乐登录后观看。' : '欧乐暂时无法提供这个内容，请稍后重试。');
      return decodePayload(body.data, response.headers.get('date'));
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error instanceof TypeError || error.name === 'AbortError'
        ? new Error('连接欧乐超时或网络不可用，请检查网络后重试。') : error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  throw lastError;
}

export async function searchMovies(query, page = 1, signal) {
  const data = await request(`/v1/pub/index/search/${encodeURIComponent(query)}/vod/0/${page}/20`, signal);
  const group = data?.data?.find(group => group.type === 'vod');
  const items = group?.list || [];
  return { items, total: Number(group?.total || 0), page };
}

export async function movieDetails(id, signal) {
  if (!/^\d+$/.test(String(id))) throw new Error('片源编号无效。');
  const data = await request(`/v1/pub/vod/detail/${id}/true`, signal);
  if (!data?.id || !Array.isArray(data.urls)) throw new Error('没有找到可播放的片源。');
  return data;
}

export function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function imageUrl(item) {
  const value = item.picThumb || item.pic;
  if (!value) return '';
  try {
    const url = new URL(value, IMAGE_BASE);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}
