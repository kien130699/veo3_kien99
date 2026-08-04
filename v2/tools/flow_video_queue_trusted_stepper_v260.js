/*
 * FlowVideoQueueTrustedStepper v2.6.0
 *
 * Robust multi-video test for Google Flow Vietnamese UI.
 *
 * Correct production pattern:
 *   baseline() BEFORE submit video
 *   -> waitNewVideos({ expectedCount })
 *   -> downloadQueue()
 *
 * Key improvements:
 * - never chooses "the first/leftmost video" as the primary rule
 * - groups duplicate DOM thumbnails by media UUID/source key
 * - tracks every new video after baseline (supports x1..x4 and many scenes)
 * - uses a fixed overlay border, so target highlighting is not clipped by card overflow
 * - processes a queue and advances one exact video at a time
 * - waits for real user pointer events (event.isTrusted === true)
 *
 * No private API calls. No sc-* class dependency.
 */
(() => {
  'use strict';

  const VERSION = '2.6.0';

  const state = {
    baselineKeys: new Set(),
    queue: [],
    processedKeys: new Set(),
    activeIndex: -1,
    activeAsset: null,
    overlay: null,
    overlayTimer: null,
    lastStep: null,
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const log = (...args) => console.log(
    '%c[FlowVideoQueue]',
    'color:#8b5cf6;font-weight:bold',
    ...args,
  );
  const warn = (...args) => console.warn('[FlowVideoQueue]', ...args);

  function roots() {
    const result = [document];
    const seen = new Set(result);
    for (let index = 0; index < result.length; index += 1) {
      for (const el of result[index].querySelectorAll?.('*') || []) {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          result.push(el.shadowRoot);
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

  function rendered(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0
      && rect.width > 2
      && rect.height > 2;
  }

  function inViewport(el) {
    if (!rendered(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0
      && rect.right > 0
      && rect.top < innerHeight
      && rect.left < innerWidth;
  }

  function textOf(el) {
    if (!(el instanceof Element)) return '';
    return norm([
      el.innerText,
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
    ].filter(Boolean).join(' '));
  }

  function iconText(el) {
    if (!(el instanceof Element)) return '';
    return norm(
      [...el.querySelectorAll('i.google-symbols, i')]
        .map(icon => icon.textContent || '')
        .join(' '),
    );
  }

  function mediaUuid(url) {
    try {
      return new URL(url, location.href).searchParams.get('name');
    } catch {
      return String(url || '').match(/[?&]name=([0-9a-fA-F-]{16,})/)?.[1] || null;
    }
  }

  function normalizeUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      parsed.hash = '';
      return parsed.href;
    } catch {
      return String(url || '');
    }
  }

  function urlsFromElement(el) {
    if (!(el instanceof Element)) return [];
    const urls = new Set();

    const attrs = ['src', 'poster', 'data-src', 'href'];
    for (const attr of attrs) {
      const value = el.getAttribute?.(attr);
      if (value) urls.add(value);
    }

    if ('currentSrc' in el && el.currentSrc) urls.add(el.currentSrc);
    if ('src' in el && typeof el.src === 'string' && el.src) urls.add(el.src);
    if ('poster' in el && typeof el.poster === 'string' && el.poster) urls.add(el.poster);

    const background = getComputedStyle(el).backgroundImage || '';
    for (const match of background.matchAll(/url\(["']?(.+?)["']?\)/g)) {
      if (match[1]) urls.add(match[1]);
    }

    return [...urls];
  }

  function keyFromUrls(urls) {
    for (const url of urls) {
      const uuid = mediaUuid(url);
      if (uuid) return `media:${uuid}`;
    }

    for (const url of urls) {
      const normalized = normalizeUrl(url);
      if (
        normalized
        && !normalized.startsWith('data:')
        && !normalized.startsWith('blob:')
      ) {
        return `src:${normalized}`;
      }
    }
    return null;
  }

  function nearestVideoCard(seed) {
    if (!(seed instanceof Element)) return null;

    const seedRect = seed.getBoundingClientRect();
    const candidates = [];
    let node = seed;

    for (let depth = 0; depth < 16 && node; depth += 1, node = node.parentElement) {
      if (!(node instanceof Element)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 80) continue;
      if (rect.width > innerWidth * 0.97 && rect.height > innerHeight * 0.92) continue;

      const text = textOf(node).toLowerCase();
      const icons = iconText(node).toLowerCase();
      const ratio = (rect.width * rect.height) /
        Math.max(1, seedRect.width * seedRect.height);

      let score = 0;
      if (node.querySelector('video')) score += 550;
      if (/play_circle|play_arrow|play_circle_filled/.test(icons + ' ' + text)) score += 430;
      if (/pause|volume_up|volume_off/.test(icons + ' ' + text)) score += 160;
      if (/\bvideo\b/.test(text)) score += 100;
      if (rect.width >= 200 && rect.height >= 120) score += 100;
      if (ratio >= 1 && ratio <= 8) score += 150;
      if (ratio > 20) score -= 220;
      score -= depth * 5;

      candidates.push({ node, score, depth, rect });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.node || seed.parentElement || seed;
  }

  function candidateSeeds() {
    const seeds = new Set();

    for (const video of queryAll('video')) seeds.add(video);
    for (const source of queryAll('video source')) seeds.add(source.closest('video') || source);

    for (const img of queryAll('img')) {
      const card = nearestVideoCard(img);
      const signal = `${textOf(card)} ${iconText(card)}`.toLowerCase();
      if (/play_circle|play_arrow|pause|volume_|\bvideo\b/.test(signal)) {
        seeds.add(img);
      }
    }

    for (const el of queryAll('button,[role="button"],div')) {
      if (!rendered(el)) continue;
      const signal = `${textOf(el)} ${iconText(el)}`.toLowerCase();
      if (/play_circle|play_arrow|play_circle_filled/.test(signal)) {
        const media = el.querySelector('video,img') || el;
        seeds.add(media);
      }
    }

    return [...seeds];
  }

  function assetFromSeed(seed, domIndex) {
    const card = nearestVideoCard(seed);
    if (!card) return null;

    const urls = new Set([
      ...urlsFromElement(seed),
      ...urlsFromElement(card),
    ]);

    for (const media of card.querySelectorAll('video,video source,img')) {
      for (const url of urlsFromElement(media)) urls.add(url);
    }

    const key = keyFromUrls([...urls]);
    const rect = card.getBoundingClientRect();
    const signal = `${textOf(card)} ${iconText(card)}`.toLowerCase();

    let score = 0;
    const reasons = [];

    if (card.querySelector('video')) {
      score += 600;
      reasons.push('video-element');
    }
    if (/play_circle|play_arrow|play_circle_filled/.test(signal)) {
      score += 450;
      reasons.push('play-overlay');
    }
    if (/pause|volume_up|volume_off/.test(signal)) {
      score += 180;
      reasons.push('player-controls');
    }
    if (/\bvideo\b/.test(signal)) {
      score += 120;
      reasons.push('video-label');
    }
    if (key?.startsWith('media:')) {
      score += 220;
      reasons.push('media-uuid');
    }
    if (rect.width >= 200 && rect.height >= 120) {
      score += 100;
      reasons.push('card-size');
    }

    if (!key) {
      const geometry = [
        Math.round(rect.left),
        Math.round(rect.top),
        Math.round(rect.width),
        Math.round(rect.height),
      ].join(':');
      const label = norm(seed.getAttribute?.('alt') || textOf(card)).slice(0, 80);
      return {
        key: `fallback:${geometry}:${label}`,
        card,
        seeds: [seed],
        urls: [...urls],
        score,
        reasons: [...reasons, 'fallback-key'],
        domIndex,
        rect,
      };
    }

    return {
      key,
      card,
      seeds: [seed],
      urls: [...urls],
      score,
      reasons,
      domIndex,
      rect,
    };
  }

  function collectVideoAssets() {
    const grouped = new Map();

    candidateSeeds().forEach((seed, index) => {
      const asset = assetFromSeed(seed, index);
      if (!asset || asset.score < 350) return;

      if (!grouped.has(asset.key)) {
        grouped.set(asset.key, asset);
        return;
      }

      const current = grouped.get(asset.key);
      current.seeds.push(...asset.seeds);
      current.urls = [...new Set([...current.urls, ...asset.urls])];

      if (asset.score > current.score) {
        current.card = asset.card;
        current.score = asset.score;
        current.reasons = asset.reasons;
        current.domIndex = asset.domIndex;
        current.rect = asset.rect;
      }
    });

    return [...grouped.values()]
      .map(asset => {
        const rect = asset.card.getBoundingClientRect();
        return {
          ...asset,
          rect,
          visible: inViewport(asset.card),
          text: textOf(asset.card).slice(0, 160),
        };
      })
      .sort((a, b) => {
        if (a.domIndex !== b.domIndex) return a.domIndex - b.domIndex;
        return a.rect.left - b.rect.left;
      });
  }

  function clearOverlay() {
    if (state.overlayTimer) {
      clearInterval(state.overlayTimer);
      state.overlayTimer = null;
    }
    if (state.overlay?.isConnected) state.overlay.remove();
    state.overlay = null;
  }

  function showOverlay(asset, label, color = '#a855f7') {
    clearOverlay();
    if (!asset?.card) return;

    const overlay = document.createElement('div');
    overlay.dataset.flowVideoQueueOverlay = 'true';
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: `5px solid ${color}`,
      borderRadius: '12px',
      boxSizing: 'border-box',
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.08)',
    });

    const badge = document.createElement('div');
    badge.textContent = label;
    Object.assign(badge.style, {
      position: 'absolute',
      left: '0',
      top: '-34px',
      maxWidth: '520px',
      padding: '5px 9px',
      borderRadius: '7px',
      background: color,
      color: 'white',
      font: '600 13px/1.3 system-ui, sans-serif',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    overlay.appendChild(badge);
    document.body.appendChild(overlay);

    const update = () => {
      if (!asset.card?.isConnected) return;
      const rect = asset.card.getBoundingClientRect();
      overlay.style.left = `${Math.max(0, rect.left)}px`;
      overlay.style.top = `${Math.max(0, rect.top)}px`;
      overlay.style.width = `${Math.max(10, Math.min(innerWidth, rect.right) - Math.max(0, rect.left))}px`;
      overlay.style.height = `${Math.max(10, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top))}px`;
    };

    update();
    state.overlay = overlay;
    state.overlayTimer = setInterval(update, 120);
  }

  function baseline() {
    const assets = collectVideoAssets();
    state.baselineKeys = new Set(assets.map(asset => asset.key));
    state.queue = [];
    state.activeIndex = -1;
    state.activeAsset = null;
    clearOverlay();

    const result = {
      ok: true,
      version: VERSION,
      baselineCount: state.baselineKeys.size,
      keys: [...state.baselineKeys],
    };
    log('Đã ghi baseline video trước submit.', result);
    return result;
  }

  function scanVideos() {
    const rows = collectVideoAssets().map((asset, index) => ({
      index,
      key: asset.key,
      score: asset.score,
      reasons: asset.reasons.join(','),
      x: Math.round(asset.rect.x),
      y: Math.round(asset.rect.y),
      width: Math.round(asset.rect.width),
      height: Math.round(asset.rect.height),
      visible: asset.visible,
      text: asset.text,
    }));
    console.table(rows);
    log('scanVideos', rows);
    return rows;
  }

  async function waitNewVideos({
    expectedCount = 1,
    timeoutMs = 420000,
    stablePollsRequired = 3,
  } = {}) {
    const count = Number(expectedCount);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`expectedCount không hợp lệ: ${expectedCount}`);
    }

    const deadline = Date.now() + timeoutMs;
    let previousSignature = '';
    let stablePolls = 0;

    while (Date.now() < deadline) {
      const all = collectVideoAssets();
      const fresh = all.filter(asset => !state.baselineKeys.has(asset.key));
      const signature = fresh.map(asset => asset.key).sort().join('|');

      if (signature && signature === previousSignature) stablePolls += 1;
      else stablePolls = signature ? 1 : 0;
      previousSignature = signature;

      log('Đang chờ video mới...', {
        expectedCount: count,
        foundCount: fresh.length,
        stablePolls,
        keys: fresh.map(asset => asset.key),
      });

      if (fresh.length >= count && stablePolls >= stablePollsRequired) {
        state.queue = fresh.map((asset, index) => ({
          ...asset,
          queueIndex: index,
          status: state.processedKeys.has(asset.key) ? 'processed' : 'pending',
        }));
        state.activeIndex = -1;
        state.activeAsset = null;

        const result = {
          ok: true,
          expectedCount: count,
          foundCount: state.queue.length,
          keys: state.queue.map(asset => asset.key),
        };
        log('Đã khóa toàn bộ video mới sau baseline.', result);
        return result;
      }

      await sleep(1000);
    }

    throw new Error(
      `Hết ${Math.round(timeoutMs / 1000)} giây: chưa thấy đủ ${count} video mới.`,
    );
  }

  function adoptCurrentVideos() {
    state.queue = collectVideoAssets().map((asset, index) => ({
      ...asset,
      queueIndex: index,
      status: state.processedKeys.has(asset.key) ? 'processed' : 'pending',
    }));
    state.activeIndex = -1;
    state.activeAsset = null;
    warn('adoptCurrentVideos() chỉ để test với video đã có. Auto thật phải baseline trước submit.');
    return {
      ok: true,
      count: state.queue.length,
      keys: state.queue.map(asset => asset.key),
    };
  }

  function queueStatus() {
    return {
      version: VERSION,
      baselineCount: state.baselineKeys.size,
      total: state.queue.length,
      pending: state.queue.filter(asset => asset.status === 'pending').length,
      processed: state.queue.filter(asset => asset.status === 'processed').length,
      activeIndex: state.activeIndex,
      activeKey: state.activeAsset?.key || null,
      items: state.queue.map((asset, index) => ({
        index,
        key: asset.key,
        status: asset.status,
        score: asset.score,
        reasons: asset.reasons,
      })),
      lastStep: state.lastStep,
    };
  }

  function waitTrustedPointer(target, timeoutMs, description) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        document.removeEventListener('pointerdown', onPointer, true);
        clearTimeout(timer);
      };

      const onPointer = event => {
        const path = event.composedPath?.() || [];
        if (!path.includes(target) && !target.contains(event.target)) return;
        if (!event.isTrusted) {
          warn(`Pointer giả vào ${description}; bỏ qua.`);
          return;
        }
        settled = true;
        cleanup();
        log('pointerdown thật', { description, trusted: true });
        resolve({ event, target });
      };

      document.addEventListener('pointerdown', onPointer, true);

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`Hết thời gian chờ click thật: ${description}`));
      }, timeoutMs);
    });
  }

  function findDownloadButton() {
    return queryAll('button,[role="button"],[role="menuitem"]')
      .filter(inViewport)
      .map(button => {
        const text = textOf(button);
        const icons = iconText(button);
        let score = 0;
        if (/(^|\s)download($|\s)/i.test(icons)) score += 600;
        if (/^Tải xuống$|^Download$/i.test(text)) score += 500;
        if (/tải xuống|download/i.test(`${text} ${icons}`)) score += 220;
        const rect = button.getBoundingClientRect();
        if (rect.top > 55) score += 60;
        return { button, score, text, icons, rect };
      })
      .filter(item => item.score >= 500)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function findViewerMoreButton(asset) {
    const candidates = queryAll('button,[role="button"]')
      .filter(inViewport)
      .map(button => {
        const text = textOf(button);
        const icons = iconText(button);
        const rect = button.getBoundingClientRect();
        let score = 0;
        if (/more_vert|more_horiz/.test(`${text} ${icons}`)) score += 400;
        if (/Tùy chọn khác|Tuỳ chọn khác|Khác|More/i.test(text)) score += 160;
        if (rect.top <= 55) score -= 350;
        if (asset?.card) {
          const cardRect = asset.card.getBoundingClientRect();
          const dx = Math.abs((rect.left + rect.width / 2) - cardRect.right);
          const dy = Math.abs((rect.top + rect.height / 2) - cardRect.top);
          score += Math.max(0, 180 - (dx + dy) / 5);
        }
        return { button, score, text, icons, rect };
      })
      .filter(item => item.score >= 300)
      .sort((a, b) => b.score - a.score);

    return candidates[0] || null;
  }

  async function waitForDownloadButton(timeoutMs = 7000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const button = findDownloadButton();
      if (button) return button;
      await sleep(150);
    }
    return null;
  }

  async function processAsset(asset, {
    clickTimeoutMs = 60000,
    viewerTimeoutMs = 10000,
  } = {}) {
    state.activeAsset = asset;
    state.activeIndex = state.queue.findIndex(item => item.key === asset.key);
    state.lastStep = `click-card:${asset.key}`;

    try {
      asset.card.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}

    showOverlay(
      asset,
      `VIDEO ${state.activeIndex + 1}/${state.queue.length} — ${asset.key} — CLICK THẬT`,
      '#a855f7',
    );

    await waitTrustedPointer(
      asset.card,
      clickTimeoutMs,
      `card video ${state.activeIndex + 1}/${state.queue.length}`,
    );

    let download = await waitForDownloadButton(viewerTimeoutMs);

    if (!download) {
      const more = findViewerMoreButton(asset);
      if (more) {
        state.lastStep = `click-more:${asset.key}`;
        clearOverlay();

        const syntheticAsset = { card: more.button, key: asset.key };
        showOverlay(
          syntheticAsset,
          `VIDEO ${state.activeIndex + 1}/${state.queue.length} — CLICK 3 CHẤM`,
          '#f59e0b',
        );

        await waitTrustedPointer(
          more.button,
          clickTimeoutMs,
          `nút ba chấm video ${state.activeIndex + 1}/${state.queue.length}`,
        );

        download = await waitForDownloadButton(7000);
      }
    }

    if (!download) {
      clearOverlay();
      throw new Error(`Không tìm thấy nút download/Tải xuống cho ${asset.key}`);
    }

    state.lastStep = `click-download:${asset.key}`;
    clearOverlay();

    const downloadAsset = { card: download.button, key: asset.key };
    showOverlay(
      downloadAsset,
      `VIDEO ${state.activeIndex + 1}/${state.queue.length} — CLICK TẢI XUỐNG`,
      '#22c55e',
    );

    await waitTrustedPointer(
      download.button,
      clickTimeoutMs,
      `Tải xuống video ${state.activeIndex + 1}/${state.queue.length}`,
    );

    asset.status = 'processed';
    state.processedKeys.add(asset.key);
    clearOverlay();

    const result = {
      ok: true,
      index: state.activeIndex,
      key: asset.key,
      downloadText: download.text,
      downloadIcons: download.icons,
    };
    log('Đã click tải đúng video.', result);
    return result;
  }

  async function downloadQueue(options = {}) {
    if (!state.queue.length) {
      throw new Error(
        'Queue trống. Auto thật: baseline() trước submit rồi waitNewVideos(). '
        + 'Video đã có sẵn: adoptCurrentVideos().',
      );
    }

    const results = [];

    for (const asset of state.queue) {
      if (asset.status === 'processed' || state.processedKeys.has(asset.key)) continue;
      try {
        results.push(await processAsset(asset, options));
      } catch (error) {
        asset.status = 'failed';
        clearOverlay();
        console.error('[FlowVideoQueue] Lỗi video', asset.key, error);
        if (!options.continueOnError) throw error;
        results.push({
          ok: false,
          key: asset.key,
          error: String(error?.message || error),
        });
      }
      await sleep(500);
    }

    state.lastStep = 'queue-complete';
    const result = {
      ok: results.every(item => item.ok),
      completed: results.filter(item => item.ok).length,
      failed: results.filter(item => !item.ok).length,
      results,
    };
    log('Hoàn tất queue tải video.', result);
    return result;
  }

  function reset() {
    clearOverlay();
    state.baselineKeys = new Set();
    state.queue = [];
    state.processedKeys = new Set();
    state.activeIndex = -1;
    state.activeAsset = null;
    state.lastStep = null;
    return { ok: true };
  }

  window.FlowVideoQueueTest = Object.freeze({
    version: VERSION,
    scanVideos,
    baseline,
    waitNewVideos,
    adoptCurrentVideos,
    queueStatus,
    downloadQueue,
    reset,
  });

  log(`Nạp xong v${VERSION}.`);
  log('AUTO: baseline() TRƯỚC submit -> waitNewVideos({expectedCount}) -> downloadQueue().');
  log('TEST video đã có: adoptCurrentVideos() -> queueStatus() -> downloadQueue().');
})();