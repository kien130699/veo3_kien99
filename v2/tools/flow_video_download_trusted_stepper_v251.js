/*
 * FlowVideoDownloadTrustedStepper v2.5.1
 *
 * Google Flow Vietnamese UI:
 * baseline video -> detect exact new video -> click exact card ->
 * optional more menu -> click Download/Tải xuống.
 *
 * Console JavaScript cannot create trusted pointer input, so the script
 * highlights the exact element and waits for a real user click.
 * No private API calls. No dependency on sc-* classes.
 */
(() => {
  'use strict';

  const VERSION = '2.5.1';
  const state = {
    baselineKeys: new Set(),
    targetKey: null,
    targetCard: null,
    targetMedia: null,
    lastStep: null,
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const log = (...args) => console.log(
    '%c[FlowVideoDownload]',
    'color:#8b5cf6;font-weight:bold',
    ...args,
  );
  const warn = (...args) => console.warn('[FlowVideoDownload]', ...args);

  function roots() {
    const result = [document];
    const seen = new Set(result);
    for (let index = 0; index < result.length; index += 1) {
      for (const element of result[index].querySelectorAll?.('*') || []) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          seen.add(element.shadowRoot);
          result.push(element.shadowRoot);
        }
      }
    }
    return result;
  }

  function queryAll(selector) {
    return roots().flatMap(root => {
      try { return [...root.querySelectorAll(selector)]; }
      catch { return []; }
    });
  }

  function rendered(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0
      && rect.width > 2
      && rect.height > 2;
  }

  function textOf(element) {
    if (!(element instanceof Element)) return '';
    return norm([
      element.innerText,
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('alt'),
    ].filter(Boolean).join(' '));
  }

  function iconsOf(element) {
    if (!(element instanceof Element)) return '';
    return norm([...element.querySelectorAll('i.google-symbols, i')]
      .map(icon => icon.textContent || '')
      .join(' '));
  }

  function mark(element, color = '#8b5cf6', duration = 60000) {
    if (!(element instanceof HTMLElement)) return;
    const oldOutline = element.style.outline;
    const oldOffset = element.style.outlineOffset;
    element.style.outline = `5px solid ${color}`;
    element.style.outlineOffset = '3px';
    try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    setTimeout(() => {
      element.style.outline = oldOutline;
      element.style.outlineOffset = oldOffset;
    }, duration);
  }

  async function waitFor(getter, timeoutMs, description, pollMs = 150) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = getter();
      if (value) return value;
      await sleep(pollMs);
    }
    throw new Error(`Hết thời gian chờ ${description}`);
  }

  function mediaUuid(source) {
    try {
      return new URL(source, location.href).searchParams.get('name');
    } catch {
      return String(source || '').match(/[?&]name=([0-9a-fA-F-]+)/)?.[1] || null;
    }
  }

  function sourceKey(element) {
    if (!(element instanceof Element)) return null;
    const sources = [
      element.currentSrc,
      element.src,
      element.poster,
      element.getAttribute('src'),
      element.getAttribute('poster'),
    ].filter(Boolean);

    for (const source of sources) {
      const uuid = mediaUuid(source);
      if (uuid) return `media:${uuid}`;
      const value = String(source);
      if (value && !value.startsWith('data:')) return `src:${value.split('#')[0]}`;
    }
    return null;
  }

  function hasPlaySignal(element) {
    if (!(element instanceof Element)) return false;
    const combined = `${textOf(element)} ${iconsOf(element)}`.toLowerCase();
    return /play_arrow|play_circle|play_circle_filled|movie|videocam/.test(combined)
      || !!element.querySelector('video');
  }

  function cardScore(node, media) {
    if (!(node instanceof Element)) return -Infinity;
    const rect = node.getBoundingClientRect();
    if (rect.width < 130 || rect.height < 90) return -Infinity;
    if (rect.width > innerWidth * 0.98 && rect.height > innerHeight * 0.98) return -Infinity;

    const mediaRect = media.getBoundingClientRect();
    const areaRatio = (rect.width * rect.height)
      / Math.max(1, mediaRect.width * mediaRect.height);

    let score = 0;
    if (node.querySelector('video')) score += 320;
    if (hasPlaySignal(node)) score += 260;
    if (areaRatio >= 1 && areaRatio <= 7) score += 170;
    if (areaRatio > 18) score -= 230;
    score -= Math.min(120, areaRatio * 5);
    return score;
  }

  function nearestVideoCard(media) {
    let node = media;
    const candidates = [];
    for (let depth = 0; depth < 16 && node; depth += 1, node = node.parentElement) {
      const score = cardScore(node, media) - depth * 4;
      if (Number.isFinite(score)) candidates.push({ node, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.node || media.parentElement || media;
  }

  function collectVideoCards() {
    const candidates = [];
    const seenCards = new Set();

    queryAll('video').filter(rendered).forEach((media, index) => {
      const card = nearestVideoCard(media);
      if (seenCards.has(card)) return;
      seenCards.add(card);
      const rect = card.getBoundingClientRect();
      candidates.push({
        card,
        media,
        key: sourceKey(media)
          || sourceKey(card.querySelector('img'))
          || `video:${index}:${Math.round(rect.x)}:${Math.round(rect.y)}`,
        reason: 'video-element',
        score: 1200 + rect.width * rect.height / 1000,
        rect,
      });
    });

    queryAll('i.google-symbols, i, button, [aria-label], [title]')
      .filter(rendered)
      .filter(element => /play_arrow|play_circle|play_circle_filled/i.test(
        `${textOf(element)} ${iconsOf(element)}`,
      ))
      .forEach((signal, index) => {
        const card = nearestVideoCard(signal);
        if (seenCards.has(card)) return;
        seenCards.add(card);
        const media = card.querySelector('video, img') || signal;
        const rect = card.getBoundingClientRect();
        candidates.push({
          card,
          media,
          key: sourceKey(media)
            || `play:${index}:${Math.round(rect.x)}:${Math.round(rect.y)}`,
          reason: 'play-overlay',
          score: 900 + rect.width * rect.height / 1000,
          rect,
        });
      });

    return candidates.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.rect.left !== b.rect.left) return a.rect.left - b.rect.left;
      return a.rect.top - b.rect.top;
    });
  }

  function scanVideos() {
    const candidates = collectVideoCards();
    console.table(candidates.map((item, index) => ({
      index,
      key: item.key,
      reason: item.reason,
      score: Math.round(item.score),
      x: Math.round(item.rect.x),
      y: Math.round(item.rect.y),
      width: Math.round(item.rect.width),
      height: Math.round(item.rect.height),
      text: textOf(item.card).slice(0, 120),
    })));
    return candidates.map((item, index) => ({
      index,
      key: item.key,
      reason: item.reason,
      score: Math.round(item.score),
    }));
  }

  function baseline() {
    const videos = collectVideoCards();
    state.baselineKeys = new Set(videos.map(item => item.key));
    state.targetKey = null;
    state.targetCard = null;
    state.targetMedia = null;

    const result = {
      ok: true,
      count: state.baselineKeys.size,
      keys: [...state.baselineKeys],
    };
    log('Đã ghi baseline video:', result);
    return result;
  }

  function selectCandidate(candidate, reason) {
    if (!candidate) throw new Error('Video candidate không hợp lệ.');
    state.targetKey = candidate.key;
    state.targetCard = candidate.card;
    state.targetMedia = candidate.media;
    mark(state.targetCard, '#8b5cf6', 60000);

    const result = {
      ok: true,
      reason,
      targetKey: candidate.key,
      box: {
        x: Math.round(candidate.rect.x),
        y: Math.round(candidate.rect.y),
        width: Math.round(candidate.rect.width),
        height: Math.round(candidate.rect.height),
      },
    };
    log('Đã khóa đúng card video viền tím:', result);
    return result;
  }

  async function waitVideo(timeoutMs = 360000) {
    const deadline = Date.now() + timeoutMs;
    let previousSignature = '';
    let stablePolls = 0;

    while (Date.now() < deadline) {
      const videos = collectVideoCards();
      const fresh = videos.filter(item => !state.baselineKeys.has(item.key));
      const signature = fresh.map(item => item.key).sort().join('|');

      if (signature && signature === previousSignature) stablePolls += 1;
      else stablePolls = signature ? 1 : 0;
      previousSignature = signature;

      log('Đang chờ video mới:', {
        found: fresh.length,
        stablePolls,
        keys: fresh.map(item => item.key),
      });

      if (fresh.length && stablePolls >= 2) {
        return selectCandidate(fresh[0], 'new-video-after-baseline');
      }
      await sleep(1000);
    }

    throw new Error('Hết thời gian chờ video mới.');
  }

  function pickLatestVideo(index = 0) {
    const videos = collectVideoCards();
    if (!videos.length) throw new Error('Không tìm thấy card video.');
    if (!videos[index]) throw new Error(`Không có video index ${index}.`);
    return selectCandidate(videos[index], 'manual-latest-video');
  }

  function pickVideoUuid(uuid) {
    if (!uuid) throw new Error('UUID trống.');
    const key = `media:${uuid}`;
    const candidate = collectVideoCards().find(item => item.key === key);
    if (!candidate) throw new Error(`Không tìm thấy video UUID ${uuid}.`);
    return selectCandidate(candidate, 'exact-video-uuid');
  }

  function waitTrustedClick(target, timeoutMs, description) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        document.removeEventListener('pointerdown', handler, true);
        clearTimeout(timer);
      };

      const handler = event => {
        const path = event.composedPath?.() || [];
        if (!path.includes(target) && !target.contains(event.target)) return;
        if (!event.isTrusted) {
          warn(`Bỏ qua click giả: ${description}`);
          return;
        }
        settled = true;
        cleanup();
        log('pointerdown thật', { description, trusted: true });
        resolve({ ok: true, trusted: true, element: target });
      };

      document.addEventListener('pointerdown', handler, true);
      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`Hết thời gian chờ click thật: ${description}`));
      }, timeoutMs);
    });
  }

  function findDownloadButton() {
    return queryAll('button')
      .filter(rendered)
      .map(button => {
        const text = textOf(button);
        const icons = iconsOf(button);
        let score = 0;
        if (/\bdownload\b/i.test(icons)) score += 600;
        if (/Tải xuống|Download/i.test(text)) score += 500;
        const rect = button.getBoundingClientRect();
        if (rect.top < 70) score -= 100;
        return { button, score, text, icons, rect };
      })
      .filter(item => item.score >= 500)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function findViewerMoreButton() {
    return queryAll('button')
      .filter(rendered)
      .map(button => {
        const text = `${textOf(button)} ${iconsOf(button)}`.toLowerCase();
        const rect = button.getBoundingClientRect();
        let score = 0;
        if (/more_vert|more_horiz/.test(text)) score += 500;
        if (rect.top < 70) score -= 260;
        if (rect.width <= 56 && rect.height <= 56) score += 80;
        return { button, score, rect, text };
      })
      .filter(item => item.score >= 400)
      .sort((a, b) => b.score - a.score)[0]?.button || null;
  }

  async function openAndDownload({
    clickTimeoutMs = 60000,
    viewerTimeoutMs = 12000,
  } = {}) {
    if (!(state.targetCard instanceof Element)) {
      throw new Error('Chưa khóa video. Chạy waitVideo() hoặc pickLatestVideo() trước.');
    }

    state.lastStep = 'click-video-card';
    mark(state.targetCard, '#8b5cf6', clickTimeoutMs + 3000);
    log('CLICK THẬT card video viền tím.');
    await waitTrustedClick(state.targetCard, clickTimeoutMs, 'card video đúng');

    let download = null;
    try {
      download = await waitFor(findDownloadButton, viewerTimeoutMs, 'nút Tải xuống');
    } catch {
      const more = findViewerMoreButton();
      if (!more) {
        throw new Error('Đã mở video nhưng chưa thấy nút download hoặc nút ba chấm của viewer.');
      }

      state.lastStep = 'click-viewer-more';
      mark(more, '#f59e0b', clickTimeoutMs + 3000);
      log('CLICK THẬT nút ba chấm viewer viền cam.');
      await waitTrustedClick(more, clickTimeoutMs, 'nút ba chấm viewer');
      download = await waitFor(findDownloadButton, 8000, 'nút Tải xuống sau khi mở menu');
    }

    state.lastStep = 'click-download';
    mark(download.button, '#22c55e', clickTimeoutMs + 3000);
    log('CLICK THẬT nút Tải xuống viền xanh.', {
      text: download.text,
      icons: download.icons,
    });
    await waitTrustedClick(download.button, clickTimeoutMs, 'Tải xuống');

    const result = {
      ok: true,
      trustedDownloadClick: true,
      targetKey: state.targetKey,
      downloadText: download.text,
      downloadIcons: download.icons,
    };
    state.lastStep = 'completed';
    log('Đã click tải đúng video:', result);
    return result;
  }

  function scan() {
    const download = findDownloadButton();
    const result = {
      version: VERSION,
      baselineCount: state.baselineKeys.size,
      targetKey: state.targetKey,
      targetCardFound: !!state.targetCard,
      videoCount: collectVideoCards().length,
      downloadFound: !!download,
      downloadText: download?.text || null,
      downloadIcons: download?.icons || null,
      lastStep: state.lastStep,
    };
    log('scan:', result);
    return result;
  }

  function reset() {
    state.baselineKeys = new Set();
    state.targetKey = null;
    state.targetCard = null;
    state.targetMedia = null;
    state.lastStep = null;
    return { ok: true };
  }

  window.FlowVideoDownloadTest = Object.freeze({
    version: VERSION,
    scan,
    scanVideos,
    reset,
    baseline,
    waitVideo,
    pickLatestVideo,
    pickVideoUuid,
    openAndDownload,
  });

  log(`Nạp xong v${VERSION}.`);
  log('Chuẩn: baseline() trước submit -> waitVideo() -> openAndDownload().');
  log('Video đã có sẵn: scanVideos() -> pickLatestVideo(index) -> openAndDownload().');
})();