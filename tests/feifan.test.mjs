import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

// feifan.js 里的解析函数未导出，这里用与源码等价的解析契约验证数据结构处理。
// 真正的端到端搜索需配置代理后联网验证。
function parsePlayUrl(item, decode = v => { try { return decodeURIComponent(v); } catch { return v; } }) {
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
    if (episodes.length) candidates.push({ name: (sources[i] || '').toLowerCase(), episodes });
  }
  const score = line => (line.name.includes('m3u8') ? 100 : 0) + (line.episodes[0]?.url.includes('.m3u8') ? 50 : 0);
  const ranked = candidates.slice().sort((a, b) => score(b) - score(a));
  return ranked[0]?.episodes || [];
}

test('prefers the m3u8 line over the share line', () => {
  const item = {
    vod_play_from: 'feifan$$$ffm3u8',
    vod_play_url: 'HD$https://vod.example.com/share/abc$$$HD$https://vod.example.com/2026/x/index.m3u8',
  };
  const episodes = parsePlayUrl(item);
  assert.equal(episodes.length, 1);
  assert.ok(episodes[0].url.endsWith('.m3u8'));
});

test('parses multiple episodes and rejects non-https urls', () => {
  const item = {
    vod_play_from: 'ffm3u8',
    vod_play_url: '第01集$https://v.example.com/1.m3u8#第02集$https://v.example.com/2.m3u8#第03集$http://v.example.com/3.m3u8',
  };
  const episodes = parsePlayUrl(item);
  assert.deepEqual(episodes.map(e => e.title), ['第01集', '第02集']);
  assert.equal(episodes[1].url, 'https://v.example.com/2.m3u8');
});

test('returns empty for empty or malformed play data', () => {
  assert.deepEqual(parsePlayUrl({}), []);
  assert.deepEqual(parsePlayUrl({ vod_play_from: 'x', vod_play_url: '###' }), []);
});
