// Cloudflare Worker: 代理 CMS 采集接口 + 邀请码访问控制。
// 视频流(m3u8)不经过此 Worker —— 播放域名本身已开放 CORS，浏览器直连。
// 支持多个上游源：feifan(非凡) / lianti(360)，通过 src 参数选择。
//
// 访问控制：真实邀请码保存在 Worker 的 Secret 变量 INVITE_CODE 中，
// 不写在此文件里（此文件的源码在公开仓库中）。每个请求必须带 ?k=<邀请码>；
// ?verify=1&k=<邀请码> 是纯校验端点，不访问上游，供前端解锁时使用。

const UPSTREAMS = {
  feifan: 'https://cj.ffzyapi.com/api.php/provide/vod/',
  lianti: 'https://360zyzz.com/api.php/provide/vod/',
};
// 只允许你自己的站点使用，避免被他人盗用。留空表示放行所有来源。
const ALLOWED_ORIGIN = 'https://madcpt.github.io';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// 只透传这些参数，防止接口被当成任意 URL 转发器。
const PASSTHROUGH = new Set(['wd', 'ac', 'ids', 'pg', 'pagesize', 'h', 't']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

export default {
  async fetch(request, env) {
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

    // 邀请码从 Secret 读取；未配置时不拦截（便于本地开发调试）。
    const expected = String(env?.INVITE_CODE || '').trim();
    const provided = (incoming.searchParams.get('k') || '').trim();
    const authed = !expected || (provided && provided === expected);

    // 纯校验端点：只判断邀请码是否正确，不访问上游、不缓存结果。
    if (incoming.searchParams.get('verify') === '1') {
      return authed ? json({ ok: true }) : json({ ok: false, error: 'invalid invite code' }, 403);
    }

    if (!authed) {
      return json({ error: 'invalid invite code' }, 403);
    }

    const src = incoming.searchParams.get('src');
    const upstreamBase = UPSTREAMS[src] || UPSTREAMS.feifan;
    const upstream = new URL(upstreamBase);
    for (const key of PASSTHROUGH) {
      const value = incoming.searchParams.get(key);
      if (value !== null) upstream.searchParams.set(key, value);
    }

    try {
      const response = await fetch(upstream.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Referer': new URL(upstreamBase).origin + '/',
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
      return json({ error: 'upstream unavailable', detail: String(error) }, 502);
    }
  },
};
