from __future__ import annotations

import re
import sys
from pathlib import Path


def replace_block(text: str, start_pattern: str, end_pattern: str, replacement: str) -> str:
    pattern = re.compile(
        rf"(?ms)^{start_pattern}.*?(?=^{end_pattern})"
    )
    updated, count = pattern.subn(replacement.rstrip() + "\n\n", text, count=1)
    if count != 1:
        raise RuntimeError(
            f"Không tìm thấy đúng block cần vá: {start_pattern} -> {end_pattern}"
        )
    return updated


def patch(source: Path, destination: Path) -> None:
    text = source.read_text(encoding="utf-8")

    visible_block = r'''    async def _visible_buttons(self, selector: str) -> List[Any]:
        """Return rendered elements, even when DevTools clips them outside viewport.

        Playwright locator.is_visible() was too strict for the Flow composer. The
        settings trigger can be rendered and clickable while partly outside the
        current viewport. This check matches the working Console tests.
        """
        loc = self.page.locator(selector)
        count = await loc.count()
        out = []
        for index in range(count):
            item = loc.nth(index)
            try:
                rendered = await item.evaluate(
                    """el => {
                        if (!el || !el.isConnected) return false;
                        const style = getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && Number(style.opacity || 1) !== 0
                            && rect.width > 2
                            && rect.height > 2;
                    }"""
                )
                if rendered:
                    out.append(item)
            except Exception as error:
                self.dbg(
                    "rendered check failed",
                    {"selector": selector, "index": index, "error": str(error)},
                )
        return out'''

    text = replace_block(
        text,
        r"    async def _visible_buttons\(self, selector: str\) -> List\[Any\]:",
        r"    async def _text\(self, loc\) -> str:",
        visible_block,
    )

    trigger_block = r'''    async def find_settings_trigger(self):
        buttons = await self._visible_buttons('button[aria-haspopup="menu"]')
        best = None
        best_score = -9999
        candidates = []

        for index, btn in enumerate(buttons):
            try:
                snapshot = await btn.evaluate(
                    """el => {
                        const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
                        const icons = norm(
                            [...el.querySelectorAll('i.google-symbols, i')]
                                .map(icon => icon.textContent || '')
                                .join(' ')
                        );
                        const text = norm([
                            el.innerText || '',
                            el.textContent || '',
                            el.getAttribute('aria-label') || '',
                            el.getAttribute('title') || ''
                        ].join(' '));
                        const rect = el.getBoundingClientRect();
                        return {
                            text,
                            icons,
                            expanded: el.getAttribute('aria-expanded'),
                            state: el.getAttribute('data-state'),
                            box: {
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height)
                            }
                        };
                    }"""
                )
            except Exception as error:
                self.dbg("settings candidate snapshot failed", str(error))
                continue

            text = norm(snapshot.get("text", ""))
            icons = norm(snapshot.get("icons", ""))
            score = 0
            reasons = []

            if re.search(
                r"crop_(16_9|9_16)|crop_landscape|crop_portrait|crop_square",
                icons,
                re.I,
            ):
                score += 500
                reasons.append("crop-icon")
            if re.search(r"\bx[1-4]\b", text, re.I):
                score += 220
                reasons.append("output-count")
            if re.search(r"Nano Banana|Veo\s*3", text, re.I):
                score += 120
                reasons.append("model-text")
            if re.search(r"\bHình ảnh\b|\bVideo\b|\bImage\b", text, re.I):
                score += 100
                reasons.append("mode-text")

            if re.search(r"more_vert|filter_list|settings_2", icons, re.I):
                score -= 400
                reasons.append("toolbar-penalty")
            if re.search(r"arrow_drop_down", icons, re.I) and not re.search(
                r"crop_", icons, re.I
            ):
                score -= 350
                reasons.append("model-dropdown-penalty")

            row = {
                "index": index,
                "score": score,
                "reasons": reasons,
                "text": text[:180],
                "icons": icons,
                "expanded": snapshot.get("expanded"),
                "state": snapshot.get("state"),
                "box": snapshot.get("box"),
            }
            candidates.append(row)

            if score > best_score:
                best_score = score
                best = btn

        candidates.sort(key=lambda item: item["score"], reverse=True)
        self.dbg("settings candidates", candidates)

        if best is None or best_score < 500:
            debug_dir = ensure_dir(Path(self.cfg.output_dir) / "debug")
            screenshot = debug_dir / f"{now_ts()}_settings_trigger_not_found.png"
            try:
                await self.page.screenshot(path=str(screenshot), full_page=True)
            except Exception as error:
                self.dbg("settings screenshot failed", str(error))
            raise RuntimeError(
                "Không tìm thấy nút cấu hình mode/aspect/model/xN. "
                f"Candidates={json.dumps(candidates, ensure_ascii=False)}; "
                f"screenshot={screenshot}"
            )

        self.dbg(
            "selected settings trigger",
            {"score": best_score, "candidate": candidates[0] if candidates else None},
        )
        return best'''

    text = replace_block(
        text,
        r"    async def find_settings_trigger\(self\):",
        r"    async def find_settings_menu\(self\):",
        trigger_block,
    )

    menu_block = r'''    async def find_settings_menu(self):
        menus = await self._visible_buttons('[role="menu"]')
        for menu in menus:
            try:
                data_state = (await menu.get_attribute("data-state")) or ""
                if data_state == "closed":
                    continue
                controls = await menu.locator('[role="tab"]').evaluate_all(
                    "tabs => tabs.map(tab => tab.getAttribute('aria-controls') || '')"
                )
                has_image = any(value.endswith("-content-IMAGE") for value in controls)
                has_video = any(value.endswith("-content-VIDEO") for value in controls)
                if has_image and has_video:
                    return menu
            except Exception as error:
                self.dbg("settings menu candidate failed", str(error))
        return None'''

    text = replace_block(
        text,
        r"    async def find_settings_menu\(self\):",
        r"    async def open_settings\(self\):",
        menu_block,
    )

    open_block = r'''    async def open_settings(self):
        menu = await self.find_settings_menu()
        if menu:
            return menu

        trigger = await self.find_settings_trigger()
        try:
            await trigger.scroll_into_view_if_needed(timeout=10000)
        except Exception as error:
            self.dbg("settings trigger scroll failed", str(error))

        click_error = None
        try:
            await trigger.click(timeout=15000)
        except Exception as error:
            click_error = error
            box = await self._bbox(trigger)
            if box:
                await self.page.mouse.move(
                    box["x"] + box["width"] / 2,
                    box["y"] + box["height"] / 2,
                )
                await self.page.mouse.click(
                    box["x"] + box["width"] / 2,
                    box["y"] + box["height"] / 2,
                )

        for _ in range(80):
            menu = await self.find_settings_menu()
            if menu:
                self.dbg("settings menu opened")
                return menu
            await asyncio.sleep(0.1)

        debug_dir = ensure_dir(Path(self.cfg.output_dir) / "debug")
        screenshot = debug_dir / f"{now_ts()}_settings_menu_not_open.png"
        try:
            await self.page.screenshot(path=str(screenshot), full_page=True)
        except Exception as error:
            self.dbg("settings menu screenshot failed", str(error))
        raise RuntimeError(
            "Đã tìm và click đúng nút cấu hình nhưng menu không mở. "
            f"click_error={click_error}; screenshot={screenshot}"
        )'''

    text = replace_block(
        text,
        r"    async def open_settings\(self\):",
        r"    async def close_settings\(self\):",
        open_block,
    )

    destination.write_text(text, encoding="utf-8")
    print(f"Đã tạo: {destination}")
    print("Chạy bằng:")
    print(
        f'  py -3.13 "{destination.name}" --input scenes.txt --output-dir flow_outputs'
    )


def main() -> None:
    source = Path(sys.argv[1] if len(sys.argv) >= 2 else "flow_auto_full_v27.py")
    destination = Path(
        sys.argv[2] if len(sys.argv) >= 3 else source.with_name("flow_auto_full_v28.py")
    )

    if not source.exists():
        raise SystemExit(f"Không tìm thấy file nguồn: {source}")

    patch(source, destination)


if __name__ == "__main__":
    main()
