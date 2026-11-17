// Cloudflare Worker: 代理非凡 CMS 采集接口，给纯静态前端补上跨域头。
// 视频流(m3u8)不经过此 Worker —— 播放域名本身已开放 CORS，浏览器直连。

const UPSTREAM = 'https://cj.ffzyapi.com/api.php/provide/vod/';
// 只允许你自己的站点使用，避免被他人盗用。部署后按需改成你的域名；留空表示放行所有来源。
const ALLOWED_ORIGIN = 'https://madcpt.github.io';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// 只透传这些参数，防止接口被当成任意 URL 转发器。
const PASSTHROUGH = new Set(['wd', 'ac', 'ids', 'pg', 'pagesize', 'h', 't']);

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    const origin = request.headers.get('Origin') || '';
    if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403, headers: CORS });
    }

    const incoming = new URL(request.url);
    const upstream = new URL(UPSTREAM);
    for (const key of PASSTHROUGH) {
      const value = incoming.searchParams.get(key);
      if (value !== null) upstream.searchParams.set(key, value);
    }

    try {
      const response = await fetch(upstream.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Referer': 'https://cj.ffzyapi.com/',
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          ...CORS,
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'upstream unavailable', detail: String(error) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
      });
    }
  },
};
