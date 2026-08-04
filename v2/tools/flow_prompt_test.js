/* FlowPromptTest v1.4.0 — test prompt Slate bằng thao tác dán thật.

Cách dùng:
1) Dán toàn bộ file vào Console của tab Google Flow.
2) Chọn Image hoặc Video thủ công trên Flow.
3) Chạy:
   await FlowPromptTest.prepare('A red ceramic teapot on a table...')
4) Click ô prompt đang viền tím, nhấn Ctrl+V thật.
5) Chạy:
   FlowPromptTest.check()
6) Khi promptAccepted=true và submitEnabled=true:
   FlowPromptTest.submit()

Không chèn prompt bằng textContent/execCommand/InputEvent giả.
*/
(() => {
  'use strict';

  const VERSION = '1.4.0';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const log = (...args) => console.log('%c[FlowPromptTest]', 'color:#9b6cff;font-weight:bold', ...args);

  const EDITOR_SELECTORS = [
    '[data-slate-editor="true"][contenteditable="true"]',
    '[data-slate-editor="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-placeholder]',
    'textarea[placeholder*="prompt" i]',
    'textarea'
  ];

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 2 && rect.height > 2 &&
      rect.bottom > 0 && rect.right > 0;
  }

  function roots() {
    const list = [document];
    const seen = new Set(list);
    for (let index = 0; index < list.length; index += 1) {
      const root = list[index];
      for (const element of root.querySelectorAll?.('*') || []) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) {
          seen.add(element.shadowRoot);
          list.push(element.shadowRoot);
        }
        if (element.tagName === 'IFRAME') {
          try {
            if (element.contentDocument && !seen.has(element.contentDocument)) {
              seen.add(element.contentDocument);
              list.push(element.contentDocument);
            }
          } catch {
            // Cross-origin iframe: ignore.
          }
        }
      }
    }
    return list;
  }

  function queryAll(selector) {
    return roots().flatMap(root => {
      try {
        return [...root.querySelectorAll(selector)];
      } catch {
        return [];
      }
    });
  }

  function textOf(element) {
    return [
      element?.innerText,
      element?.textContent,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('placeholder'),
      element?.getAttribute?.('data-placeholder')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function normalized(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findEditor() {
    for (const selector of EDITOR_SELECTORS) {
      const editor = queryAll(selector).find(visible);
      if (editor) return editor;
    }
    return null;
  }

  function findProjectButton() {
    const label = /new project|create project|start project|dự án mới|tạo dự án|novo projeto|nuevo proyecto/i;
    const buttons = queryAll('button,[role="button"]').filter(visible);
    return buttons.find(button => {
      const value = textOf(button);
      return label.test(value) || /(^|\s)add(_2)?($|\s)/i.test(value);
    }) || null;
  }

  function composerFor(editor) {
    let node = editor;
    for (let depth = 0; depth < 12 && node; depth += 1, node = node.parentElement) {
      const buttons = [...(node.querySelectorAll?.('button') || [])];
      if (buttons.some(button => /arrow_forward|add_2|send|generate|create|submit|tạo/i.test(textOf(button)))) {
        return node;
      }
    }
    return editor.parentElement || document.body;
  }

  function submitCandidates(editor) {
    const composer = composerFor(editor);
    const seen = new Set();
    const candidates = [
      ...(composer.querySelectorAll?.('button') || []),
      ...queryAll('button')
    ].filter(button => {
      if (seen.has(button)) return false;
      seen.add(button);
      return visible(button);
    });

    return candidates.map(button => {
      const value = textOf(button).toLowerCase();
      let score = composer.contains(button) ? 100 : 0;
      if (/arrow_forward/.test(value)) score += 260;
      if (/(^|\s)add_2($|\s)/.test(value)) score += 210;
      if (/generate|create|submit|send|tạo|gerar|criar|crear/.test(value)) score += 180;
      if (/new project|dự án mới|tạo dự án/.test(value)) score -= 500;
      if (/download|upload|back|close|delete|settings|tune|more_vert/.test(value)) score -= 400;
      const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
      return { button, score, disabled, text: textOf(button) };
    }).filter(item => item.score > 100).sort((a, b) => b.score - a.score);
  }

  function mark(element, color = '#9b6cff') {
    const oldOutline = element.style.outline;
    const oldOffset = element.style.outlineOffset;
    element.style.outline = `4px solid ${color}`;
    element.style.outlineOffset = '3px';
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    setTimeout(() => {
      element.style.outline = oldOutline;
      element.style.outlineOffset = oldOffset;
    }, 12000);
  }

  async function ensureEditor() {
    let editor = findEditor();
    if (editor) return editor;

    const projectButton = findProjectButton();
    if (!projectButton) {
      throw new Error('Không tìm thấy prompt editor hoặc nút Dự án mới.');
    }

    log('Mở project:', textOf(projectButton));
    projectButton.click();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleep(400);
      editor = findEditor();
      if (editor) return editor;
    }

    throw new Error('Đã bấm Dự án mới nhưng editor chưa xuất hiện sau 20 giây.');
  }

  async function scan() {
    const editor = findEditor();
    if (editor) {
      mark(editor);
      const candidates = submitCandidates(editor);
      console.table(candidates.map((item, index) => ({
        rank: index + 1,
        text: item.text,
        score: item.score,
        disabled: item.disabled
      })));
      return {
        version: VERSION,
        url: location.href,
        editorFound: true,
        editorText: normalized(editor.value || editor.innerText || editor.textContent),
        submitCandidates: candidates.length
      };
    }

    const projectButton = findProjectButton();
    if (projectButton) mark(projectButton, '#ffb020');
    return {
      version: VERSION,
      url: location.href,
      editorFound: false,
      projectButtonFound: Boolean(projectButton)
    };
  }

  async function prepare(prompt) {
    const value = normalized(prompt);
    if (!value) throw new Error('Prompt đang trống.');

    const editor = await ensureEditor();
    mark(editor);

    let clipboardReady = false;
    try {
      await navigator.clipboard.writeText(prompt);
      clipboardReady = true;
    } catch (error) {
      console.warn('[FlowPromptTest] Không ghi được clipboard:', error);
    }

    log('Đã tìm thấy editor.', editor);
    if (clipboardReady) {
      console.warn('[FlowPromptTest] BƯỚC TIẾP: click ô prompt viền tím rồi nhấn Ctrl+V thật. Không dán lệnh vào Console nữa.');
    } else {
      console.warn('[FlowPromptTest] Copy prompt thủ công, click ô viền tím rồi nhấn Ctrl+V.');
      console.log(prompt);
    }

    return {
      ok: true,
      version: VERSION,
      clipboardReady,
      prompt,
      next: 'Click prompt editor, press Ctrl+V, then run FlowPromptTest.check()'
    };
  }

  function check() {
    const editor = findEditor();
    if (!editor) throw new Error('Không tìm thấy prompt editor.');

    const editorText = normalized(editor.value || editor.innerText || editor.textContent);
    const candidates = submitCandidates(editor);
    const best = candidates[0] || null;
    const result = {
      version: VERSION,
      editorText,
      promptAccepted: editorText.length > 0,
      submitFound: Boolean(best),
      submitText: best?.text || null,
      submitEnabled: Boolean(best && !best.disabled),
      ariaDisabled: best?.button?.getAttribute('aria-disabled') ?? null,
      nativeDisabled: best?.button?.disabled ?? null
    };

    if (result.promptAccepted && result.submitEnabled) {
      mark(best.button, '#22c55e');
      log('PASS: Flow đã nhận prompt và nút Tạo đang bật.', result);
    } else {
      mark(editor, '#ef4444');
      console.warn('[FlowPromptTest] Chưa PASS.', result);
    }
    return result;
  }

  function submit() {
    const state = check();
    if (!state.promptAccepted) {
      throw new Error('Flow vẫn chưa nhận prompt. Click editor rồi Ctrl+V thật.');
    }
    if (!state.submitFound || !state.submitEnabled) {
      throw new Error('Nút Tạo chưa bật hoặc chưa tìm thấy.');
    }

    const editor = findEditor();
    const best = submitCandidates(editor)[0];
    mark(best.button, '#ff4fd8');
    best.button.click();
    log('Đã click nút Tạo:', best.text);
    return { ok: true, button: best.text };
  }

  window.FlowPromptTest = Object.freeze({
    version: VERSION,
    scan,
    prepare,
    check,
    submit
  });

  log(`Nạp xong v${VERSION}. Chạy await FlowPromptTest.prepare('prompt')`);
})();
