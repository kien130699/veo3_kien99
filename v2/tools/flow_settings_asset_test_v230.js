/*
 * FlowSettingsAssetTest v2.3.0
 *
 * Dùng đúng DOM/ARIA đã live-capture từ Google Flow tiếng Việt:
 * - mở nút cấu hình tổng Hình ảnh/Video
 * - Hình ảnh -> tỷ lệ -> model -> x1..x4
 * - Video -> Thành phần/Khung hình -> tỷ lệ -> model -> x1..x4
 * - dấu add_2 -> chọn đúng ảnh theo media UUID -> Thêm vào câu lệnh
 *
 * Không bám class sc-* và không gọi private API.
 * Prompt dùng kèm FlowTrustedTest v2.2.0 để Ctrl+V thật vào Slate.
 */
(() => {
  'use strict';

  const VERSION = '2.3.0';
  const state = {
    settingsTrigger: null,
    baselineMedia: new Set(),
    selectedMediaKey: null,
  };

  const log = (...args) => console.log(
    '%c[FlowSettingsAssetTest]',
    'color:#8b5cf6;font-weight:bold',
    ...args,
  );
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();

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

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity || 1) !== 0
      && rect.width > 2 && rect.height > 2
      && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth;
  }

  function textOf(el) {
    if (!(el instanceof Element)) return '';
    return norm([
      el.innerText,
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
    ].filter(Boolean).join(' '));
  }

  function mark(el, color = '#8b5cf6', duration = 15000) {
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

  async function waitFor(getter, timeoutMs, description, pollMs = 100) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = getter();
      if (value) return value;
      await sleep(pollMs);
    }
    throw new Error(`Hết thời gian chờ ${description}`);
  }

  function isSelected(el) {
    return el?.getAttribute('aria-selected') === 'true'
      || el?.getAttribute('data-state') === 'active';
  }

  async function clickAndVerify(el, verify, description) {
    if (!(el instanceof HTMLElement)) throw new Error(`Không tìm thấy ${description}`);
    if (verify()) {
      log('Đã active sẵn:', description);
      return el;
    }
    mark(el, '#f59e0b', 8000);
    el.click();
    try {
      await waitFor(verify, 3500, `${description} active`);
    } catch (error) {
      mark(el, '#ef4444', 30000);
      throw error;
    }
    mark(el, '#22c55e', 4000);
    log('Đã chọn:', description, textOf(el));
    return el;
  }

  function findSettingsTrigger() {
    return queryAll('button[aria-haspopup="menu"]')
      .filter(visible)
      .map(button => {
        const text = textOf(button);
        let score = 0;
        if (/\bHình ảnh\b|\bVideo\b/i.test(text)) score += 160;
        if (/crop_(16_9|9_16)|crop_landscape|crop_portrait|crop_square/.test(text)) score += 160;
        if (/\bx[1-4]\b/i.test(text)) score += 120;
        if (/Nano Banana|Veo 3\.1/.test(text)) score -= 100;
        return { button, score };
      })
      .filter(item => item.score >= 300)
      .sort((a, b) => b.score - a.score)[0]?.button || null;
  }

  function findSettingsMenu() {
    return queryAll('[role="menu"]')
      .filter(visible)
      .find(menu => {
        const tabs = [...menu.querySelectorAll('[role="tab"]')];
        const hasImage = tabs.some(tab => /-content-IMAGE$/.test(tab.getAttribute('aria-controls') || ''));
        const hasVideo = tabs.some(tab => /-content-VIDEO$/.test(tab.getAttribute('aria-controls') || ''));
        return hasImage && hasVideo;
      }) || null;
  }

  async function openSettings() {
    const current = findSettingsMenu();
    if (current) return current;
    const trigger = findSettingsTrigger();
    if (!trigger) throw new Error('Không tìm thấy nút cấu hình Hình ảnh/Video');
    state.settingsTrigger = trigger;
    mark(trigger, '#f59e0b', 8000);
    trigger.click();
    const menu = await waitFor(findSettingsMenu, 5000, 'menu cấu hình');
    log('Đã mở menu cấu hình:', textOf(trigger));
    return menu;
  }

  async function closeSettings() {
    if (!findSettingsMenu()) return true;
    const trigger = state.settingsTrigger || findSettingsTrigger();
    if (!trigger) throw new Error('Không tìm thấy nút để đóng menu cấu hình');
    trigger.click();
    await waitFor(() => !findSettingsMenu(), 3500, 'menu cấu hình đóng');
    return true;
  }

  function exactTab(menu, suffix, fallbackRegex = null) {
    const tabs = [...menu.querySelectorAll('[role="tab"]')].filter(visible);
    const exact = tabs.find(tab => (
      tab.getAttribute('aria-controls') || ''
    ).endsWith(`-content-${suffix}`));
    if (exact) return exact;
    return fallbackRegex ? tabs.find(tab => fallbackRegex.test(textOf(tab))) || null : null;
  }

  async function chooseTab(menu, suffix, description, fallbackRegex = null) {
    const tab = exactTab(menu, suffix, fallbackRegex);
    if (!tab) throw new Error(`Không tìm thấy tab ${description}`);
    return clickAndVerify(tab, () => isSelected(tab), description);
  }

  const ASPECT = {
    '16:9': 'LANDSCAPE',
    '9:16': 'PORTRAIT',
    '4:3': 'LANDSCAPE_4_3',
    '3:4': 'PORTRAIT_3_4',
    '1:1': 'SQUARE',
  };

  async function chooseAspect(menu, aspect) {
    const suffix = ASPECT[aspect];
    if (!suffix) throw new Error(`Tỷ lệ không hỗ trợ: ${aspect}`);
    return chooseTab(menu, suffix, `tỷ lệ ${aspect}`, new RegExp(`^${aspect.replace(':', '\\:')}$`));
  }

  async function chooseOutputs(menu, outputs) {
    const count = Number(String(outputs).replace(/^x/i, ''));
    if (![1, 2, 3, 4].includes(count)) throw new Error(`Output không hợp lệ: ${outputs}`);
    return chooseTab(menu, String(count), `x${count}`, new RegExp(`^x${count}$`, 'i'));
  }

  function findModelTrigger(menu, mode) {
    const regex = mode === 'video' ? /Veo/i : /Nano Banana/i;
    return [...menu.querySelectorAll('button[aria-haspopup="menu"]')]
      .filter(visible)
      .find(button => regex.test(textOf(button))) || null;
  }

  async function chooseModel(settingsMenu, mode, modelName) {
    const trigger = findModelTrigger(settingsMenu, mode);
    if (!trigger) throw new Error(`Không tìm thấy dropdown model ${mode}`);
    if (textOf(trigger).toLowerCase().includes(modelName.toLowerCase())) {
      log('Model đã đúng sẵn:', modelName);
      return trigger;
    }

    trigger.click();
    const modelMenu = await waitFor(
      () => queryAll('[role="menu"]')
        .filter(menu => visible(menu) && menu !== settingsMenu)
        .find(menu => textOf(menu).toLowerCase().includes(modelName.toLowerCase())),
      5000,
      `menu model ${modelName}`,
    );

    const option = [...modelMenu.querySelectorAll('[role="menuitem"], [role="option"], button')]
      .filter(visible)
      .find(el => textOf(el).toLowerCase().includes(modelName.toLowerCase()));
    if (!option) throw new Error(`Không tìm thấy model ${modelName}`);
    option.click();
    await waitFor(
      () => textOf(trigger).toLowerCase().includes(modelName.toLowerCase()),
      5000,
      `model đổi sang ${modelName}`,
    );
    log('Đã chọn model:', modelName);
    return trigger;
  }

  async function configureImage({
    aspect = '16:9',
    model = 'Nano Banana 2',
    outputs = 1,
  } = {}) {
    const menu = await openSettings();
    await chooseTab(menu, 'IMAGE', 'Hình ảnh', /^Hình ảnh$|^Image$/i);
    await chooseAspect(menu, aspect);
    await chooseModel(menu, 'image', model);
    await chooseOutputs(menu, outputs);
    await closeSettings();
    const result = { ok: true, mode: 'image', aspect, model, outputs };
    log('Cấu hình ảnh hoàn tất:', result);
    return result;
  }

  async function configureVideo({
    sourceType = 'components',
    aspect = '16:9',
    model = 'Veo 3.1 - Fast',
    outputs = 1,
  } = {}) {
    const menu = await openSettings();
    await chooseTab(menu, 'VIDEO', 'Video', /^Video$/i);

    if (['components', 'references', 'Thành phần'].includes(sourceType)) {
      await chooseTab(menu, 'VIDEO_REFERENCES', 'Thành phần', /^Thành phần$|^Components$/i);
    } else if (['frames', 'Khung hình'].includes(sourceType)) {
      await chooseTab(menu, 'VIDEO_FRAMES', 'Khung hình', /^Khung hình$|^Frames$/i);
    } else {
      throw new Error(`sourceType không hỗ trợ: ${sourceType}`);
    }

    await chooseAspect(menu, aspect);
    await chooseModel(menu, 'video', model);
    await chooseOutputs(menu, outputs);
    await closeSettings();
    const result = { ok: true, mode: 'video', sourceType, aspect, model, outputs };
    log('Cấu hình video hoàn tất:', result);
    return result;
  }

  function mediaUuid(src) {
    try { return new URL(src, location.href).searchParams.get('name'); }
    catch { return String(src || '').match(/[?&]name=([0-9a-fA-F-]+)/)?.[1] || null; }
  }

  function mediaKey(img) {
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    const uuid = mediaUuid(src);
    if (uuid) return `media:${uuid}`;
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
    const result = { ok: true, count: state.baselineMedia.size, keys: [...state.baselineMedia] };
    log('Đã ghi baseline:', result);
    return result;
  }

  async function waitImage(timeoutMs = 240000) {
    const deadline = Date.now() + timeoutMs;
    let previous = '';
    let stable = 0;
    while (Date.now() < deadline) {
      const media = collectMedia();
      const fresh = [...media.keys()].filter(key => !state.baselineMedia.has(key));
      const signature = [...fresh].sort().join('|');
      if (signature && signature === previous) stable += 1;
      else stable = signature ? 1 : 0;
      previous = signature;
      log('Đang chờ ảnh mới:', { fresh, stable });
      if (fresh.length && stable >= 2) {
        state.selectedMediaKey = fresh[fresh.length - 1];
        const items = media.get(state.selectedMediaKey) || [];
        const representative = items.find(item => item.visible) || items[0];
        if (representative?.img) mark(representative.img, '#8b5cf6', 30000);
        return {
          ok: true,
          mediaKey: state.selectedMediaKey,
          uuid: state.selectedMediaKey.startsWith('media:') ? state.selectedMediaKey.slice(6) : null,
          stablePolls: stable,
        };
      }
      await sleep(1000);
    }
    throw new Error('Hết thời gian chờ ảnh mới');
  }

  function pickMediaUuid(uuid) {
    if (!uuid) throw new Error('UUID trống');
    state.selectedMediaKey = `media:${uuid}`;
    return { ok: true, mediaKey: state.selectedMediaKey };
  }

  function findAddButton() {
    return queryAll('button[aria-haspopup="dialog"]')
      .filter(visible)
      .map(button => {
        const text = textOf(button);
        let score = 0;
        if (/add_2/.test(text)) score += 300;
        if (/^Tạo$|^Create$/i.test(text)) score += 100;
        return { button, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.button || null;
  }

  function findAssetDialog() {
    return queryAll('[role="dialog"], [data-radix-popper-content-wrapper]')
      .filter(visible)
      .find(el => el.querySelector('[role="option"]')) || null;
  }

  async function openAssetPicker() {
    const button = findAddButton();
    if (!button) throw new Error('Không tìm thấy nút dấu + add_2');
    mark(button, '#f59e0b', 8000);
    button.click();
    const dialog = await waitFor(findAssetDialog, 5000, 'dialog chọn asset');
    log('Đã mở dialog asset.');
    return dialog;
  }

  function selectedUuid() {
    return state.selectedMediaKey?.startsWith('media:') ? state.selectedMediaKey.slice(6) : null;
  }

  function findTargetOption(dialog) {
    const uuid = selectedUuid();
    const options = [...dialog.querySelectorAll('[role="option"]')].filter(visible);
    if (uuid) {
      const exact = options.find(option => [...option.querySelectorAll('img')]
        .some(img => mediaUuid(img.currentSrc || img.src || img.getAttribute('src')) === uuid));
      if (exact) return exact;
    }
    const imageOptions = options.filter(option => /Hình ảnh|Image/i.test(textOf(option)));
    return imageOptions[imageOptions.length - 1] || null;
  }

  async function selectGeneratedImageAndAttach() {
    if (!state.selectedMediaKey) throw new Error('Chưa có mediaKey. Chạy waitImage() hoặc pickMediaUuid(uuid).');
    const dialog = findAssetDialog() || await openAssetPicker();
    const option = await waitFor(() => findTargetOption(dialog), 5000, 'ảnh đúng UUID');
    mark(option, '#f59e0b', 10000);
    if (!isSelected(option)) option.click();
    await waitFor(() => isSelected(option), 3500, 'ảnh aria-selected=true');
    mark(option, '#22c55e', 5000);

    const addButton = [...dialog.querySelectorAll('button')]
      .filter(visible)
      .find(button => /Thêm vào câu lệnh|Add to prompt/i.test(textOf(button)));
    if (!addButton) throw new Error('Không tìm thấy nút Thêm vào câu lệnh');
    mark(addButton, '#f59e0b', 8000);
    addButton.click();
    await waitFor(() => !visible(dialog), 5000, 'dialog đóng');
    const result = {
      ok: true,
      selectedMediaKey: state.selectedMediaKey,
      selectedUuid: selectedUuid(),
      optionText: textOf(option),
    };
    log('Đã thêm ảnh đúng UUID vào câu lệnh:', result);
    return result;
  }

  async function prepareVideoAsset(options = {}) {
    await configureVideo(options);
    await openAssetPicker();
    return selectGeneratedImageAndAttach();
  }

  function scan() {
    const result = {
      version: VERSION,
      settingsTriggerFound: !!findSettingsTrigger(),
      settingsTriggerText: textOf(findSettingsTrigger()),
      settingsMenuOpen: !!findSettingsMenu(),
      addButtonFound: !!findAddButton(),
      assetDialogOpen: !!findAssetDialog(),
      baselineCount: state.baselineMedia.size,
      selectedMediaKey: state.selectedMediaKey,
      selectedUuid: selectedUuid(),
    };
    log('scan:', result);
    return result;
  }

  function reset() {
    state.settingsTrigger = null;
    state.baselineMedia = new Set();
    state.selectedMediaKey = null;
    return { ok: true };
  }

  window.FlowSettingsAssetTest = Object.freeze({
    version: VERSION,
    scan,
    reset,
    openSettings,
    closeSettings,
    configureImage,
    configureVideo,
    baseline,
    waitImage,
    pickMediaUuid,
    openAssetPicker,
    selectGeneratedImageAndAttach,
    prepareVideoAsset,
  });

  log(`Nạp xong v${VERSION}.`);
  log('Ảnh: configureImage() -> baseline() -> dùng FlowTrustedTest để nhập/submit -> waitImage().');
  log('Video: prepareVideoAsset() -> dùng FlowTrustedTest để nhập/submit video prompt.');
})();
