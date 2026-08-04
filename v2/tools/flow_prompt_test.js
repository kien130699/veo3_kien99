/* FlowPromptTest v1.5.0 — kiểm tra Flow bằng click thật của người dùng.

Cách dùng:
1) Dán toàn bộ file vào Console của tab Google Flow.
2) Chọn Image hoặc Video thủ công.
3) Chạy:
   await FlowPromptTest.prepare('prompt...')
4) Click ô prompt viền tím và nhấn Ctrl+V thật.
5) Chạy:
   FlowPromptTest.check()
6) Chạy:
   await FlowPromptTest.armSubmit(20000)
7) Trong 20 giây, click trực tiếp nút Tạo đang viền xanh.

Lưu ý:
- Không dùng HTMLElement.click() để submit.
- Script chỉ quan sát click thật và báo event.isTrusted.
*/
(() => {
  'use strict';

  const VERSION = '1.5.0';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const log = (...args) =>
    console.log('%c[FlowPromptTest]', 'color:#9b6cff;font-weight:bold', ...args);

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
      rect.width > 2 &&
      rect.height > 2 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth;
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
    return [
      element.innerText,
      element.textContent,
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('placeholder')
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buttonText(element) {
    return (
      textOf(element) +
      ' ' +
      [...element.querySelectorAll('i,span')]
        .map(item => item.textContent || '')
        .join(' ')
    )
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function findEditor() {
    for (const selector of EDITOR_SELECTORS) {
      const candidate = query(selector).find(visible);
      if (candidate) return candidate;
    }
    return null;
  }

  function findProjectButton() {
    const labelPattern =
      /new project|create project|start project|dự án mới|tạo dự án|novo projeto|nuevo proyecto/i;

    return query('button,[role="button"]').find(element => {
      if (!visible(element)) return false;
      const label = buttonText(element);
      return labelPattern.test(label) ||
        /(^|\s)add(_2)?($|\s)|add_circle/i.test(label);
    }) || null;
  }

  function nearestComposer(editor) {
    let node = editor;
    for (let depth = 0; depth < 10 && node; depth += 1, node = node.parentElement) {
      const buttons = [...(node.querySelectorAll?.('button') || [])];
      if (buttons.some(button =>
        /arrow_forward|generate|create|submit|send|tạo|gerar|criar|crear/i.test(buttonText(button))
      )) {
        return node;
      }
    }
    return editor.parentElement || document.body;
  }

  function findSubmitButton() {
    const editor = findEditor();
    if (!editor) return null;

    const composer = nearestComposer(editor);
    const candidates = query('button')
      .filter(visible)
      .map(button => {
        const label = buttonText(button);
        const rect = button.getBoundingClientRect();
        let score = composer.contains(button) ? 100 : 0;

        if (/arrow_forward/.test(label)) score += 250;
        if (/generate|create|submit|send|tạo|gerar|criar|crear/i.test(label)) score += 160;
        if (rect.top > innerHeight * 0.45) score += 40;
        if (/download|upload|delete|close|back|settings|tune|more_vert/i.test(label)) score -= 400;

        return { button, score };
      })
      .filter(item => item.score > 120)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.button || null;
  }

  function mark(element, color, duration = 8000) {
    const previous = element.style.outline;
    element.style.outline = `4px solid ${color}`;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    setTimeout(() => {
      element.style.outline = previous;
    }, duration);
  }

  async function ensureEditor() {
    let editor = findEditor();
    if (editor) return editor;

    const projectButton = findProjectButton();
    if (!projectButton) {
      throw new Error('Không tìm thấy prompt editor hoặc nút Dự án mới.');
    }

    log('Mở project:', buttonText(projectButton));
    projectButton.click();

    for (let index = 0; index < 40; index += 1) {
      await sleep(500);
      editor = findEditor();
      if (editor) return editor;
    }

    throw new Error('Đã mở project nhưng prompt editor chưa xuất hiện sau 20 giây.');
  }

  function editorText(editor) {
    if (!editor) return '';
    if ('value' in editor) return String(editor.value || '').trim();
    return String(editor.innerText || editor.textContent || '').trim();
  }

  function check() {
    const editor = findEditor();
    const submitButton = findSubmitButton();
    const prompt = editorText(editor);

    const result = {
      version: VERSION,
      editorFound: Boolean(editor),
      editorText: prompt,
      promptAccepted: prompt.length > 0,
      submitFound: Boolean(submitButton),
      submitEnabled: Boolean(
        submitButton &&
        !submitButton.disabled &&
        submitButton.getAttribute('aria-disabled') !== 'true'
      ),
      submitText: submitButton ? buttonText(submitButton) : null,
      ariaDisabled: submitButton?.getAttribute('aria-disabled') ?? null
    };

    if (result.promptAccepted && result.submitEnabled) {
      mark(submitButton, '#25d366');
      log('PASS: Flow đã nhận prompt và nút Tạo đang bật.', result);
    } else {
      console.warn('[FlowPromptTest] Chưa sẵn sàng submit.', result);
    }

    return result;
  }

  async function prepare(prompt) {
    if (!String(prompt || '').trim()) {
      throw new Error('Prompt không được để trống.');
    }

    const editor = await ensureEditor();
    mark(editor, '#9b6cff', 15000);
    editor.focus();

    try {
      await navigator.clipboard.writeText(prompt);
      log('Đã copy prompt. Click ô viền tím rồi nhấn Ctrl+V thật.');
    } catch {
      console.warn('[FlowPromptTest] Không ghi được clipboard. Hãy copy prompt thủ công.');
    }

    return {
      version: VERSION,
      editorFound: true,
      autoInserted: false,
      next: 'Click prompt editor, press Ctrl+V, then run FlowPromptTest.check()'
    };
  }

  async function armSubmit(timeoutMs = 20000) {
    const state = check();
    if (!state.promptAccepted) {
      throw new Error('Flow chưa nhận prompt.');
    }
    if (!state.submitFound || !state.submitEnabled) {
      throw new Error('Nút Tạo chưa sẵn sàng.');
    }

    const button = findSubmitButton();
    const beforeMedia = query('img,video').length;
    const beforeUrl = location.href;
    mark(button, '#25d366', timeoutMs + 2000);

    log(
      `Đã khóa đúng nút Tạo. Trong ${Math.round(timeoutMs / 1000)} giây, ` +
      'click TRỰC TIẾP nút viền xanh trên trang Flow.'
    );

    return await new Promise((resolve, reject) => {
      let settled = false;
      const startedAt = performance.now();

      const cleanup = () => {
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('click', onClick, true);
        clearTimeout(timer);
      };

      const finish = async event => {
        if (settled) return;
        settled = true;
        cleanup();

        log('Nhận click thật:', {
          type: event.type,
          isTrusted: event.isTrusted,
          target: event.target
        });

        await sleep(1500);

        const currentButton = findSubmitButton();
        const afterMedia = query('img,video').length;
        const bodyText = String(document.body.innerText || '').toLowerCase();
        const generatingSignal =
          /generating|creating|đang tạo|processing|đang xử lý|queued|hàng đợi/.test(bodyText);

        const result = {
          ok: true,
          version: VERSION,
          trustedClick: event.isTrusted,
          eventType: event.type,
          elapsedMs: Math.round(performance.now() - startedAt),
          urlChanged: location.href !== beforeUrl,
          submitStillFound: Boolean(currentButton),
          submitNowEnabled: Boolean(
            currentButton &&
            !currentButton.disabled &&
            currentButton.getAttribute('aria-disabled') !== 'true'
          ),
          mediaDelta: afterMedia - beforeMedia,
          generatingSignal
        };

        log('Kết quả sau click:', result);
        resolve(result);
      };

      const isTargetButton = event => {
        const path = event.composedPath?.() || [];
        return path.includes(button) || button.contains(event.target);
      };

      const onPointer = event => {
        if (isTargetButton(event) && event.isTrusted) {
          log('pointerdown thật đã chạm đúng nút Tạo.');
        }
      };

      const onClick = event => {
        if (!isTargetButton(event)) return;
        if (!event.isTrusted) {
          console.warn('[FlowPromptTest] Click giả bị bỏ qua:', event);
          return;
        }
        void finish(event);
      };

      document.addEventListener('pointerdown', onPointer, true);
      document.addEventListener('click', onClick, true);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(
          'Hết thời gian mà không nhận được click thật trên nút Tạo. ' +
          'Hãy chạy armSubmit() lại rồi click trực tiếp nút viền xanh.'
        ));
      }, timeoutMs);
    });
  }

  function submit() {
    console.warn(
      '[FlowPromptTest] Không dùng button.click() vì đó là click giả. ' +
      'Chạy await FlowPromptTest.armSubmit(20000), rồi click trực tiếp nút viền xanh.'
    );
    return {
      ok: false,
      syntheticClickBlocked: true,
      next: 'await FlowPromptTest.armSubmit(20000)'
    };
  }

  async function scan() {
    const editor = findEditor();
    const projectButton = findProjectButton();
    const submitButton = findSubmitButton();

    if (editor) mark(editor, '#9b6cff');
    if (!editor && projectButton) mark(projectButton, '#ffb020');
    if (submitButton) mark(submitButton, '#25d366');

    const result = {
      version: VERSION,
      url: location.href,
      editorFound: Boolean(editor),
      projectButtonFound: Boolean(projectButton),
      submitFound: Boolean(submitButton)
    };

    log('Scan:', result);
    return result;
  }

  window.FlowPromptTest = Object.freeze({
    version: VERSION,
    scan,
    prepare,
    check,
    armSubmit,
    submit
  });

  log(
    `Nạp xong v${VERSION}. ` +
    'Dùng prepare() → Ctrl+V thật → check() → armSubmit() → click nút thật.'
  );
})();
