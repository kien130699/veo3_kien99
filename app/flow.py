from __future__ import annotations

import asyncio
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from playwright.async_api import Browser, BrowserContext, Locator, Page, Playwright, async_playwright

from .config import Settings

Mode = Literal["current", "image", "video"]


class FlowError(RuntimeError):
    pass


class FlowConnectionError(FlowError):
    pass


class FlowSelectorError(FlowError):
    pass


@dataclass(slots=True)
class ButtonInfo:
    index: int
    text: str
    enabled: bool
    score: float


EDITOR_SELECTORS = (
    '[data-slate-editor="true"][contenteditable="true"]',
    '[data-slate-editor="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-placeholder]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
)
PROJECT_LABEL = re.compile(r"new project|create project|start project|dự án mới|tạo dự án|novo projeto|nuevo proyecto", re.I)
SUBMIT_LABEL = re.compile(r"arrow_forward|generate|create|submit|send|tạo|gerar|criar|crear", re.I)
AVOID_BUTTON = re.compile(r"download|upload|delete|close|back|settings|tune|more_vert|dự án mới|new project", re.I)
MODE_NAMES = {
    "image": re.compile(r"^(image|ảnh|imagem|imagen)$", re.I),
    "video": re.compile(r"^(video|vídeo)$", re.I),
}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


class FlowController:
    """Minimal Google Flow UI controller over an existing Edge CDP session."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    async def _connect(self) -> Page:
        if self._page and not self._page.is_closed():
            return self._page
        try:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.connect_over_cdp(
                self.settings.cdp_url, timeout=self.settings.operation_timeout_ms
            )
        except Exception as exc:
            await self._disconnect()
            raise FlowConnectionError(
                f"Không kết nối được Edge CDP tại {self.settings.cdp_url}. Hãy chạy START_EDGE_9223.bat trước."
            ) from exc
        if not self._browser.contexts:
            await self._disconnect()
            raise FlowConnectionError("Edge CDP không có browser context khả dụng")
        self._context = self._browser.contexts[0]
        pages = [page for page in self._context.pages if not page.is_closed()]
        flow_pages = [page for page in pages if "labs.google" in page.url and ("flow" in page.url or "/fx/" in page.url)]
        if flow_pages:
            self._page = flow_pages[-1]
        elif pages:
            self._page = pages[-1]
            await self._page.goto(self.settings.flow_url, wait_until="domcontentloaded", timeout=self.settings.operation_timeout_ms)
        else:
            self._page = await self._context.new_page()
            await self._page.goto(self.settings.flow_url, wait_until="domcontentloaded", timeout=self.settings.operation_timeout_ms)
        await self._page.bring_to_front()
        return self._page

    async def _disconnect(self) -> None:
        self._page = None
        self._context = None
        self._browser = None
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
            self._playwright = None

    async def close(self) -> None:
        await self._disconnect()

    async def _visible(self, locator: Locator) -> bool:
        try:
            return await locator.is_visible()
        except Exception:
            return False

    async def _find_editor(self, required: bool = True) -> Locator | None:
        page = await self._connect()
        for selector in EDITOR_SELECTORS:
            locator = page.locator(selector)
            count = min(await locator.count(), 20)
            for index in range(count):
                item = locator.nth(index)
                if not await self._visible(item):
                    continue
                box = await item.bounding_box()
                if box and box["width"] >= 180 and box["height"] >= 20:
                    return item
        if required:
            raise FlowSelectorError("Không tìm thấy ô prompt Flow. Hãy mở một project Flow hoặc dùng nút Quét Flow để kiểm tra trang hiện tại.")
        return None

    async def _element_text(self, locator: Locator) -> str:
        try:
            return normalize_text(await locator.evaluate("""el => [el.innerText || '', el.textContent || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.getAttribute('placeholder') || ''].join(' ')"""))
        except Exception:
            return ""

    async def _find_project_button(self) -> Locator | None:
        page = await self._connect()
        controls = page.locator('button:visible, [role="button"]:visible')
        count = min(await controls.count(), 250)
        best = None
        for index in range(count):
            item = controls.nth(index)
            text = (await self._element_text(item)).lower()
            score = 0.0
            if PROJECT_LABEL.search(text):
                score += 200
            if re.search(r"(^|\s)add(_2)?($|\s)|add_circle", text, re.I):
                score += 100
            if score == 0:
                continue
            box = await item.bounding_box()
            if box and box["width"] > 50 and box["height"] > 20:
                score += box["width"] / 50
            if best is None or score > best[0]:
                best = (score, item)
        return best[1] if best else None

    async def _ensure_project(self, create_if_needed: bool) -> tuple[Locator, bool]:
        editor = await self._find_editor(required=False)
        if editor is not None:
            return editor, False
        if not create_if_needed:
            raise FlowSelectorError("Flow đang ở trang danh sách dự án. Hãy mở một project rồi thử lại.")
        button = await self._find_project_button()
        if button is None:
            raise FlowSelectorError("Không tìm thấy ô prompt hoặc nút Dự án mới trên trang Flow hiện tại.")
        await button.scroll_into_view_if_needed()
        await button.click(timeout=self.settings.operation_timeout_ms)
        deadline = asyncio.get_running_loop().time() + 25
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.5)
            editor = await self._find_editor(required=False)
            if editor is not None:
                return editor, True
        raise FlowSelectorError("Đã bấm Dự án mới nhưng ô prompt chưa xuất hiện sau 25 giây.")

    async def _mode_controls(self) -> list[str]:
        page = await self._connect()
        locator = page.locator('[role="tab"]:visible, [role="menuitem"]:visible, [role="option"]:visible, [role="radio"]:visible')
        result = []
        count = min(await locator.count(), 120)
        for index in range(count):
            text = await self._element_text(locator.nth(index))
            if text and text not in result:
                result.append(text[:120])
        return result

    async def _switch_mode(self, mode: Mode, editor: Locator) -> bool:
        if mode == "current":
            return False
        page = await self._connect()
        pattern = MODE_NAMES[mode]

        async def find_exact() -> Locator | None:
            controls = page.locator('[role="tab"]:visible, [role="menuitem"]:visible, [role="option"]:visible, [role="radio"]:visible, button:visible')
            count = min(await controls.count(), 250)
            for index in range(count):
                item = controls.nth(index)
                text = (await self._element_text(item)).strip()
                if pattern.fullmatch(text):
                    return item
            return None

        target = await find_exact()
        if target is not None:
            await target.click()
            await page.wait_for_timeout(600)
            return True
        editor_box = await editor.bounding_box()
        triggers = page.locator('button[aria-haspopup="menu"]:visible')
        count = min(await triggers.count(), 80)
        best = None
        for index in range(count):
            item = triggers.nth(index)
            text = (await self._element_text(item)).lower()
            box = await item.bounding_box()
            score = 0.0
            if re.search(r"image|video|ảnh|crop_|tune|mode|loại", text, re.I):
                score += 120
            if box and editor_box:
                distance = abs((box["y"] + box["height"] / 2) - editor_box["y"])
                score += max(0, 80 - distance / 5)
            if best is None or score > best[0]:
                best = (score, item)
        if best and best[0] > 20:
            await best[1].click()
            await page.wait_for_timeout(500)
            target = await find_exact()
            if target is not None:
                await target.click()
                await page.wait_for_timeout(700)
                return True
        raise FlowSelectorError(f"Không tự chuyển được sang {mode}. Chọn chế độ {mode} thủ công trong Flow rồi dùng lựa chọn 'Chế độ hiện tại'.")

    async def _read_editor(self, editor: Locator) -> str:
        return normalize_text(await editor.evaluate("""el => { if ('value' in el) return String(el.value || ''); return String(el.innerText || el.textContent || ''); }"""))

    async def _type_prompt(self, editor: Locator, prompt: str) -> None:
        page = await self._connect()
        await editor.scroll_into_view_if_needed()
        await editor.click(force=True)
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Delete")
        await page.wait_for_timeout(120)
        try:
            await editor.press_sequentially(prompt, delay=6)
        except Exception:
            await page.keyboard.insert_text(prompt)
        await page.wait_for_timeout(450)
        actual = await self._read_editor(editor)
        expected = normalize_text(prompt)
        if expected not in actual and actual not in expected:
            await editor.click(force=True)
            await page.keyboard.press("Control+A")
            await page.keyboard.press("Delete")
            await page.keyboard.insert_text(prompt)
            await page.wait_for_timeout(450)
            actual = await self._read_editor(editor)
        if expected not in actual and actual not in expected:
            raise FlowSelectorError("Đã tìm thấy ô prompt nhưng Flow không giữ nội dung nhập bằng CDP. Hãy click ô prompt một lần rồi thử lại.")

    async def _find_submit(self, editor: Locator):
        page = await self._connect()
        editor_box = await editor.bounding_box()
        buttons = page.locator("button:visible")
        count = min(await buttons.count(), 300)
        best = None
        for index in range(count):
            button = buttons.nth(index)
            text = (await self._element_text(button)).lower()
            if AVOID_BUTTON.search(text):
                continue
            box = await button.bounding_box()
            if not box:
                continue
            score = 0.0
            if re.search(r"arrow_forward", text, re.I):
                score += 260
            if SUBMIT_LABEL.search(text):
                score += 170
            if editor_box:
                dx = abs((box["x"] + box["width"] / 2) - (editor_box["x"] + editor_box["width"]))
                dy = abs((box["y"] + box["height"] / 2) - (editor_box["y"] + editor_box["height"] / 2))
                score += max(0, 140 - (dx + dy) / 6)
            if score < 120:
                continue
            enabled = not await button.is_disabled()
            aria_disabled = await button.get_attribute("aria-disabled")
            enabled = enabled and aria_disabled != "true"
            info = ButtonInfo(index=index, text=text, enabled=enabled, score=score)
            if best is None or score > best[0]:
                best = (score, button, info)
        if best is None:
            return None, None
        return best[1], best[2]

    async def _wait_submit_enabled(self, editor: Locator, timeout_ms: int = 10000):
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        last_info = None
        while asyncio.get_running_loop().time() < deadline:
            button, info = await self._find_submit(editor)
            if button is not None and info is not None:
                last_info = info
                if info.enabled:
                    return button, info
            await asyncio.sleep(0.25)
        if last_info is not None:
            raise FlowSelectorError(f"Đã tìm thấy nút Tạo nhưng nút đang bị khóa: {last_info.text}")
        raise FlowSelectorError("Không tìm thấy nút Tạo gần ô prompt")

    async def _submission_signal(self, editor: Locator, button: Locator, before_url: str, before_media: int):
        page = await self._connect()
        deadline = asyncio.get_running_loop().time() + self.settings.submit_observe_ms / 1000
        while asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.4)
            try:
                if page.url != before_url:
                    return "url_changed"
                if not await button.is_enabled():
                    return "submit_disabled"
                if not await self._read_editor(editor):
                    return "prompt_cleared"
                if await page.locator("img,video").count() > before_media:
                    return "media_added"
                body = normalize_text(await page.locator("body").inner_text()).lower()
                if re.search(r"generating|creating|processing|queued|đang tạo|đang xử lý|hàng đợi", body, re.I):
                    return "generating_text"
            except Exception:
                return "page_changed"
        return None

    async def _screenshot(self, label: str):
        page = await self._connect()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        path = self.settings.screenshot_dir / f"{stamp}_{label}.png"
        try:
            await page.screenshot(path=str(path), full_page=False)
            return str(path).replace("\\", "/")
        except Exception:
            return None

    def _log(self, event: str, payload: dict[str, Any]) -> None:
        stamp = datetime.now(timezone.utc)
        path = self.settings.log_dir / f"{stamp:%Y-%m-%d}.jsonl"
        record = {"timestamp": stamp.isoformat(), "event": event, **payload}
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    async def scan(self):
        async with self._lock:
            page = await self._connect()
            editor = await self._find_editor(required=False)
            project = await self._find_project_button() if editor is None else None
            submit, info = await self._find_submit(editor) if editor is not None else (None, None)
            screenshot = await self._screenshot("scan")
            result = {
                "ok": True, "connected": True, "page_url": page.url,
                "page_title": await page.title(), "editor_found": editor is not None,
                "project_button_found": project is not None, "submit_found": submit is not None,
                "submit_enabled": bool(info and info.enabled), "submit_text": info.text if info else None,
                "mode_controls": await self._mode_controls(), "screenshot": screenshot,
                "message": "Đã tìm thấy ô prompt Flow" if editor is not None else "Flow đang ở gallery hoặc chưa mở project",
            }
            self._log("scan", result)
            return result

    async def generate(self, prompt: str, mode: Mode, create_project_if_needed: bool):
        async with self._lock:
            project_opened = False
            mode_switched = False
            try:
                page = await self._connect()
                editor, project_opened = await self._ensure_project(create_project_if_needed)
                mode_switched = await self._switch_mode(mode, editor)
                editor = await self._find_editor(required=True)
                await self._type_prompt(editor, prompt)
                button, info = await self._wait_submit_enabled(editor)
                before_url = page.url
                before_media = await page.locator("img,video").count()
                before_shot = await self._screenshot("before_submit")
                await button.scroll_into_view_if_needed()
                await button.click(timeout=self.settings.operation_timeout_ms)
                signal = await self._submission_signal(editor, button, before_url, before_media)
                after_shot = await self._screenshot("after_submit")
                result = {
                    "ok": True, "mode": mode, "page_url": page.url, "prompt_length": len(prompt),
                    "project_opened": project_opened, "mode_switched": mode_switched,
                    "editor_verified": True, "submit_clicked": True, "submit_signal": signal,
                    "screenshot": after_shot or before_shot,
                    "message": f"Đã gửi prompt; tín hiệu: {signal}" if signal else "Đã click Tạo bằng CDP nhưng chưa thấy tín hiệu UI trong thời gian chờ",
                }
                self._log("generate", {**result, "prompt_preview": prompt[:200], "submit_button": asdict(info)})
                return result
            except FlowError as exc:
                screenshot = None
                try:
                    screenshot = await self._screenshot("error")
                except Exception:
                    pass
                self._log("generate_error", {"mode": mode, "prompt_preview": prompt[:200], "error": str(exc), "screenshot": screenshot})
                raise


class MockFlowController:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def close(self) -> None:
        return None

    async def scan(self):
        return {"ok": True, "connected": True, "page_url": "https://labs.google/fx/vi/tools/flow/mock", "page_title": "Google Flow Mock", "editor_found": True, "project_button_found": False, "submit_found": True, "submit_enabled": True, "submit_text": "arrow_forward Tạo", "mode_controls": ["Ảnh", "Video"], "screenshot": None, "message": "Mock Flow sẵn sàng"}

    async def generate(self, prompt: str, mode: Mode, create_project_if_needed: bool):
        await asyncio.sleep(0.05)
        return {"ok": True, "mode": mode, "page_url": "https://labs.google/fx/vi/tools/flow/mock", "prompt_length": len(prompt), "project_opened": False, "mode_switched": mode != "current", "editor_verified": True, "submit_clicked": True, "submit_signal": "mock_submitted", "screenshot": None, "message": "Mock prompt submitted"}
