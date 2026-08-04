/*
 * FlowTrustedPromptTest v2.2.0
 *
 * Sửa lỗi Slate/React:
 *   - KHÔNG dùng textContent / execCommand('insertText') / InputEvent giả.
 *   - JS chỉ copy prompt + đánh dấu editor + theo dõi event thật.
 *   - Người dùng click editor, Ctrl+A, Ctrl+V thật.
 *   - Chỉ cho arm submit khi đã thấy input/paste isTrusted=true.
 *
 * Dùng trên Console của tab Google Flow.
 * Không gọi private API.
 */
(() => {
  'use strict';

  const VERSION = '2.2.0';
  const state = {
    phase: null,
    expectedPrompt: '',
    editor: null,
    trusted: {
      keydown: false,
      beforeinput: false,
      input: false,
      paste: false,
      click: false
    },
    listeners: [],
    baselineMedia: new Set(),
    selectedMediaKey: null
  };

  const log = (...args) =>
    console.log('%c[FlowTrustedTest]', 'color:#9b6cff;font-weight:bold', ...args);
  const warn = (...args) => console.warn('[FlowTrustedTest]', ...args);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 2 &&
      rect.height > 2 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth;
  }

  function roots() {
    const result = [document];
    const seen = new Set(result);
    for (let i = 0; i < result.length; i += 1) {
      for (const el of result[i].querySelectorAll?.('*') || []) {
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

  function textOf(el) {
    if (!(el instanceof Element)) return '';
    return norm(
      el.innerText ||
      el.textContent ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('data-placeholder') ||
      ''
    );
  }

  function mark(el, color = '#9b6cff', duration = 30000) {
    if (!(el instanceof HTMLElement)) return;
    const oldOutline = el.style.outline;
    const oldOffset = el.style.outlineOffset;
    el.style.outline = `5px solid ${color}`;
    el.style.outlineOffset = '3px';
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    setTimeout(() => {
      el.style.outline = oldOutline;
      el.style.outlineOffset = oldOffset;
    }, duration);
  }

  function findEditor() {
    const selectors = [
      '[data-slate-editor="true"][contenteditable="true"]',
      '[data-slate-editor="true"]',
      '[role="textbox"][contenteditable="true"]',
      '[role="textbox"]',
      '[contenteditable="true"][data-placeholder]',
      '[contenteditable="true"]',
      'textarea[placeholder]',
      'textarea'
    ];

    const candidates = [];
    selectors.forEach((selector, selectorIndex) => {
      queryAll(selector).forEach((el, index) => {
        if (!visible(el)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 180 || rect.height < 18) return;
        const text = textOf(el).toLowerCase();
        let score = 500 - selectorIndex * 20;
        if (/bạn muốn tạo gì|bạn muốn làm gì|what do you want|prompt|câu lệnh/.test(text)) score += 180;
        if (rect.top > innerHeight * 0.55) score += 80;
        score += Math.min(80, rect.width / 10);
        candidates.push({ el, selector, index, score, rect, text });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function editorValue(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return norm(editor.value);
    }
    return norm(editor.innerText || editor.textContent || '');
  }

  function findSubmitButton() {
    const editorInfo = findEditor();
    const editorRect = editorInfo?.el?.getBoundingClientRect?.();
    const candidates = [];

    queryAll('button').forEach((button, index) => {
      if (!visible(button)) return;
      const text = textOf(button).toLowerCase();
      const rect = button.getBoundingClientRect();
      let score = 0;
      if (/arrow_forward/.test(text)) score += 300;
      if (/tạo|create|generate|submit|send/.test(text)) score += 180;
      if (/download|upload|delete|xóa|close|đóng|settings|more_vert/.test(text)) score -= 300;

      if (editorRect) {
        const dx = Math.abs(
          (rect.left + rect.width / 2) -
          (editorRect.right - 10)
        );
        const dy = Math.abs(
          (rect.top + rect.height / 2) -
          (editorRect.top + editorRect.height / 2)
        );
        score += Math.max(0, 180 - (dx + dy) / 5);
      }

      if (score > 100) {
        candidates.push({
          button,
          index,
          score,
          text,
          enabled: !button.disabled && button.getAttribute('aria-disabled') !== 'true',
          rect
        });
      }
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function removeListeners() {
    state.listeners.forEach(({ type, handler }) => {
      document.removeEventListener(type, handler, true);
    });
    state.listeners = [];
  }

  function resetTrustedFlags() {
    state.trusted = {
      keydown: false,
      beforeinput: false,
      input: false,
      paste: false,
      click: false
    };
  }

  function eventTargetsEditor(event, editor) {
    if (!editor) return false;
    const path = event.composedPath?.() || [];
    return path.includes(editor) || editor.contains(event.target);
  }

  function armTrustedInputObserver(editor) {
    removeListeners();
    resetTrustedFlags();

    const add = (type, handler) => {
      document.addEventListener(type, handler, true);
      state.listeners.push({ type, handler });
    };

    add('keydown', event => {
      if (!eventTargetsEditor(event, editor)) return;
      if (event.isTrusted) state.trusted.keydown = true;
      log('keydown', {
        trusted: event.isTrusted,
        key: event.key,
        ctrlKey: event.ctrlKey
      });
    });

    add('paste', event => {
      if (!eventTargetsEditor(event, editor)) return;
      if (event.isTrusted) state.trusted.paste = true;
      log('paste', {
        trusted: event.isTrusted,
        textLength: event.clipboardData?.getData('text/plain')?.length || 0
      });
    });

    add('beforeinput', event => {
      if (!eventTargetsEditor(event, editor)) return;
      if (event.isTrusted) state.trusted.beforeinput = true;
      log('beforeinput', {
        trusted: event.isTrusted,
        inputType: event.inputType,
        dataLength: String(event.data || '').length
      });
    });

    add('input', event => {
      if (!eventTargetsEditor(event, editor)) return;
      if (event.isTrusted) state.trusted.input = true;
      log('input', {
        trusted: event.isTrusted,
        valueLength: editorValue(editor).length
      });
    });
  }

  async function copyPrompt(text) {
    try {
      await navigator.clipboard.writeText(text);
      return { copied: true, method: 'navigator.clipboard' };
    } catch (firstError) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } finally {
        textarea.remove();
      }
      return {
        copied,
        method: 'execCommand-copy',
        firstError: String(firstError)
      };
    }
  }

  async function preparePrompt(phase, prompt) {
    const editorInfo = findEditor();
    if (!editorInfo) throw new Error('Không tìm thấy prompt editor Flow.');

    state.phase = phase;
    state.expectedPrompt = norm(prompt);
    state.editor = editorInfo.el;
    armTrustedInputObserver(state.editor);

    const clipboard = await copyPrompt(prompt);
    mark(state.editor, '#9b6cff', 60000);

    const result = {
      ok: true,
      version: VERSION,
      phase,
      clipboard,
      editorSelector: editorInfo.selector,
      editorTextBefore: editorValue(state.editor),
      instruction: 'Click ô viền tím → Ctrl+A → Ctrl+V thật. Không dùng JS chèn chữ.'
    };

    log('Đã chuẩn bị prompt.', result);
    return result;
  }

  function checkPrompt() {
    const editorInfo = findEditor();
    const editor = editorInfo?.el || state.editor;
    const actual = editorValue(editor);
    const expected = state.expectedPrompt;
    const submit = findSubmitButton();

    const textAccepted =
      !!expected &&
      (actual === expected || actual.includes(expected) || expected.includes(actual));

    const trustedInputAccepted =
      state.trusted.paste ||
      state.trusted.beforeinput ||
      state.trusted.input;

    const result = {
      ok: textAccepted && trustedInputAccepted,
      phase: state.phase,
      expectedLength: expected.length,
      actualLength: actual.length,
      actualPreview: actual.slice(0, 160),
      textAccepted,
      trustedInputAccepted,
      trusted: { ...state.trusted },
      submitFound: !!submit,
      submitEnabled: !!submit?.enabled,
      submitText: submit?.text || null
    };

    if (editor) mark(editor, result.ok ? '#25d366' : '#ffb020', 15000);
    if (submit?.button) mark(submit.button, result.ok ? '#25d366' : '#ff3b30', 15000);

    if (!trustedInputAccepted) {
      warn('Chữ có thể đang hiện nhưng chưa có event thật. Hãy click editor rồi Ctrl+A, Ctrl+V bằng bàn phím.');
    }

    log('checkPrompt', result);
    return result;
  }

  function findPromptRequiredToast() {
    return queryAll('[role="alert"],[aria-live],div')
      .filter(visible)
      .find(el => /bạn phải cung cấp câu lệnh|provide a prompt|enter a prompt/i.test(textOf(el))) || null;
  }

  async function armSubmit(timeoutMs = 30000) {
    const check = checkPrompt();
    if (!check.ok) {
      throw new Error(
        'Chưa xác nhận prompt bằng input thật. Click editor → Ctrl+A → Ctrl+V, rồi chạy checkPrompt() lại.'
      );
    }

    const submit = findSubmitButton();
    if (!submit?.button) throw new Error('Không tìm thấy nút Tạo.');
    if (!submit.enabled) throw new Error('Nút Tạo đang disabled.');

    mark(submit.button, '#25d366', timeoutMs + 3000);
    log(`Trong ${Math.round(timeoutMs / 1000)} giây, click THẬT nút Tạo viền xanh.`);

    return await new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        document.removeEventListener('click', onClick, true);
        clearTimeout(timer);
      };

      const onClick = async event => {
        const path = event.composedPath?.() || [];
        if (!path.includes(submit.button) && !submit.button.contains(event.target)) return;
        if (!event.isTrusted) {
          warn('Phát hiện click giả; bỏ qua.');
          return;
        }

        state.trusted.click = true;
        settled = true;
        cleanup();

        await sleep(1200);
        const toast = findPromptRequiredToast();
        const result = {
          ok: !toast,
          phase: state.phase,
          trustedClick: true,
          promptRequiredToast: !!toast,
          toastText: toast ? textOf(toast) : null
        };
        log('submit result', result);
        resolve(result);
      };

      document.addEventListener('click', onClick, true);

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error('Hết thời gian chờ click thật nút Tạo.'));
      }, timeoutMs);
    });
  }

  function mediaKey(img) {
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    try {
      const url = new URL(src, location.href);
      const uuid = url.searchParams.get('name');
      if (uuid) return `media:${uuid}`;
    } catch {}
    if (!src || src.startsWith('data:')) return null;
    return `src:${src.split('#')[0]}`;
  }

  function collectMedia() {
    const map = new Map();
    queryAll('img').forEach((img, index) => {
      const key = mediaKey(img);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ img, index, visible: visible(img) });
    });
    return map;
  }

  function baseline() {
    state.baselineMedia = new Set(collectMedia().keys());
    state.selectedMediaKey = null;
    const result = {
      ok: true,
      count: state.baselineMedia.size,
      keys: [...state.baselineMedia]
    };
    log('baseline media', result);
    return result;
  }

  async function waitImage(timeoutMs = 240000) {
    const deadline = Date.now() + timeoutMs;
    let previous = '';
    let stable = 0;

    while (Date.now() < deadline) {
      const media = collectMedia();
      const fresh = [...media.keys()].filter(key => !state.baselineMedia.has(key));
      const signature = fresh.sort().join('|');

      if (signature && signature === previous) stable += 1;
      else stable = signature ? 1 : 0;
      previous = signature;

      log('waitImage', { found: fresh.length, stable, fresh });

      if (fresh.length && stable >= 2) {
        state.selectedMediaKey = fresh[fresh.length - 1];
        const item = media.get(state.selectedMediaKey)?.find(x => x.visible) ||
          media.get(state.selectedMediaKey)?.[0];
        if (item?.img) mark(item.img, '#9b6cff', 30000);
        return {
          ok: true,
          mediaKey: state.selectedMediaKey,
          stablePolls: stable
        };
      }

      await sleep(1000);
    }

    throw new Error('Hết thời gian chờ ảnh mới.');
  }

  async function prepareImagePrompt(prompt) {
    return preparePrompt('image', prompt);
  }

  async function prepareVideoPrompt(prompt) {
    return preparePrompt('video', prompt);
  }

  function scan() {
    const editor = findEditor();
    const submit = findSubmitButton();
    const result = {
      version: VERSION,
      editorFound: !!editor,
      editorSelector: editor?.selector || null,
      editorValue: editorValue(editor?.el),
      submitFound: !!submit,
      submitEnabled: !!submit?.enabled,
      submitText: submit?.text || null,
      trusted: { ...state.trusted },
      selectedMediaKey: state.selectedMediaKey
    };
    log('scan', result);
    return result;
  }

  function reset() {
    removeListeners();
    state.phase = null;
    state.expectedPrompt = '';
    state.editor = null;
    resetTrustedFlags();
    state.baselineMedia = new Set();
    state.selectedMediaKey = null;
    return { ok: true };
  }

  window.FlowTrustedTest = Object.freeze({
    version: VERSION,
    scan,
    reset,
    baseline,
    waitImage,
    prepareImagePrompt,
    prepareVideoPrompt,
    checkPrompt,
    armSubmit
  });

  log(`Nạp xong v${VERSION}.`);
  log('Ảnh: baseline() → prepareImagePrompt(text) → Ctrl+A/Ctrl+V thật → checkPrompt() → armSubmit().');
  log('Video: prepareVideoPrompt(text) → Ctrl+A/Ctrl+V thật → checkPrompt() → armSubmit().');
})();
