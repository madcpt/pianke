import * as olevod from './api.js';
import * as feifan from './feifan.js';

// 片源注册表：默认非凡（1080P 高清）；欧乐、360 为备选。
// 三源共用同一道门禁；非凡/360 经同一 Worker 代理（src 区分上游）。
// 非凡部分播放域名有地域封锁，movieDetails 会自动回退到 360 源同名影片。
const SOURCES = {
  olevod: { label: '欧乐', adapter: olevod, needsProxy: false, note: '欧乐 · 速度快、无需配置' },
  feifan: { label: '非凡', adapter: feifan, needsProxy: true, note: '非凡 · 1080P 高清片源' },
  lianti: { label: '360', adapter: feifan.lianti, needsProxy: true, note: '360 · 备用高清源、直连可播' },
};
let currentSource = 'feifan';
const active = () => SOURCES[currentSource].adapter;

const $ = id => document.getElementById(id);
const video = $('video');

// ---- 访问码门禁 ----
// 专属链接形如 ?k=访问码；校验通过后把码存本地，之后自动解锁。
// 校验完全交给 Worker（真码只在 Worker 的 Secret 里），前端不存储任何明文对比值。
const INVITE_KEY = 'pianke-invite';
const gate = $('gate');
const gateForm = $('gate-form');
const gateInput = $('gate-code');
const gateError = $('gate-error');
const gateSubmit = $('gate-submit');
let unlocked = false;

function showGateError(text) {
  gateError.textContent = text || '';
  gateError.hidden = !text;
}

function rememberInvite(code) {
  try { localStorage.setItem(INVITE_KEY, code); } catch { /* storage disabled */ }
}
function forgetInvite() {
  try { localStorage.removeItem(INVITE_KEY); } catch { /* storage disabled */ }
}
function storedInvite() {
  try { return localStorage.getItem(INVITE_KEY) || ''; } catch { return ''; }
}

async function unlockWith(code) {
  const value = String(code || '').trim().slice(0, 64);
  if (!value) { showGateError('请输入访问码。'); return; }
  gateSubmit.disabled = true;
  gateSubmit.textContent = '验证中…';
  showGateError('');
  try {
    const ok = await feifan.verifyInvite(value);
    if (!ok) {
      forgetInvite();
      showGateError('访问码不正确，请检查后重试。');
      return;
    }
    feifan.setInviteCode(value);
    rememberInvite(value);
    unlocked = true;
    gate.hidden = true;
    document.body.classList.remove('locked');
    // 从地址栏移除 k，避免访问码留在链接/历史里
    const url = new URL(location.href);
    if (url.searchParams.has('k')) { url.searchParams.delete('k'); history.replaceState(null, '', url); }
    bootstrap();
  } catch (error) {
    showGateError(error.message || '验证失败，请稍后重试。');
  } finally {
    gateSubmit.disabled = false;
    gateSubmit.innerHTML = '进入 <span aria-hidden="true">↗</span>';
  }
}

gateForm.addEventListener('submit', event => {
  event.preventDefault();
  unlockWith(gateInput.value);
});

let searchController, detailController, hls, selectedMovie, selectedEpisode;
let query = '', page = 0, total = 0, shown = 0, streamVersion = 0;
let resultsLoading = false, retrying = false, stalls = 0, loadingTimer;
const help = $('help-dialog');
const airplaySupported = typeof video.webkitShowPlaybackTargetPicker === 'function';
const remoteSupported = !!video.remote && typeof video.remote.prompt === 'function';
$('cast-label').textContent = airplaySupported ? 'AirPlay 投屏' : '投屏';
$('help-button').addEventListener('click', () => help.showModal());
$('close-help').addEventListener('click', () => help.close());
$('help-done').addEventListener('click', () => help.close());
help.addEventListener('click', event => { if (event.target === help) { const r = help.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) help.close(); } });

$('cast-button').addEventListener('click', () => {
  if (!selectedEpisode || !video.currentSrc) { help.showModal(); return; }
  try {
    if (airplaySupported) video.webkitShowPlaybackTargetPicker();
    else if (remoteSupported) video.remote.prompt().catch(error => {
      if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') help.showModal();
    });
    else help.showModal();
  } catch { help.showModal(); }
});
video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
  const connected = !!video.webkitCurrentPlaybackTargetIsWireless;
  $('cast-button').classList.toggle('connected', connected);
  $('cast-label').textContent = connected ? 'AirPlay 已连接' : 'AirPlay 投屏';
});
if (video.remote) {
  for (const event of ['connect', 'disconnect']) video.remote.addEventListener(event, () => {
    const connected = video.remote.state === 'connected';
    $('cast-button').classList.toggle('connected', connected);
    $('cast-label').textContent = connected ? '已连接大屏' : (airplaySupported ? 'AirPlay 投屏' : '投屏');
  });
}

function overlay(text) {
  $('video-overlay-text').textContent = text || '';
  $('video-overlay').hidden = !text;
}
function videoError(text) {
  clearTimeout(loadingTimer);
  $('playback-error').textContent = text;
  $('playback-error').hidden = !text;
  if (text) { overlay(''); $('playback-status').textContent = '片源暂时无法播放'; }
}
function clearStream() {
  streamVersion++;
  clearTimeout(loadingTimer);
  if (hls) { hls.destroy(); hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
}
function closePlayer() {
  detailController?.abort();
  selectedMovie = selectedEpisode = null;
  clearStream();
  $('player-section').hidden = true;
  document.body.classList.remove('video-active');
  document.title = '片刻 · 搜索你想看的';
}
$('close-player').addEventListener('click', closePlayer);

function startEpisode(episode, position = 0) {
  clearStream();
  selectedEpisode = episode;
  retrying = false; stalls = 0;
  const version = streamVersion;
  videoError('');
  overlay('正在连接片源…');
  $('playback-status').textContent = '正在加载 · ' + episode.title;
  for (const button of $('episodes').children) button.setAttribute('aria-pressed', String(Number(button.dataset.index) === episode.index));
  const url = active().safeMediaUrl(episode.url);
  if (!url) { videoError('这个片源没有可用的 HTTPS 视频地址，请选择其他剧集。'); return; }
  // Native HLS keeps the actual HTTPS media URL on the video element, enabling AirPlay.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.load();
  } else if (globalThis.Hls?.isSupported()) {
    hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, maxBufferSize: 30 * 1024 * 1024 });
    const instance = hls;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (version !== streamVersion || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && stalls++ < 2) {
        $('playback-status').textContent = '网络不稳定，正在重试…';
        instance.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && stalls++ < 2) instance.recoverMediaError();
      else videoError(`${SOURCES[currentSource].label}片源加载失败。请点“重新加载”，或稍后再试。`);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } else { videoError('当前浏览器不支持此视频格式，请使用 Safari 或新版 Chrome。'); return; }
  loadingTimer = setTimeout(() => {
    if (version === streamVersion && video.readyState < 2) videoError('视频加载较慢或片源不可用。请点击“重新加载”重试。');
  }, 35000);
  if (position > 0) video.addEventListener('loadedmetadata', () => {
    if (version === streamVersion) video.currentTime = Math.min(position, Math.max(0, video.duration - 1));
  }, { once: true });
  video.play().catch(() => {
    if (version !== streamVersion) return;
    overlay('');
    if (!video.error) $('playback-status').textContent = '点击视频中的播放按钮开始';
  });
}

async function openMovie(id, trigger) {
  detailController?.abort();
  const controller = new AbortController(); detailController = controller;
  clearStream();
  selectedMovie = selectedEpisode = null;
  $('player-section').hidden = false;
  document.body.classList.add('video-active');
  $('video-title').textContent = trigger?.dataset.name || '正在获取片源…';
  $('video-meta').textContent = '';
  $('episodes').replaceChildren(); $('episode-count').textContent = '';
  $('playback-status').textContent = '正在获取播放地址…';
  videoError(''); overlay('正在获取片源…');
  $('player-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  try {
    const movie = await active().movieDetails(id, controller.signal);
    if (controller.signal.aborted) return;
    selectedMovie = movie;
    $('video-title').textContent = movie.name;
    document.title = `${movie.name} · 片刻`;
    $('video-meta').textContent = [movie.year, movie.area, movie.typeIdName, movie.lang].filter(Boolean).join(' / ');
    $('episode-count').textContent = `${movie.urls.length} 集`;
    for (const episode of movie.urls) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'episode';
      button.textContent = episode.title || `第 ${episode.index} 集`;
      button.dataset.index = episode.index; button.setAttribute('aria-pressed', 'false');
      button.disabled = !!episode.vip || !active().safeMediaUrl(episode.url);
      if (episode.vip) { button.textContent += ' · VIP'; button.title = '此片源需要会员'; }
      button.addEventListener('click', () => startEpisode(episode));
      $('episodes').append(button);
    }
    const first = movie.urls.find(episode => !episode.vip && active().safeMediaUrl(episode.url));
    if (first) startEpisode(first);
    else videoError('这个内容没有可直接播放的公开片源，可能需要会员。');
  } catch (error) {
    if (!controller.signal.aborted) videoError(error.message || '无法获取片源，请重试。');
  }
}

$('retry-video').addEventListener('click', async () => {
  if (!selectedMovie || !selectedEpisode || retrying) return;
  retrying = true;
  const movieId = selectedMovie.id, episodeIndex = selectedEpisode.index, position = video.currentTime || 0;
  const version = streamVersion;
  $('retry-video').disabled = true;
  $('playback-status').textContent = '正在刷新片源…';
  try {
    const fresh = await active().movieDetails(movieId);
    if (version !== streamVersion || selectedMovie?.id !== movieId) return;
    selectedMovie = fresh;
    const episode = fresh.urls.find(item => item.index === episodeIndex && !item.vip);
    if (!episode) throw new Error('这个片源已不可用，请重新选择。');
    startEpisode(episode, position);
  } catch (error) { if (version === streamVersion) videoError(error.message); }
  finally { retrying = false; $('retry-video').disabled = false; }
});
for (const event of ['loadedmetadata', 'canplay']) video.addEventListener(event, () => {
  if (!selectedEpisode) return;
  clearTimeout(loadingTimer); overlay('');
  if (video.paused) $('playback-status').textContent = '已就绪 · 点击视频开始播放';
});
video.addEventListener('playing', () => { if (!selectedEpisode) return; clearTimeout(loadingTimer); overlay(''); videoError(''); $('playback-status').textContent = '正在播放 · ' + selectedEpisode.title; });
video.addEventListener('waiting', () => { if (selectedEpisode) $('playback-status').textContent = '正在缓冲…'; });
video.addEventListener('pause', () => { if (selectedEpisode && !video.ended) $('playback-status').textContent = '已暂停'; });
video.addEventListener('error', () => { if (selectedEpisode && !hls && video.error) videoError('视频源暂时无法播放，请点“重新加载”重试。'); });
video.addEventListener('ended', () => { $('playback-status').textContent = '本集播放结束'; });

function appendResults(items) {
  for (const item of items) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'movie'; button.dataset.name = item.name;
    button.setAttribute('aria-label', `播放 ${item.name}`);
    const poster = document.createElement('div'); poster.className = 'poster';
    const placeholder = document.createElement('span'); placeholder.className = 'poster-placeholder'; placeholder.textContent = '片刻'; placeholder.setAttribute('aria-hidden', 'true'); poster.append(placeholder);
    const src = active().imageUrl(item);
    if (src) {
      const img = document.createElement('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove(), { once: true }); poster.append(img);
    }
    if (Number(item.score) > 0) { const score = document.createElement('span'); score.className = 'score'; score.textContent = Number(item.score).toFixed(1); poster.append(score); }
    if (item.remarks || item.vip) { const remark = document.createElement('span'); remark.className = 'remark'; remark.textContent = [item.remarks, item.vip ? 'VIP' : ''].filter(Boolean).join(' · '); poster.append(remark); }
    const title = document.createElement('h3'); title.textContent = item.name;
    const meta = document.createElement('p'); meta.textContent = [item.year, item.area].filter(Boolean).join(' / ');
    button.append(poster, title, meta); button.addEventListener('click', () => openMovie(item.id, button));
    $('results').append(button);
  }
}

async function runSearch(nextQuery, append = false) {
  if (append && resultsLoading) return;
  searchController?.abort();
  const controller = new AbortController(); searchController = controller;
  if (!append) {
    query = nextQuery; page = 0; shown = 0; total = 0;
    $('results').replaceChildren();
    closePlayer();
    const url = new URL(location.href); url.searchParams.set('q', query); history.replaceState(null, '', url);
  }
  resultsLoading = true;
  $('load-more').disabled = true; $('search-button').setAttribute('aria-busy', 'true');
  $('results-section').hidden = false; $('empty-state').hidden = true;
  document.body.classList.add('has-results');
  $('results-title').textContent = `“${query}”`;
  $('results-count').textContent = '';
  $('search-status').textContent = append ? '正在加载更多…' : `正在搜索${SOURCES[currentSource].label}片源…`;
  $('load-more').hidden = true;
  try {
    const result = await active().searchMovies(query, page + 1, controller.signal);
    if (controller.signal.aborted) return;
    page = result.page; total = result.total; shown += result.items.length;
    appendResults(result.items);
    $('results-count').textContent = `共 ${total} 部`;
    $('search-status').textContent = shown ? '' : '没有找到相关片源，试试更短的片名或其他关键词。';
    $('load-more').hidden = shown >= total || result.items.length === 0;
    $('load-more').textContent = '加载更多 ↓';
  } catch (error) {
    if (!controller.signal.aborted) {
      $('search-status').textContent = error.message || '搜索失败，请稍后重试。';
      $('load-more').hidden = false;
      $('load-more').textContent = '重试搜索';
    }
  } finally {
    if (!controller.signal.aborted) {
      resultsLoading = false;
      $('load-more').disabled = false;
      $('search-button').removeAttribute('aria-busy');
    }
  }
}
$('search-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('query').value.trim();
  if (value) runSearch(value);
  else $('query').focus();
});
$('load-more').addEventListener('click', () => runSearch(query, true));

// ---- 片源切换与代理配置 ----
const proxyDialog = $('proxy-dialog');
const proxyInput = $('proxy-url');
const proxyError = $('proxy-error');
const sourceTabs = document.querySelectorAll('[data-source]');

function showProxyError(text) {
  proxyError.textContent = text || '';
  proxyError.hidden = !text;
}

function savedProxy() {
  try { return localStorage.getItem('pianke-feifan-proxy') || ''; } catch { return ''; }
}
function applySavedProxy() {
  const saved = savedProxy();
  if (saved) { try { feifan.setProxyUrl(saved); } catch { /* ignore stale value */ } }
}
function setActiveSource(name) {
  if (!SOURCES[name]) return;
  currentSource = name;
  for (const tab of sourceTabs) tab.setAttribute('aria-pressed', String(tab.dataset.source === name));
  const needsSetup = SOURCES[name].needsProxy && !feifan.isProxyConfigured();
  $('source-note').textContent = needsSetup
    ? `${SOURCES[name].label}源需先配置一个免费代理（见下方说明）。`
    : SOURCES[name].note;
  if (query) runSearch(query);
}
for (const tab of sourceTabs) {
  tab.addEventListener('click', () => {
    const name = tab.dataset.source;
    setActiveSource(name);
    if (SOURCES[name].needsProxy && !feifan.isProxyConfigured()) { showProxyError(''); proxyDialog.showModal(); }
  });
}
$('proxy-open').addEventListener('click', () => { proxyInput.value = savedProxy(); showProxyError(''); proxyDialog.showModal(); });
$('proxy-close').addEventListener('click', () => proxyDialog.close());
$('proxy-done').addEventListener('click', () => proxyDialog.close());
$('proxy-save').addEventListener('click', () => {
  try {
    const value = proxyInput.value.trim();
    if (!value) throw new Error('请输入代理地址。');
    feifan.setProxyUrl(value);
    try { localStorage.setItem('pianke-feifan-proxy', feifan.getProxyUrl()); } catch { /* storage disabled */ }
    showProxyError('');
    proxyDialog.close();
    setActiveSource('feifan');
  } catch (error) {
    showProxyError(error.message);
  }
});

function bootstrap() {
  applySavedProxy();
  const params = new URL(location.href).searchParams;
  const initialSource = params.get('src');
  if (initialSource && SOURCES[initialSource]) {
    currentSource = initialSource;
    for (const tab of sourceTabs) tab.setAttribute('aria-pressed', String(tab.dataset.source === currentSource));
  }
  $('source-note').textContent = SOURCES[currentSource].note;
  const initialQuery = params.get('q')?.trim().slice(0, 100);
  if (initialQuery) { $('query').value = initialQuery; runSearch(initialQuery); }
}

// 未在门禁文件中直接内联邀请码；校验一律通过 Worker 完成。
document.body.classList.add('locked');
const urlParams = new URL(location.href).searchParams;
const linkCode = urlParams.get('k')?.trim();
const savedCode = storedInvite();
if (linkCode) {
  gateInput.value = linkCode;
  unlockWith(linkCode);
} else if (savedCode) {
  // 本地有码：静默复核（真码可能已改），失败则回落到手动输入。
  (async () => {
    try {
      const ok = await feifan.verifyInvite(savedCode);
      if (ok) {
        feifan.setInviteCode(savedCode);
        unlocked = true;
        gate.hidden = true;
        document.body.classList.remove('locked');
        bootstrap();
      } else {
        forgetInvite();
        gate.hidden = false;
      }
    } catch {
      gate.hidden = false;
    }
  })();
} else {
  gate.hidden = false;
}
