import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
vm.runInThisContext(readFileSync(new URL('../vendor/crypto-js.js', import.meta.url), 'utf8'));
const { decodePayload, safeMediaUrl, imageUrl } = await import('../api.js');
const fixture = { id: 42, name: '<img src=x onerror=alert(1)>', urls: [{ index: 1, url: 'https://example.com/master.m3u8' }] };
function encode(date) {
  const key = Buffer.from(createHash('md5').update(date).digest('hex').slice(8, 24));
  const cipher = createCipheriv('aes-128-cbc', key, key);
  return Buffer.concat([cipher.update(JSON.stringify(fixture)), cipher.final()]).toString('base64');
}
test('decodes a public API response using interoperable AES and keeps text as data', () => {
  assert.deepEqual(decodePayload(encode('2026-11-17'), 'Tue, 17 Nov 2026 12:00:00 GMT'), fixture);
});
test('handles the source date changing at midnight', () => {
  assert.deepEqual(decodePayload(encode('2026-11-18'), 'Tue, 17 Nov 2026 23:59:59 GMT'), fixture);
  assert.deepEqual(decodePayload(encode('2026-11-16'), 'Tue, 17 Nov 2026 00:00:01 GMT'), fixture);
});
test('reports incompatible source data and accepts unencoded objects', () => {
  assert.throws(() => decodePayload('malformed', 'Tue, 17 Nov 2026 12:00:00 GMT'), /格式已变化/);
  assert.deepEqual(decodePayload(fixture), fixture);
});
test('only accepts HTTPS media and posters', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com/video', '/relative', '', null]) assert.equal(safeMediaUrl(url), null);
  assert.equal(safeMediaUrl('https://example.com/master.m3u8'), 'https://example.com/master.m3u8');
  assert.equal(imageUrl({ pic: 'javascript:alert(1)' }), '');
  assert.equal(imageUrl({ pic: 'upload/poster.jpg' }), 'https://static.olelive.com/upload/poster.jpg');
});
