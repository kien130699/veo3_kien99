/*
 * FlowImageToVideoTest v2.0.0
 * Test bán tự động trên Console của tab Google Flow.
 *
 * Mục tiêu:
 *   text -> ảnh -> tìm đúng ảnh mới -> người dùng hover ảnh
 *   -> click ba chấm thật -> click "Tạo ảnh động" thật
 *   -> dán video prompt thật -> click Tạo thật.
 *
 * JavaScript trong trang không thể tạo event isTrusted, nên các thao tác Flow
 * nhạy cảm (hover/click/paste/submit) được hướng dẫn và xác nhận bằng click thật.
 * Script không gọi private API.
 *
 * Cách dùng chuẩn:
 *   1) FlowImageToVideoTest.baseline()       // trước khi bấm tạo ảnh
 *   2) Tự tạo ảnh trên Flow
 *   3) await FlowImageToVideoTest.waitImage(240000)
 *   4) await FlowImageToVideoTest.openAnimate(60000)
 *      - di chuột vào ảnh viền tím
 *      - click nút ba chấm viền vàng
 *      - click "Tạo ảnh động" viền xanh
 *   5) await FlowImageToVideoTest.prepareVideoPrompt('prompt chuyển động')
 *   6) click ô prompt viền tím, Ctrl+V thật
 *   7) FlowImageToVideoTest.checkVideo()
 *   8) await FlowImageToVideoTest.armSubmitVideo(30000)
 *      rồi click nút Tạo viền xanh.
 *
 * Nếu ảnh đã tạo từ trước, bỏ baseline/waitImage và chạy:
 *   FlowImageToVideoTest.pickLatest()
 */
(() => {
  'use strict';

  const VERSION = '2.0.0';
  const POLL_MS = 500;
  const state = {
    baselineKeys: new Set(),
    targetKey: null,
    targetImage: null,
    targetCard: null,
    videoPrompt: '',
    lastResult: null
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const log = (...args) =>
    console.log('%c[FlowI2VTest]', 'color:#9b6cff;font-weight:bold', ...args);
  const warn = (...args) => console.warn('[FlowI2VTest]', ...args);

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 2 && rect.height > 2 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < innerHeight && rect.left < innerWidth;
  }

  function roots() {
    const all = [document];
    const seen = new Set(all);
    for (let index = 0; index < all.length; index += 1) {
      for (const element of all[index].querySelectorAll?.('*') || []) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          seen.add(element.shadowRoot);
          all.push(element.shadowRoot);
        }
      }
    }
    return all;
  }

  function query(selector) {
    return roots().flatMap(root => {
      try {
        return [...root.querySelectorAll(selector)];
      } catch {
        return [];
      }
    });
  }

  function textOf(element) {
    if (!(element instanceof Element)) return '';
    return [
      element.innerText,
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
      element.getAttribute('data-placeholder')
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mark(element, color = '#9b6cff', duration = 15000) {
    if (!(element instanceof HTMLElement)) return;
    const oldOutline = element.style.outline;
    const oldOffset = element.style.outlineOffset;
    element.style.outline = `5px solid ${color}`;
    element.style.outlineOffset = '3px';
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    setTimeout(() => {
      element.style.outline = oldOutline;
      element.style.outlineOffset = oldOffset;
    }, duration);
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

  function mediaUuid(url) {
    try {
      const parsed = new URL(url, location.href);
      if (!parsed.pathname.includes('media.getMediaUrlRedirect')) return null;
      return parsed.searchParams.get('name');
    } catch {
      const match = String(url || '').match(/[?&]name=([0-9a-fA-F-]+)/);
      return match?.[1] || null;
    }
  }

  function imageKey(image) {
    const src = image.currentSrc || image.src || image.getAttribute('src') || '';
    const uuid = mediaUuid(src);
    if (uuid) return `media:${uuid}`;
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
    return `src:${normalizeUrl(src)}`;
  }

  function imageArea(image) {
    const rect = image.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function collectAssets() {
    const groups = new Map();
    const images = query('img');

    images.forEach((image, domIndex) => {
      const key = imageKey(image);
      if (!key) return;
      const rect = image.getBoundingClientRect();
      const item = {
        image,
        key,
        domIndex,
        visible: visible(image),
        area: imageArea(image),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        src: image.currentSrc || image.src || '',
        alt: image.alt || ''
      };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    return [...groups.entries()].map(([key, items]) => {
      const representative = [...items].sort((a, b) => {
        if (a.visible !== b.visible) return Number(b.visible) - Number(a.visible);
        if (a.area !== b.area) return b.area - a.area;
        return b.domIndex - a.domIndex;
      })[0];
      return {
        key,
        items,
        representative,
        lastDomIndex: Math.max(...items.map(item => item.domIndex))
      };
    });
  }

  function baseline() {
    const assets = collectAssets();
    state.baselineKeys = new Set(assets.map(asset => asset.key));
    state.targetKey = null;
    state.targetImage = null;
    state.targetCard = null;
    const result = {
      version: VERSION,
      baselineCount: state.baselineKeys.size,
      mediaKeys: [...state.baselineKeys]
    };
    log('Đã lưu baseline trước khi tạo ảnh.', result);
    return result;
  }

  function cardScore(node, image) {
    if (!(node instanceof Element)) return -Infinity;
    const rect = node.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 60) return -Infinity;
    if (rect.width > innerWidth * 0.98 && rect.height > innerHeight * 1.8) return -Infinity;

    let score = 0;
    const buttons = [...node.querySelectorAll('button')];
    const text = textOf(node).toLowerCase();
    if (buttons.some(button => /more_vert|more_horiz/.test(textOf(button)))) score += 250;
    if (buttons.some(button => button.getAttribute('aria-haspopup') === 'menu')) score += 180;
    if (buttons.length > 0) score += 30;
    if (/tạo ảnh động|animate|motion_blur/.test(text)) score += 50;

    const imageRect = image.getBoundingClientRect();
    const areaRatio = (rect.width * rect.height) /
      Math.max(1, imageRect.width * imageRect.height);
    if (areaRatio >= 1 && areaRatio <= 8) score += 120;
    if (areaRatio > 25) score -= 150;

    score -= Math.min(150, areaRatio * 4);
    return score;
  }

  function findCard(image) {
    let node = image;
    const candidates = [];
    for (let depth = 0; depth < 14 && node; depth += 1, node = node.parentElement) {
      const score = cardScore(node, image) - depth * 3;
      if (Number.isFinite(score)) candidates.push({ node, score, depth });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.node || image.parentElement || image;
  }

  function selectAsset(asset, reason) {
    if (!asset?.representative?.image) {
      throw new Error('Không có ảnh đại diện hợp lệ.');
    }
    state.targetKey = asset.key;
    state.targetImage = asset.representative.image;
    state.targetCard = findCard(state.targetImage);
    mark(state.targetImage, '#9b6cff', 20000);
    if (state.targetCard !== state.targetImage) mark(state.targetCard, '#6f42c1', 20000);

    const result = {
      ok: true,
      reason,
      targetKey: state.targetKey,
      occurrences: asset.items.length,
      representative: {
        width: asset.representative.width,
        height: asset.representative.height,
        top: asset.representative.top,
        left: asset.representative.left,
        src: asset.representative.src
      }
    };
    state.lastResult = result;
    log('Đã chọn ảnh mục tiêu. Ảnh/card được viền tím.', result);
    return result;
  }

  function pickLatest() {
    const assets = collectAssets()
      .filter(asset => asset.representative.visible)
      .sort((a, b) => {
        if (a.lastDomIndex !== b.lastDomIndex) return b.lastDomIndex - a.lastDomIndex;
        return b.representative.area - a.representative.area;
      });

    if (!assets.length) {
      throw new Error('Không tìm thấy ảnh media hiển thị trên trang Flow.');
    }
    return selectAsset(assets[0], 'latest-visible-asset');
  }

  async function waitImage(timeoutMs = 240000) {
    if (!(state.baselineKeys instanceof Set) || state.baselineKeys.size === 0) {
      warn('Baseline đang rỗng. Nếu trang trước đó đã có ảnh, nên chạy baseline() trước khi tạo ảnh.');
    }

    const deadline = Date.now() + timeoutMs;
    let previousKeys = '';
    let stablePolls = 0;

    while (Date.now() < deadline) {
      const assets = collectAssets();
      const fresh = assets
        .filter(asset => !state.baselineKeys.has(asset.key))
        .sort((a, b) => b.lastDomIndex - a.lastDomIndex);

      const signature = fresh.map(asset => asset.key).sort().join('|');
      if (signature && signature === previousKeys) stablePolls += 1;
      else stablePolls = signature ? 1 : 0;
      previousKeys = signature;

      log('Đang dò ảnh mới...', {
        foundDistinct: fresh.length,
        stablePolls,
        keys: fresh.map(asset => asset.key)
      });

      if (fresh.length > 0 && stablePolls >= 2) {
        return selectAsset(fresh[0], 'new-asset-after-baseline');
      }
      await sleep(1000);
    }

    throw new Error(`Hết ${Math.round(timeoutMs / 1000)} giây nhưng chưa xác định được ảnh mới.`);
  }

  function nearCard(button, card) {
    if (!(button instanceof Element) || !(card instanceof Element)) return false;
    if (card.contains(button)) return true;
    const b = button.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const cx = Math.max(c.left, Math.min(b.left + b.width / 2, c.right));
    const cy = Math.max(c.top, Math.min(b.top + b.height / 2, c.bottom));
    const dx = Math.abs((b.left + b.width / 2) - cx);
    const dy = Math.abs((b.top + b.height / 2) - cy);
    return dx <= 100 && dy <= 100;
  }

  function isMoreButton(button, card = state.targetCard) {
    if (!(button instanceof HTMLButtonElement) || !visible(button)) return false;
    if (card && !nearCard(button, card)) return false;
    const text = textOf(button).toLowerCase();
    return /more_vert|more_horiz|thêm|tùy chọn|tuỳ chọn|more options|options/.test(text) ||
      button.getAttribute('aria-haspopup') === 'menu';
  }

  function findMoreButton() {
    const card = state.targetCard;
    if (!card) return null;
    const local = [...card.querySelectorAll('button')].find(button => isMoreButton(button, card));
    if (local) return local;
    return query('button').find(button => isMoreButton(button, card)) || null;
  }

  function isAnimateItem(element) {
    if (!(element instanceof Element) || !visible(element)) return false;
    const role = element.getAttribute('role');
    if (role !== 'menuitem' && element.tagName !== 'BUTTON') return false;
    const text = textOf(element).toLowerCase();
    return /motion_blur|tạo ảnh động|tao anh dong|animate|create animation|make motion/.test(text);
  }

  function findAnimateItem() {
    return query('[role="menuitem"],button').find(isAnimateItem) || null;
  }

  function eventPathElements(event) {
    return (event.composedPath?.() || [])
      .filter(item => item instanceof Element);
  }

  function waitTrustedClick(predicate, timeoutMs, description) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        document.removeEventListener('click', onClick, true);
        clearTimeout(timer);
      };
      const onClick = event => {
        const matched = eventPathElements(event).find(predicate);
        if (!matched) return;
        if (!event.isTrusted) {
          warn(`Đã thấy click giả vào ${description}; bỏ qua.`);
          return;
        }
        settled = true;
        cleanup();
        resolve({ event, element: matched });
      };
      document.addEventListener('click', onClick, true);
      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`Hết thời gian chờ click thật vào ${description}.`));
      }, timeoutMs);
    });
  }

  async function waitFor(getter, timeoutMs, description) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = getter();
      if (value) return value;
      await sleep(200);
    }
    throw new Error(`Hết thời gian chờ ${description}.`);
  }

  function promptEditors() {
    const selectors = [
      '[data-slate-editor="true"][contenteditable="true"]',
      'div[role="textbox"][data-slate-editor="true"]',
      '[role="textbox"][contenteditable="true"]',
      'textarea[placeholder*="Bạn muốn" i]',
      'textarea[placeholder*="What do you want" i]',
      'textarea'
    ];
    const seen = new Set();
    return selectors
      .flatMap(query)
      .filter(element => !seen.has(element) && seen.add(element) && visible(element));
  }

  function findPromptEditor() {
    const editors = promptEditors();
    if (!editors.length) return null;
    return editors.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.top - ra.top;
    })[0];
  }

  function nearestComposer(editor) {
    let node = editor;
    for (let depth = 0; depth < 12 && node; depth += 1, node = node.parentElement) {
      const buttons = [...(node.querySelectorAll?.('button') || [])];
      if (buttons.some(button => /arrow_forward|tạo|create|generate|send/i.test(textOf(button)))) {
        return node;
      }
    }
    return editor.parentElement || document.body;
  }

  function attachmentEvidence(editor) {
    if (!editor) return { attached: false, evidence: [] };
    const composer = nearestComposer(editor);
    const editorRect = editor.getBoundingClientRect();
    const evidence = [];

    for (const image of query('img')) {
      if (!visible(image)) continue;
      const rect = image.getBoundingClientRect();
      const sameKey = state.targetKey && imageKey(image) === state.targetKey;
      const nearEditor = Math.abs((rect.bottom + rect.top) / 2 -
        (editorRect.bottom + editorRect.top) / 2) < 350;
      if ((sameKey && (composer.contains(image) || nearEditor)) ||
          (composer.contains(image) && rect.width >= 24 && rect.height >= 24)) {
        evidence.push({
          type: sameKey ? 'same-media-key' : 'composer-thumbnail',
          key: imageKey(image),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    }

    const composerText = textOf(composer).toLowerCase();
    if (/videocam|video|ảnh động|animate|motion/.test(composerText)) {
      evidence.push({ type: 'video-composer-text', text: composerText.slice(0, 160) });
    }

    return { attached: evidence.length > 0, evidence };
  }

  async function waitVideoComposer(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const editor = findPromptEditor();
      if (editor) {
        const attachment = attachmentEvidence(editor);
        if (attachment.attached) {
          mark(editor, '#9b6cff', 20000);
          return { editor, attachment };
        }
      }
      await sleep(300);
    }

    const editor = findPromptEditor();
    if (editor) {
      mark(editor, '#9b6cff', 20000);
      return {
        editor,
        attachment: attachmentEvidence(editor),
        warning: 'Tìm thấy prompt editor nhưng chưa xác minh chắc chắn ảnh đã attach.'
      };
    }
    throw new Error('Sau khi bấm Tạo ảnh động, không tìm thấy prompt editor video.');
  }

  async function openAnimate(timeoutMs = 60000) {
    if (!state.targetImage || !document.contains(state.targetImage)) {
      pickLatest();
    }
    state.targetCard = findCard(state.targetImage);
    mark(state.targetImage, '#9b6cff', timeoutMs + 5000);
    mark(state.targetCard, '#6f42c1', timeoutMs + 5000);

    log('BƯỚC 1/3: Di chuyển chuột thật vào ảnh/card đang viền tím. Script đang chờ nút ba chấm xuất hiện.');
    const moreButton = await waitFor(findMoreButton, timeoutMs, 'nút ba chấm của đúng card ảnh');
    mark(moreButton, '#ffb020', timeoutMs);

    log('BƯỚC 2/3: Click thật nút ba chấm đang viền vàng.');
    await waitTrustedClick(
      element => element instanceof HTMLButtonElement && isMoreButton(element),
      timeoutMs,
      'nút ba chấm'
    );

    const animateItem = await waitFor(findAnimateItem, 10000, 'menu item Tạo ảnh động');
    mark(animateItem, '#25d366', timeoutMs);
    log('BƯỚC 3/3: Click thật menu "Tạo ảnh động" đang viền xanh.');
    await waitTrustedClick(isAnimateItem, timeoutMs, 'Tạo ảnh động');

    const videoState = await waitVideoComposer(20000);
    const result = {
      ok: true,
      version: VERSION,
      targetKey: state.targetKey,
      animateClickedTrusted: true,
      attachmentLikely: videoState.attachment.attached,
      attachmentEvidence: videoState.attachment.evidence,
      warning: videoState.warning || null
    };
    state.lastResult = result;
    log('Đã hoàn tất chuỗi hover → ba chấm → Tạo ảnh động.', result);
    return result;
  }

  function editorText(editor) {
    if (!editor) return '';
    if ('value' in editor) return String(editor.value || '').trim();
    return String(editor.innerText || editor.textContent || '').trim();
  }

  function findSubmitButton(editor = findPromptEditor()) {
    if (!editor) return null;
    const composer = nearestComposer(editor);
    const editorRect = editor.getBoundingClientRect();
    const avoid = /download|upload|delete|close|back|settings|tune|more_vert|dự án mới/i;

    return query('button')
      .filter(button => visible(button) && !avoid.test(textOf(button).toLowerCase()))
      .map(button => {
        const text = textOf(button).toLowerCase();
        const rect = button.getBoundingClientRect();
        let score = composer.contains(button) ? 100 : 0;
        if (/arrow_forward/.test(text)) score += 300;
        if (/tạo|create|generate|send|submit/.test(text)) score += 180;
        const dx = Math.abs((rect.left + rect.width / 2) - editorRect.right);
        const dy = Math.abs((rect.top + rect.height / 2) -
          (editorRect.top + editorRect.height / 2));
        score += Math.max(0, 180 - (dx + dy) / 5);
        return { button, score };
      })
      .filter(item => item.score > 150)
      .sort((a, b) => b.score - a.score)[0]?.button || null;
  }

  async function prepareVideoPrompt(prompt) {
    const value = String(prompt || '').trim();
    if (!value) throw new Error('Video prompt không được để trống.');
    const editor = findPromptEditor();
    if (!editor) throw new Error('Không tìm thấy prompt editor sau bước Tạo ảnh động.');

    state.videoPrompt = value;
    mark(editor, '#9b6cff', 20000);
    editor.focus();

    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
    }

    log(copied
      ? 'Đã copy video prompt. Click ô viền tím rồi nhấn Ctrl+V thật.'
      : 'Không ghi được clipboard. Copy prompt bên dưới, click ô viền tím rồi Ctrl+V thật.',
    );
    console.log('%cVIDEO PROMPT:', 'font-weight:bold;color:#25d366', value);

    return {
      ok: true,
      copied,
      prompt: value,
      next: 'Click prompt editor, Ctrl+V thật, rồi chạy FlowImageToVideoTest.checkVideo()'
    };
  }

  function checkVideo() {
    const editor = findPromptEditor();
    const submit = findSubmitButton(editor);
    const attachment = attachmentEvidence(editor);
    const text = editorText(editor);
    const result = {
      version: VERSION,
      editorFound: Boolean(editor),
      editorText: text,
      promptAccepted: text.length > 0 &&
        (!state.videoPrompt || text.includes(state.videoPrompt) || state.videoPrompt.includes(text)),
      attachmentLikely: attachment.attached,
      attachmentEvidence: attachment.evidence,
      submitFound: Boolean(submit),
      submitEnabled: Boolean(
        submit &&
        !submit.disabled &&
        submit.getAttribute('aria-disabled') !== 'true'
      ),
      submitText: submit ? textOf(submit) : null
    };

    if (result.promptAccepted) mark(editor, '#9b6cff', 12000);
    if (result.submitEnabled) mark(submit, '#25d366', 12000);
    if (result.promptAccepted && result.submitEnabled) {
      log('PASS: Flow đã nhận video prompt và nút Tạo đang bật.', result);
    } else {
      warn('Chưa sẵn sàng tạo video.', result);
    }
    state.lastResult = result;
    return result;
  }

  async function armSubmitVideo(timeoutMs = 30000) {
    const check = checkVideo();
    if (!check.promptAccepted) throw new Error('Flow chưa nhận video prompt.');
    if (!check.submitFound || !check.submitEnabled) throw new Error('Nút Tạo video chưa sẵn sàng.');

    const submit = findSubmitButton();
    mark(submit, '#25d366', timeoutMs + 3000);
    log(`Trong ${Math.round(timeoutMs / 1000)} giây, click thật nút Tạo đang viền xanh.`);

    const started = performance.now();
    const click = await waitTrustedClick(
      element => element instanceof HTMLButtonElement &&
        (element === submit || /arrow_forward|tạo|create|generate/i.test(textOf(element))),
      timeoutMs,
      'nút Tạo video'
    );

    await sleep(1500);
    const result = {
      ok: true,
      trustedClick: click.event.isTrusted,
      elapsedMs: Math.round(performance.now() - started),
      submitText: textOf(click.element),
      message: 'Đã nhận click thật vào nút Tạo video. Kiểm tra card render trên Flow.'
    };
    state.lastResult = result;
    log('Đã submit video bằng click thật.', result);
    return result;
  }

  function scan() {
    const assets = collectAssets();
    const editor = findPromptEditor();
    const submit = findSubmitButton(editor);
    const result = {
      version: VERSION,
      url: location.href,
      assetCount: assets.length,
      assets: assets.map(asset => ({
        key: asset.key,
        occurrences: asset.items.length,
        visible: asset.representative.visible,
        width: asset.representative.width,
        height: asset.representative.height,
        lastDomIndex: asset.lastDomIndex
      })),
      targetKey: state.targetKey,
      editorFound: Boolean(editor),
      submitFound: Boolean(submit),
      animateMenuItemVisible: Boolean(findAnimateItem()),
      moreButtonVisible: Boolean(findMoreButton())
    };
    log('Scan:', result);
    return result;
  }

  function reset() {
    state.baselineKeys = new Set();
    state.targetKey = null;
    state.targetImage = null;
    state.targetCard = null;
    state.videoPrompt = '';
    state.lastResult = null;
    log('Đã reset trạng thái test.');
    return { ok: true, version: VERSION };
  }

  window.FlowImageToVideoTest = Object.freeze({
    version: VERSION,
    baseline,
    waitImage,
    pickLatest,
    openAnimate,
    prepareVideoPrompt,
    checkVideo,
    armSubmitVideo,
    scan,
    reset,
    getState: () => ({
      version: VERSION,
      baselineKeys: [...state.baselineKeys],
      targetKey: state.targetKey,
      videoPrompt: state.videoPrompt,
      lastResult: state.lastResult
    })
  });

  log(
    `Nạp xong v${VERSION}. ` +
    'Luồng: baseline() → waitImage() → openAnimate() → prepareVideoPrompt() → checkVideo() → armSubmitVideo().'
  );
})();
