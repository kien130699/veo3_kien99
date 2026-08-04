/*
 * FlowSettingsAssetTest v2.3.1
 *
 * Fix live Google Flow Vietnamese UI:
 * - detect settings trigger structurally, even when DevTools shrinks/clips viewport
 * - configure Image/Video, Components/Frames, aspect, model, x1..x4
 * - close settings, open add_2 asset picker
 * - select exact generated image by media UUID and click "Thêm vào câu lệnh"
 *
 * Does not depend on sc-* classes and does not call private APIs.
 * Use with FlowTrustedTest v2.2.0 for real Ctrl+V prompt input.
 */
(() => {
  'use strict';

  const VERSION = '2.3.1';
  const state = {
    settingsTrigger: null,
    baselineMedia: new Set(),
    selectedMediaKey: null,
    debug: [],
  };

  const log = (...args) => console.log(
    '%c[FlowSettingsAssetTest]',
    'color:#8b5cf6;font-weight:bold',
    ...args,
  );
  const warn = (...args) => console.warn('[FlowSettingsAssetTest]', ...args);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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

  // Do not require the element to be inside the current viewport. DevTools may
  // shrink the viewport and Flow can keep the composer partially clipped.
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

  function textOf(el) {
    if (!(el instanceof Element)) return '';
    return norm([
      el.innerText,
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('value'),
    ].filter(Boolean).join(' '));
  }

  function iconText(el) {
    if (!(el instanceof Element)) return '';
    return norm([...el.querySelectorAll('i.google-symbols, i')]
      .map(icon => icon.textContent || '')
      .join(' '));
  }

  function mark(el, color = '#8b5cf6', duration = 15000) {
    if (!(el instanceof HTMLElement)) return;
    const oldOutline = el.style.outline;
    const oldOffset = el.style.outlineOffset;
    el.style.outline = `5px solid ${color}`;
    el.style.outlineOffset = '3px';
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    setTimeout(() => {
      el.style.outline = oldOutline;
      el.style.outlineOffset = oldOffset;
    }, duration);
  }

  async function waitFor(getter, timeoutMs, description, pollMs = 100) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = getter();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(pollMs);
    }
    throw new Error(
      `Hết thời gian chờ ${description}${lastError ? `: ${lastError.message}` : ''}`,
    );
  }

  function isSelected(el) {
    return el?.getAttribute('aria-selected') === 'true'
      || el?.getAttribute('data-state') === 'active';
  }

  function settingsTriggerCandidates() {
    return queryAll('button[aria-haspopup="menu"]')
      .filter(rendered)
      .map((button, index) => {
        const text = textOf(button);
        const icons = iconText(button);
        const rect = button.getBoundingClientRect();
        let score = 0;
        const reasons = [];

        if (/crop_(16_9|9_16)|crop_landscape|crop_portrait|crop_square/.test(icons)) {
          score += 500;
          reasons.push('crop-icon');
        }
        if (/^(Hình ảnh|Video)\b/i.test(text)) {
          score += 260;
          reasons.push('mode-text');
        } else if (/\b(Hình ảnh|Video)\b/i.test(text)) {
          score += 160;
          reasons.push('mode-text-loose');
        }
        if (/\bx[1-4]\b/i.test(text)) {
          score += 180;
          reasons.push('output-count');
        }
        if (button.getAttribute('aria-expanded') === 'true') {
          score += 30;
          reasons.push('expanded');
        }
        if (/arrow_drop_down/.test(icons)) {
          score -= 180;
          reasons.push('model-arrow-penalty');
        }
        if (/Nano Banana|Veo\s*3/i.test(text)) {
          score -= 350;
          reasons.push('model-text-penalty');
        }

        return {
          button,
          index,
          score,
          reasons,
          text,
          icons,
          expanded: button.getAttribute('aria-expanded'),
          state: button.getAttribute('data-state'),
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  function findSettingsTrigger() {
    const candidates = settingsTriggerCandidates();
    const exact = candidates.find(item => item.score >= 700);
    if (exact) return exact.button;

    const fallback = queryAll('button[aria-haspopup="menu"]')
      .filter(rendered)
      .find(button => {
        const icons = iconText(button);
        const text = textOf(button);
        return /crop_/.test(icons) && /Hình ảnh|Video/i.test(text);
      });
    return fallback || null;
  }

  function scanSettingsCandidates() {
    const rows = settingsTriggerCandidates().map(({ button, ...item }) => item);
    console.table(rows);
    const result = {
      version: VERSION,
      found: !!findSettingsTrigger(),
      candidates: rows,
    };
    log('settings trigger diagnostics', result);
    return result;
  }

  function findSettingsMenu() {
    const menus = queryAll('[role="menu"]')
      .filter(rendered)
      .filter(menu => menu.getAttribute('data-state') !== 'closed');

    return menus.find(menu => {
      const tabs = [...menu.querySelectorAll('[role="tab"]')];
      const controls = tabs.map(tab => tab.getAttribute('aria-controls') || '');
      const hasImage = controls.some(value => /-content-IMAGE$/.test(value));
      const hasVideo = controls.some(value => /-content-VIDEO$/.test(value));
      return hasImage && hasVideo;
    }) || null;
  }

  async function clickElement(el, description) {
    if (!(el instanceof HTMLElement)) throw new Error(`Không tìm thấy ${description}`);
    mark(el, '#f59e0b', 7000);
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    el.click();
    await sleep(100);
    return el;
  }

  async function openSettings() {
    const current = findSettingsMenu();
    if (current) return current;

    const trigger = findSettingsTrigger();
    if (!trigger) {
      const diagnostics = scanSettingsCandidates();
      throw new Error(
        `Không tìm thấy nút cấu hình Hình ảnh/Video. Candidates=${JSON.stringify(diagnostics.candidates)}`,
      );
    }

    state.settingsTrigger = trigger;
    await clickElement(trigger, 'nút cấu hình Hình ảnh/Video');
    const menu = await waitFor(findSettingsMenu, 6000, 'menu cấu hình');
    mark(menu, '#22c55e', 4000);
    log('Đã mở menu cấu hình:', {
      text: textOf(trigger),
      icons: iconText(trigger),
    });
    return menu;
  }

  async function closeSettings() {
    if (!findSettingsMenu()) return true;
    let trigger = state.settingsTrigger;
    if (!(trigger instanceof HTMLElement) || !trigger.isConnected) {
      trigger = findSettingsTrigger();
    }
    if (!trigger) throw new Error('Không tìm thấy nút để đóng menu cấu hình');
    await clickElement(trigger, 'nút đóng menu cấu hình');
    await waitFor(() => !findSettingsMenu(), 5000, 'menu cấu hình đóng');
    return true;
  }

  function exactTab(menu, suffix, fallbackRegex = null) {
    if (!(menu instanceof Element)) return null;
    const tabs = [...menu.querySelectorAll('[role="tab"]')].filter(rendered);
    const exact = tabs.find(tab => (
      tab.getAttribute('aria-controls') || ''
    ).endsWith(`-content-${suffix}`));
    if (exact) return exact;
    return fallbackRegex
      ? tabs.find(tab => fallbackRegex.test(textOf(tab))) || null
      : null;
  }

  async function chooseTab(suffix, description, fallbackRegex = null) {
    let menu = await openSettings();
    let tab = exactTab(menu, suffix, fallbackRegex);
    if (!tab) throw new Error(`Không tìm thấy tab ${description}`);
    if (!isSelected(tab)) {
      await clickElement(tab, `tab ${description}`);
      await waitFor(() => {
        menu = findSettingsMenu() || menu;
        tab = exactTab(menu, suffix, fallbackRegex) || tab;
        return isSelected(tab);
      }, 5000, `${description} active`);
    }
    mark(tab, '#22c55e', 3000);
    log('Đã chọn:', description, textOf(tab));
    return tab;
  }

  const ASPECT = {
    '16:9': 'LANDSCAPE',
    '9:16': 'PORTRAIT',
    '4:3': 'LANDSCAPE_4_3',
    '3:4': 'PORTRAIT_3_4',
    '1:1': 'SQUARE',
  };

  async function chooseAspect(aspect) {
    const suffix = ASPECT[aspect];
    if (!suffix) throw new Error(`Tỷ lệ không hỗ trợ: ${aspect}`);
    return chooseTab(suffix, `tỷ lệ ${aspect}`, new RegExp(`^${aspect.replace(':', '\\:')}$`));
  }

  async function chooseOutputs(outputs) {
    const count = Number(String(outputs).replace(/^x/i, ''));
    if (![1, 2, 3, 4].includes(count)) throw new Error(`Output không hợp lệ: ${outputs}`);
    return chooseTab(String(count), `x${count}`, new RegExp(`^x${count}$`, 'i'));
  }

  function findModelTrigger(mode) {
    const menu = findSettingsMenu();
    if (!menu) return null;
    const regex = mode === 'video' ? /Veo/i : /Nano Banana/i;
    return [...menu.querySelectorAll('button[aria-haspopup="menu"]')]
      .filter(rendered)
      .find(button => regex.test(textOf(button))) || null;
  }

  function findModelMenu(modelName, settingsMenu) {
    return queryAll('[role="menu"]')
      .filter(rendered)
      .filter(menu => menu !== settingsMenu)
      .find(menu => textOf(menu).toLowerCase().includes(modelName.toLowerCase())) || null;
  }

  async function chooseModel(mode, modelName) {
    const settingsMenu = await openSettings();
    let trigger = findModelTrigger(mode);
    if (!trigger) throw new Error(`Không tìm thấy dropdown model ${mode}`);
    if (textOf(trigger).toLowerCase().includes(modelName.toLowerCase())) {
      log('Model đã đúng sẵn:', modelName);
      return trigger;
    }

    await clickElement(trigger, `dropdown model ${mode}`);
    const modelMenu = await waitFor(
      () => findModelMenu(modelName, settingsMenu),
      6000,
      `menu model ${modelName}`,
    );

    const option = [...modelMenu.querySelectorAll('[role="menuitem"], [role="option"], button')]
      .filter(rendered)
      .find(el => textOf(el).toLowerCase().includes(modelName.toLowerCase()));
    if (!option) throw new Error(`Không tìm thấy model ${modelName}`);

    await clickElement(option, `model ${modelName}`);
    await waitFor(() => {
      trigger = findModelTrigger(mode) || trigger;
      return textOf(trigger).toLowerCase().includes(modelName.toLowerCase());
    }, 6000, `model đổi sang ${modelName}`);
    log('Đã chọn model:', modelName);
    return trigger;
  }

  async function configureImage({
    aspect = '16:9',
    model = 'Nano Banana 2',
    outputs = 1,
  } = {}) {
    await openSettings();
    await chooseTab('IMAGE', 'Hình ảnh', /^Hình ảnh$|^Image$/i);
    await chooseAspect(aspect);
    await chooseModel('image', model);
    await chooseOutputs(outputs);
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
    await openSettings();
    await chooseTab('VIDEO', 'Video', /^Video$/i);

    if (['components', 'references', 'Thành phần'].includes(sourceType)) {
      await chooseTab('VIDEO_REFERENCES', 'Thành phần', /^Thành phần$|^Components$/i);
    } else if (['frames', 'Khung hình'].includes(sourceType)) {
      await chooseTab('VIDEO_FRAMES', 'Khung hình', /^Khung hình$|^Frames$/i);
    } else {
      throw new Error(`sourceType không hỗ trợ: ${sourceType}`);
    }

    await chooseAspect(aspect);
    await chooseModel('video', model);
    await chooseOutputs(outputs);
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
      map.get(key).push({ img, index, rendered: rendered(img), alt: img.alt || '' });
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
        const representative = items.find(item => item.rendered) || items[0];
        if (representative?.img) mark(representative.img, '#8b5cf6', 30000);
        return {
          ok: true,
          mediaKey: state.selectedMediaKey,
          uuid: state.selectedMediaKey.startsWith('media:')
            ? state.selectedMediaKey.slice(6)
            : null,
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
    const candidates = queryAll('button[aria-haspopup="dialog"]')
      .filter(rendered)
      .map(button => {
        const text = textOf(button);
        const icons = iconText(button);
        let score = 0;
        if (/add_2/.test(icons)) score += 500;
        if (/^Tạo$|^Create$/i.test(text)) score += 100;
        const rect = button.getBoundingClientRect();
        if (rect.top > innerHeight * 0.45) score += 80;
        return { button, score, text, icons };
      })
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.score >= 400 ? candidates[0].button : null;
  }

  function findAddToPromptButton() {
    return queryAll('button')
      .filter(rendered)
      .find(button => /Thêm vào câu lệnh|Add to prompt/i.test(textOf(button))) || null;
  }

  function findAssetDialog() {
    const addButton = findAddToPromptButton();
    if (addButton) {
      let node = addButton.parentElement;
      for (let depth = 0; depth < 12 && node; depth += 1, node = node.parentElement) {
        if (node.querySelectorAll?.('[role="option"]').length) return node;
      }
    }

    return queryAll('[role="dialog"], [data-radix-popper-content-wrapper], [data-viewport-type="element"]')
      .filter(rendered)
      .find(el => el.querySelector?.('[role="option"]')) || null;
  }

  async function openAssetPicker() {
    const current = findAssetDialog();
    if (current) return current;
    const button = findAddButton();
    if (!button) throw new Error('Không tìm thấy nút dấu + add_2');
    await clickElement(button, 'nút dấu + add_2');
    const dialog = await waitFor(findAssetDialog, 7000, 'dialog chọn asset');
    mark(dialog, '#22c55e', 4000);
    log('Đã mở dialog asset.');
    return dialog;
  }

  function selectedUuid() {
    return state.selectedMediaKey?.startsWith('media:')
      ? state.selectedMediaKey.slice(6)
      : null;
  }

  function findTargetOption(dialog) {
    const uuid = selectedUuid();
    const options = [...dialog.querySelectorAll('[role="option"]')].filter(rendered);
    if (uuid) {
      const exact = options.find(option => [...option.querySelectorAll('img')]
        .some(img => mediaUuid(img.currentSrc || img.src || img.getAttribute('src')) === uuid));
      if (exact) return exact;
    }

    const imageOptions = options.filter(option => /Hình ảnh|Image/i.test(textOf(option)));
    return imageOptions[imageOptions.length - 1] || null;
  }

  async function selectGeneratedImageAndAttach() {
    if (!state.selectedMediaKey) {
      throw new Error('Chưa có mediaKey. Chạy waitImage() hoặc pickMediaUuid(uuid).');
    }

    const dialog = findAssetDialog() || await openAssetPicker();
    let option = await waitFor(() => findTargetOption(dialog), 7000, 'ảnh đúng UUID');
    mark(option, '#f59e0b', 10000);
    if (!isSelected(option)) {
      await clickElement(option, 'ảnh đúng UUID');
      await waitFor(() => {
        option = findTargetOption(dialog) || option;
        return isSelected(option);
      }, 5000, 'ảnh aria-selected=true');
    }
    mark(option, '#22c55e', 5000);

    const addButton = await waitFor(findAddToPromptButton, 5000, 'nút Thêm vào câu lệnh');
    await clickElement(addButton, 'Thêm vào câu lệnh');
    await waitFor(() => !findAssetDialog(), 7000, 'dialog đóng');

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
    const trigger = findSettingsTrigger();
    const result = {
      version: VERSION,
      settingsTriggerFound: !!trigger,
      settingsTriggerText: textOf(trigger),
      settingsTriggerIcons: iconText(trigger),
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
    state.debug = [];
    return { ok: true };
  }

  window.FlowSettingsAssetTest = Object.freeze({
    version: VERSION,
    scan,
    scanSettingsCandidates,
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
  log('Debug trigger: FlowSettingsAssetTest.scanSettingsCandidates()');
  log('Ảnh: configureImage() -> baseline() -> FlowTrustedTest nhập/submit -> waitImage().');
  log('Video: prepareVideoAsset() -> FlowTrustedTest nhập/submit video prompt.');
})();