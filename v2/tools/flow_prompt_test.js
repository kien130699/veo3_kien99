/* FlowPromptTest v1.3.0 — selector diagnostic only.
   DevTools Console cannot generate trusted keyboard input for Flow's Slate editor.
   Use V2.0.3 for real submission through Playwright/CDP.

   await FlowPromptTest.scan()
   await FlowPromptTest.prepare('image', 'prompt')
   await FlowPromptTest.prepare('video', 'prompt')
*/
(() => {
  'use strict';
  const V = '1.3.0';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...args) => console.log('%c[FlowPromptTest]', 'color:#9b6cff;font-weight:bold', ...args);
  const selectors = [
    '[data-slate-editor="true"][contenteditable="true"]',
    '[data-slate-editor="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-placeholder]',
    'textarea[placeholder*="prompt" i]',
    'textarea'
  ];
  const visible = e => {
    if (!(e instanceof Element)) return false;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2;
  };
  const text = e => [
    e.innerText, e.textContent, e.getAttribute?.('aria-label'),
    e.getAttribute?.('title'), e.getAttribute?.('placeholder')
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const roots = () => {
    const all = [document], seen = new Set(all);
    for (let i = 0; i < all.length; i++) {
      for (const e of all[i].querySelectorAll?.('*') || []) {
        if (e.shadowRoot && !seen.has(e.shadowRoot)) { seen.add(e.shadowRoot); all.push(e.shadowRoot); }
      }
    }
    return all;
  };
  const query = selector => roots().flatMap(r => {
    try { return [...r.querySelectorAll(selector)]; } catch { return []; }
  });
  const findEditor = () => {
    for (const selector of selectors) {
      const item = query(selector).find(visible);
      if (item) return item;
    }
    return null;
  };
  const findProjectButton = () => {
    const re = /new project|create project|start project|dự án mới|tạo dự án|novo projeto|nuevo proyecto/i;
    return query('button,[role="button"]').find(e => visible(e) && (re.test(text(e)) || /(^|\s)add(_2)?($|\s)/i.test(text(e))));
  };
  const mark = (e, color = '#9b6cff') => {
    const old = e.style.outline;
    e.style.outline = `4px solid ${color}`;
    e.scrollIntoView({ block: 'center' });
    setTimeout(() => { e.style.outline = old; }, 5000);
  };
  async function scan() {
    const editor = findEditor();
    if (editor) {
      mark(editor);
      log('Tìm thấy Slate editor:', editor);
      return { version: V, url: location.href, editorFound: true };
    }
    const project = findProjectButton();
    if (project) {
      mark(project, '#ffb020');
      log('Đang ở gallery. Nút tạo project:', project);
    }
    return { version: V, url: location.href, editorFound: false, projectButtonFound: Boolean(project) };
  }
  async function ensureEditor() {
    let editor = findEditor();
    if (editor) return editor;
    const project = findProjectButton();
    if (!project) throw new Error('Không tìm thấy editor hoặc nút Dự án mới.');
    project.click();
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      editor = findEditor();
      if (editor) return editor;
    }
    throw new Error('Đã mở project nhưng editor chưa xuất hiện.');
  }
  async function prepare(mode, prompt) {
    const editor = await ensureEditor();
    mark(editor);
    editor.focus();
    try {
      await navigator.clipboard.writeText(prompt || '');
      log(`Đã copy prompt ${mode} vào clipboard. Bấm Ctrl+V thủ công trong ô đang viền tím.`);
    } catch {
      log('Không ghi được clipboard. Copy prompt thủ công rồi Ctrl+V vào ô viền tím.');
    }
    console.warn('[FlowPromptTest] Không tự chèn hoặc submit prompt từ Console vì Flow Slate có thể hiện chữ nhưng state vẫn rỗng. Dùng V2.0.3 để nhập bằng keyboard thật qua CDP.');
    return { ok: true, mode, editorFound: true, autoSubmitted: false };
  }
  window.FlowPromptTest = Object.freeze({ version: V, scan, prepare });
  log(`Nạp xong v${V}. Đây là công cụ dò selector, không tự submit. Chạy await FlowPromptTest.scan()`);
})();
