/*
 * FlowSettingsAssetTrustedStepper v2.4.0
 *
 * Console test for the live Vietnamese Google Flow UI.
 * Every Radix/React-sensitive action waits for a REAL user click
 * (event.isTrusted === true). The script only finds, highlights and verifies.
 *
 * Flow:
 *   settings trigger -> Video -> Components/Frames -> aspect -> model -> x1
 *   -> close settings -> add_2 -> exact image UUID -> Add to prompt.
 *
 * No sc-* class dependency. No private API calls.
 */
(() => {
  'use strict';

  const VERSION = '2.4.0';
  const state = {
    selectedMediaKey: null,
    settingsTrigger: null,
    running: false,
    lastStep: null,
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const log = (...args) => console.log(
    '%c[FlowTrustedStepper]',
    'color:#8b5cf6;font-weight:bold',
    ...args,
  );
  const warn = (...args) => console.warn('[FlowTrustedStepper]', ...args);

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
    ].filter(Boolean).join(' '));
  }

  function iconText(el) {
    if (!(el instanceof Element)) return '';
    return norm([...el.querySelectorAll('i.google-symbols, i')]
      .map(icon => icon.textContent || '')
      .join(' '));
  }

  function mark(el, color = '#8b5cf6', duration = 60000) {
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

  function eventHits(event, target) {
    if (!(target instanceof Element)) return false;
    const path = event.composedPath?.() || [];
    return path.includes(target) || target.contains(event.target);
  }

  function waitTrustedClick(targetGetter, timeoutMs, description, color = '#f59e0b') {
    return new Promise((resolve, reject) => {
      let target = targetGetter();
      if (!(target instanceof HTMLElement)) {
        reject(new Error(`Không tìm thấy ${description}`));
        return;
      }

      mark(target, color, timeoutMs + 3000);
      state.lastStep = description;
      log(`CLICK THẬT: ${description} (viền cam).`);

      let settled = false;
      const cleanup = () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('click', onClick, true);
        clearTimeout(timer);
      };

      const onPointerDown = event => {
        target = targetGetter() || target;
        if (!eventHits(event, target)) return;
        log('pointerdown', { description, trusted: event.isTrusted });
      };

      const onClick = event => {
        target = targetGetter() || target;
        if (!eventHits(event, target)) return;
        if (!event.isTrusted) {
          warn(`Click giả vào ${description}; bỏ qua.`);
          return;
        }
        settled = true;
        cleanup();
        mark(target, '#22c55e', 2500);
        resolve({ target, event });
      };

      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('click', onClick, true);

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`Hết thời gian chờ click thật: ${description}`));
      }, timeoutMs);
    });
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
        if (/\bx[1-4]\b/i.test(text)) {
          score += 220;
          reasons.push('output-count');
        }
        if (/Nano Banana|Veo\s*3/i.test(text)) {
          score += 120;
          reasons.push('current-model');
        }
        if (/arrow_drop_down/.test(icons) && !/crop_/.test(icons)) {
          score -= 350;
          reasons.push('model-dropdown-penalty');
        }
        if (/more_vert|filter_list|settings_2/.test(icons)) {
          score -= 300;
          reasons.push('toolbar-penalty');
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
    const candidate = settingsTriggerCandidates()[0];
    return candidate?.score >= 500 ? candidate.button : null;
  }

  function scanSettingsCandidates() {
    const rows = settingsTriggerCandidates().map(({ button, ...rest }) => rest);
    console.table(rows);
    return { version: VERSION, found: !!findSettingsTrigger(), candidates: rows };
  }

  function menuHasModeTabs(menu) {
    if (!(menu instanceof Element)) return false;
    const tabs = [...menu.querySelectorAll('[role="tab"]')];
    const controls = tabs.map(tab => tab.getAttribute('aria-controls') || '');
    return controls.some(value => /-content-IMAGE$/.test(value))
      && controls.some(value => /-content-VIDEO$/.test(value));
  }

  function findSettingsMenu() {
    const trigger = state.settingsTrigger || findSettingsTrigger();
    const triggerId = trigger?.id || '';

    const menus = queryAll('[role="menu"], [data-radix-menu-content]')
      .filter(rendered)
      .filter(menu => menu.getAttribute('data-state') !== 'closed');

    if (triggerId) {
      const linked = menus.find(menu => menu.getAttribute('aria-labelledby') === triggerId);
      if (linked) return linked;
    }

    const byTabs = menus.find(menuHasModeTabs);
    if (byTabs) return byTabs;

    const wrappers = queryAll('[data-radix-popper-content-wrapper]')
      .filter(rendered);
    return wrappers.find(wrapper => menuHasModeTabs(wrapper)) || null;
  }

  async function ensureSettingsOpen(timeoutMs = 60000) {
    const already = findSettingsMenu();
    if (already) return already;

    let trigger = findSettingsTrigger();
    if (!trigger) {
      const diagnostics = scanSettingsCandidates();
      throw new Error(`Không tìm thấy settings trigger: ${JSON.stringify(diagnostics.candidates)}`);
    }
    state.settingsTrigger = trigger;

    if (trigger.getAttribute('aria-expanded') === 'true') {
      const menu = await waitFor(findSettingsMenu, 2500, 'menu đang mở theo aria-expanded');
      return menu;
    }

    await waitTrustedClick(
      () => findSettingsTrigger(),
      timeoutMs,
      'nút cấu hình Nano Banana/Veo + tỷ lệ + xN',
    );

    return waitFor(findSettingsMenu, 7000, 'menu cấu hình mở');
  }

  function exactTab(suffix, fallbackRegex = null) {
    const menu = findSettingsMenu();
    if (!menu) return null;
    const tabs = [...menu.querySelectorAll('[role="tab"]')].filter(rendered);
    return tabs.find(tab => (
      tab.getAttribute('aria-controls') || ''
    ).endsWith(`-content-${suffix}`))
      || (fallbackRegex ? tabs.find(tab => fallbackRegex.test(textOf(tab))) : null)
      || null;
  }

  async function chooseTabTrusted(suffix, description, fallbackRegex, timeoutMs) {
    await ensureSettingsOpen(timeoutMs);
    let tab = exactTab(suffix, fallbackRegex);
    if (!tab) throw new Error(`Không tìm thấy tab ${description}`);
    if (isSelected(tab)) {
      log('Đã active sẵn:', description);
      return tab;
    }

    await waitTrustedClick(
      () => exactTab(suffix, fallbackRegex),
      timeoutMs,
      `tab ${description}`,
    );

    await waitFor(() => {
      tab = exactTab(suffix, fallbackRegex) || tab;
      return isSelected(tab) ? tab : null;
    }, 5000, `${description} active`);
    return tab;
  }

  const ASPECT = {
    '16:9': 'LANDSCAPE',
    '9:16': 'PORTRAIT',
    '4:3': 'LANDSCAPE_4_3',
    '3:4': 'PORTRAIT_3_4',
    '1:1': 'SQUARE',
  };

  function findModelTrigger(mode) {
    const menu = findSettingsMenu();
    if (!menu) return null;
    const regex = mode === 'video' ? /Veo/i : /Nano Banana/i;
    return [...menu.querySelectorAll('button[aria-haspopup="menu"]')]
      .filter(rendered)
      .find(button => regex.test(textOf(button))) || null;
  }

  function findModelOption(modelName) {
    return queryAll('[role="menuitem"], [role="option"], button')
      .filter(rendered)
      .find(el => textOf(el).toLowerCase().includes(modelName.toLowerCase())) || null;
  }

  async function chooseModelTrusted(mode, modelName, timeoutMs) {
    await ensureSettingsOpen(timeoutMs);
    let trigger = findModelTrigger(mode);
    if (!trigger) throw new Error(`Không tìm thấy dropdown model ${mode}`);
    if (textOf(trigger).toLowerCase().includes(modelName.toLowerCase())) {
      log('Model đã đúng sẵn:', modelName);
      return trigger;
    }

    await waitTrustedClick(
      () => findModelTrigger(mode),
      timeoutMs,
      `dropdown model ${mode}`,
    );

    await waitFor(() => findModelOption(modelName), 7000, `option model ${modelName}`);
    await waitTrustedClick(
      () => findModelOption(modelName),
      timeoutMs,
      `model ${modelName}`,
    );

    await waitFor(() => {
      trigger = findModelTrigger(mode) || trigger;
      return textOf(trigger).toLowerCase().includes(modelName.toLowerCase())
        ? trigger
        : null;
    }, 7000, `model đổi sang ${modelName}`);
    return trigger;
  }

  async function closeSettingsTrusted(timeoutMs) {
    if (!findSettingsMenu()) return true;
    await waitTrustedClick(
      () => findSettingsTrigger(),
      timeoutMs,
      'nút cấu hình lần nữa để đóng menu',
    );
    await waitFor(() => !findSettingsMenu(), 5000, 'menu cấu hình đóng');
    return true;
  }

  function mediaUuid(src) {
    try { return new URL(src, location.href).searchParams.get('name'); }
    catch { return String(src || '').match(/[?&]name=([0-9a-fA-F-]+)/)?.[1] || null; }
  }

  function pickMediaUuid(uuid) {
    if (!uuid) throw new Error('UUID trống');
    state.selectedMediaKey = `media:${uuid}`;
    log('Đã khóa media UUID:', state.selectedMediaKey);
    return { ok: true, mediaKey: state.selectedMediaKey };
  }

  function selectedUuid() {
    return state.selectedMediaKey?.startsWith('media:')
      ? state.selectedMediaKey.slice(6)
      : null;
  }

  function findAddButton() {
    const candidates = queryAll('button[aria-haspopup="dialog"]')
      .filter(rendered)
      .map(button => {
        const icons = iconText(button);
        const text = textOf(button);
        let score = 0;
        if (/add_2/.test(icons)) score += 500;
        if (/^Tạo$|^Create$/i.test(text)) score += 100;
        return { button, score };
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

  function findTargetOption() {
    const dialog = findAssetDialog();
    if (!dialog) return null;
    const uuid = selectedUuid();
    const options = [...dialog.querySelectorAll('[role="option"]')].filter(rendered);
    if (uuid) {
      const exact = options.find(option => [...option.querySelectorAll('img')]
        .some(img => mediaUuid(img.currentSrc || img.src || img.getAttribute('src')) === uuid));
      if (exact) return exact;
    }
    const images = options.filter(option => /Hình ảnh|Image/i.test(textOf(option)));
    return images[images.length - 1] || null;
  }

  async function openAssetPickerTrusted(timeoutMs) {
    const current = findAssetDialog();
    if (current) return current;
    await waitTrustedClick(
      () => findAddButton(),
      timeoutMs,
      'dấu + add_2',
    );
    return waitFor(findAssetDialog, 7000, 'dialog chọn asset');
  }

  async function selectAssetAndAttachTrusted(timeoutMs) {
    if (!state.selectedMediaKey) {
      throw new Error('Chưa chọn media UUID. Chạy pickMediaUuid(uuid) trước.');
    }
    await openAssetPickerTrusted(timeoutMs);
    await waitFor(findTargetOption, 7000, `ảnh UUID ${selectedUuid()}`);

    let option = findTargetOption();
    if (!isSelected(option)) {
      await waitTrustedClick(
        () => findTargetOption(),
        timeoutMs,
        `ảnh UUID ${selectedUuid()}`,
      );
      await waitFor(() => {
        option = findTargetOption() || option;
        return isSelected(option) ? option : null;
      }, 5000, 'ảnh aria-selected=true');
    } else {
      log('Ảnh đã selected sẵn:', selectedUuid());
    }

    await waitFor(findAddToPromptButton, 5000, 'nút Thêm vào câu lệnh');
    await waitTrustedClick(
      () => findAddToPromptButton(),
      timeoutMs,
      'Thêm vào câu lệnh',
    );
    await waitFor(() => !findAssetDialog(), 7000, 'dialog asset đóng');

    return {
      ok: true,
      selectedMediaKey: state.selectedMediaKey,
      selectedUuid: selectedUuid(),
    };
  }

  async function configureVideoTrusted({
    sourceType = 'components',
    aspect = '16:9',
    model = 'Veo 3.1 - Fast',
    outputs = 1,
    timeoutMs = 60000,
  } = {}) {
    await ensureSettingsOpen(timeoutMs);
    await chooseTabTrusted('VIDEO', 'Video', /^Video$/i, timeoutMs);

    if (['components', 'references', 'Thành phần'].includes(sourceType)) {
      await chooseTabTrusted(
        'VIDEO_REFERENCES',
        'Thành phần',
        /^Thành phần$|^Components$/i,
        timeoutMs,
      );
    } else if (['frames', 'Khung hình'].includes(sourceType)) {
      await chooseTabTrusted(
        'VIDEO_FRAMES',
        'Khung hình',
        /^Khung hình$|^Frames$/i,
        timeoutMs,
      );
    } else {
      throw new Error(`sourceType không hỗ trợ: ${sourceType}`);
    }

    const aspectSuffix = ASPECT[aspect];
    if (!aspectSuffix) throw new Error(`Tỷ lệ không hỗ trợ: ${aspect}`);
    await chooseTabTrusted(
      aspectSuffix,
      `tỷ lệ ${aspect}`,
      new RegExp(`^${aspect.replace(':', '\\:')}$`),
      timeoutMs,
    );
    await chooseModelTrusted('video', model, timeoutMs);
    await chooseTabTrusted(
      String(Number(outputs)),
      `x${Number(outputs)}`,
      new RegExp(`^x${Number(outputs)}$`, 'i'),
      timeoutMs,
    );
    await closeSettingsTrusted(timeoutMs);

    return { ok: true, mode: 'video', sourceType, aspect, model, outputs };
  }

  async function prepareVideoAsset(options = {}) {
    if (state.running) throw new Error('Stepper đang chạy.');
    state.running = true;
    try {
      const timeoutMs = options.timeoutMs || 60000;
      const settings = await configureVideoTrusted(options);
      const asset = await selectAssetAndAttachTrusted(timeoutMs);
      const result = { ok: true, settings, asset };
      log('HOÀN TẤT cấu hình video + gắn ảnh:', result);
      return result;
    } finally {
      state.running = false;
    }
  }

  function scan() {
    const trigger = findSettingsTrigger();
    const result = {
      version: VERSION,
      running: state.running,
      lastStep: state.lastStep,
      settingsTriggerFound: !!trigger,
      settingsTriggerText: textOf(trigger),
      settingsTriggerIcons: iconText(trigger),
      triggerExpanded: trigger?.getAttribute('aria-expanded') || null,
      settingsMenuOpen: !!findSettingsMenu(),
      addButtonFound: !!findAddButton(),
      assetDialogOpen: !!findAssetDialog(),
      selectedMediaKey: state.selectedMediaKey,
      selectedUuid: selectedUuid(),
    };
    log('scan', result);
    return result;
  }

  function reset() {
    state.selectedMediaKey = null;
    state.settingsTrigger = null;
    state.running = false;
    state.lastStep = null;
    return { ok: true };
  }

  window.FlowSettingsTrustedStepper = Object.freeze({
    version: VERSION,
    scan,
    scanSettingsCandidates,
    reset,
    pickMediaUuid,
    ensureSettingsOpen,
    configureVideoTrusted,
    openAssetPickerTrusted,
    selectAssetAndAttachTrusted,
    prepareVideoAsset,
  });

  log(`Nạp xong v${VERSION}.`);
  log('Script KHÔNG click giả. Mỗi bước sẽ viền cam và chờ bạn click thật.');
  log('Dùng: pickMediaUuid(uuid) -> await prepareVideoAsset({...})');
})();