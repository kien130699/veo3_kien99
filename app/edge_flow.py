from __future__ import annotations

import asyncio
import base64
import re
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse

import httpx
from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

from .compositor import create_mock_image, create_mock_video
from .config import settings
from .models import EdgeStatus, GenerationOptions


class FlowAutomationError(RuntimeError):
    pass


class FlowBlockedError(FlowAutomationError):
    """Raised when Flow shows CAPTCHA, unusual activity, or an account/risk block."""


class FlowSelectorError(FlowAutomationError):
    pass


LogFn = Callable[[str, str, dict[str, Any] | None], Awaitable[None]]

_BLOCK_MARKERS = (
    "unusual activity",
    "public_error_unusual_activity",
    "verify you're human",
    "verify you are human",
    "recaptcha",
    "captcha",
    "too many requests",
    "rate limit",
)

PROMPT_SELECTORS = (
    '[contenteditable="true"]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
)

SETTINGS_TRIGGER_SELECTORS = (
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_16_9'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_9_16'))",
    "button[aria-haspopup='menu']:has(i.google-symbols:text('crop_square'))",
    "button[aria-haspopup='menu']:has(i:text('tune'))",
    "button[aria-haspopup='menu']",
)

SUBMIT_ICON_NAMES = ("arrow_forward", "send", "auto_awesome", "movie_creation")


class EdgeFlowDriver:
    def __init__(self, options: GenerationOptions, job_dir: Path, log: LogFn) -> None:
        self.options = options
        self.job_dir = job_dir
        self.log = log
        self.playwright: Playwright | None = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self._media_urls: list[tuple[str, str]] = []

    @staticmethod
    def validate_cdp_url(cdp_url: str) -> None:
        parsed = urlparse(cdp_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("For safety, CDP must be an http://127.0.0.1 or localhost URL")
        if parsed.port is None:
            raise ValueError("CDP URL must include a port")

    @staticmethod
    async def status(cdp_url: str) -> EdgeStatus:
        try:
            EdgeFlowDriver.validate_cdp_url(cdp_url)
        except ValueError as exc:
            return EdgeStatus(reachable=False, cdp_url=cdp_url, error=str(exc))
        try:
            async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
                response = await client.get(f"{cdp_url.rstrip('/')}/json/version")
                response.raise_for_status()
                data = response.json()
                pages_response = await client.get(f"{cdp_url.rstrip('/')}/json/list")
                pages = pages_response.json() if pages_response.is_success else []
            urls = [str(item.get("url", "")) for item in pages if item.get("type") == "page"]
            return EdgeStatus(
                reachable=True,
                cdp_url=cdp_url,
                browser=data.get("Browser"),
                version=data.get("Protocol-Version"),
                flow_tab_open=any("labs.google/fx" in url for url in urls),
                pages=urls,
            )
        except Exception as exc:
            return EdgeStatus(reachable=False, cdp_url=cdp_url, error=str(exc))

    async def connect(self) -> None:
        if settings.mock_flow:
            await self.log("info", "Mock Flow enabled; Edge connection skipped", None)
            return
        self.validate_cdp_url(self.options.cdp_url)
        await self.log("info", f"Connecting to Edge CDP: {self.options.cdp_url}", None)
        self.playwright = await async_playwright().start()
        try:
            self.browser = await self.playwright.chromium.connect_over_cdp(self.options.cdp_url)
        except Exception:
            await self.playwright.stop()
            self.playwright = None
            raise
        contexts = self.browser.contexts
        if not contexts:
            raise FlowAutomationError("Edge CDP connected but no browser context was found")
        self.context = contexts[0]
        self.page = await self._find_or_open_flow_page()
        self.page.on("response", self._on_response)
        await self.page.bring_to_front()
        await self._ensure_editor()
        await self._assert_not_blocked()
        await self.log("success", "Connected to Google Flow in Edge 9223", {"url": self.page.url})

    async def disconnect(self) -> None:
        self.page = None
        self.context = None
        self.browser = None
        if self.playwright:
            await self.playwright.stop()
        self.playwright = None

    async def _find_or_open_flow_page(self) -> Page:
        assert self.context is not None
        for page in self.context.pages:
            if "labs.google/fx" in page.url and "/flow" in page.url:
                return page
        page = await self.context.new_page()
        await page.goto(self.options.flow_url, wait_until="domcontentloaded", timeout=120_000)
        return page

    def _on_response(self, response) -> None:
        try:
            content_type = (response.headers or {}).get("content-type", "").lower()
            url = response.url
            if "video/" in content_type or re.search(r"\.(mp4|webm)(?:\?|$)", url, re.I):
                self._media_urls.append(("video", url))
            elif "image/" in content_type or re.search(r"\.(png|jpe?g|webp)(?:\?|$)", url, re.I):
                self._media_urls.append(("image", url))
            if len(self._media_urls) > 300:
                self._media_urls = self._media_urls[-300:]
        except Exception:
            return

    async def _assert_not_blocked(self) -> None:
        if settings.mock_flow or not self.page:
            return
        try:
            text = (await self.page.locator("body").inner_text(timeout=4_000)).lower()
        except Exception:
            return
        marker = next((item for item in _BLOCK_MARKERS if item in text), None)
        if marker:
            raise FlowBlockedError(
                f"Google Flow displayed a risk/CAPTCHA block ({marker}). "
                "Automation stopped without attempting to bypass it."
            )

    async def _ensure_editor(self) -> None:
        assert self.page is not None
        for _ in range(3):
            if await self._find_prompt_input(required=False):
                return
            candidates = (
                self.page.get_by_role("button", name=re.compile(r"start project|new project|create project", re.I)),
                self.page.get_by_text(re.compile(r"start project|new project|create project", re.I)),
            )
            clicked = False
            for locator in candidates:
                try:
                    if await locator.first.is_visible(timeout=1_500):
                        await locator.first.click()
                        clicked = True
                        await self.page.wait_for_timeout(2_500)
                        break
                except Exception:
                    continue
            if not clicked:
                await self.page.wait_for_timeout(2_000)
        if not await self._find_prompt_input(required=False):
            raise FlowSelectorError(
                "Could not find the Flow prompt editor. Open a Flow project in Edge, then retry."
            )

    async def _find_prompt_input(self, required: bool = True):
        assert self.page is not None
        for selector in PROMPT_SELECTORS:
            locator = self.page.locator(selector)
            count = await locator.count()
            for index in range(count):
                item = locator.nth(index)
                try:
                    if await item.is_visible() and await item.is_enabled():
                        box = await item.bounding_box()
                        if box and box["width"] > 180 and box["height"] > 20:
                            return item
                except Exception:
                    continue
        if required:
            raise FlowSelectorError("Prompt input was not found; Flow UI may have changed")
        return None

    async def _open_settings(self) -> bool:
        assert self.page is not None
        for selector in SETTINGS_TRIGGER_SELECTORS:
            loc = self.page.locator(selector)
            count = await loc.count()
            for index in range(count):
                item = loc.nth(index)
                try:
                    if not await item.is_visible():
                        continue
                    box = await item.bounding_box()
                    if box and box["y"] > (await self.page.evaluate("window.innerHeight")) * 0.55:
                        await item.click()
                        await self.page.wait_for_timeout(500)
                        return True
                except Exception:
                    continue
        return False

    async def _click_text_option(self, texts: list[str], exact: bool = False) -> bool:
        assert self.page is not None
        for text in texts:
            candidates = [
                self.page.get_by_role("tab", name=re.compile(f"^{re.escape(text)}$" if exact else re.escape(text), re.I)),
                self.page.get_by_role("menuitem", name=re.compile(re.escape(text), re.I)),
                self.page.get_by_role("option", name=re.compile(re.escape(text), re.I)),
                self.page.get_by_text(re.compile(f"^{re.escape(text)}$" if exact else re.escape(text), re.I)),
            ]
            for locator in candidates:
                try:
                    if await locator.first.is_visible(timeout=600):
                        await locator.first.click()
                        await self.page.wait_for_timeout(350)
                        return True
                except Exception:
                    continue
        return False

    async def _configure(self, mode: str, duration: int | None = None) -> None:
        assert self.page is not None
        if not await self._open_settings():
            await self.log("warning", "Generation settings button not found; using current Flow settings", None)
            return
        await self._click_text_option([mode], exact=True)
        await self._click_text_option([self.options.aspect], exact=True)
        if mode.lower() == "video":
            await self._click_text_option([self.options.video_model, self.options.video_model.replace("3.1", "3")])
            if duration:
                await self._click_text_option([f"{duration}s", str(duration)], exact=True)
        else:
            await self._click_text_option([self.options.image_model])
        await self._click_text_option([f"x{self.options.output_count}"], exact=True)
        await self.page.keyboard.press("Escape")
        await self.page.wait_for_timeout(300)

    async def _fill_prompt(self, prompt: str) -> None:
        assert self.page is not None
        editor = await self._find_prompt_input()
        await editor.click()
        try:
            await editor.fill("")
            await editor.fill(prompt)
        except Exception:
            await self.page.keyboard.press("Control+A")
            await self.page.keyboard.press("Backspace")
            await self.page.keyboard.type(prompt, delay=4)
        await self.page.wait_for_timeout(350)

    async def _upload_reference(self, image_path: Path) -> None:
        assert self.page is not None
        if not image_path.exists():
            raise FileNotFoundError(image_path)
        file_inputs = self.page.locator('input[type="file"]')
        for index in range(await file_inputs.count()):
            item = file_inputs.nth(index)
            try:
                await item.set_input_files(str(image_path))
                await self.page.wait_for_timeout(2_000)
                return
            except Exception:
                continue

        add_buttons = (
            self.page.locator("button:has(i.google-symbols:text('add'))"),
            self.page.get_by_role("button", name=re.compile(r"add|upload|reference|frame", re.I)),
        )
        for buttons in add_buttons:
            for index in range(await buttons.count()):
                button = buttons.nth(index)
                try:
                    if not await button.is_visible():
                        continue
                    async with self.page.expect_file_chooser(timeout=5_000) as chooser_info:
                        await button.click()
                    chooser = await chooser_info.value
                    await chooser.set_files(str(image_path))
                    await self.page.wait_for_timeout(2_500)
                    return
                except Exception:
                    continue
        raise FlowSelectorError("Could not find Flow's reference image upload control")

    async def _snapshot_media(self, kind: str) -> set[str]:
        assert self.page is not None
        tag = "video" if kind == "video" else "img"
        return set(
            await self.page.locator(tag).evaluate_all(
                "els => els.map(e => e.currentSrc || e.src || '').filter(Boolean)"
            )
        )

    async def _click_submit(self) -> None:
        assert self.page is not None
        viewport_h = await self.page.evaluate("window.innerHeight")
        buttons = self.page.locator("button")
        for _ in range(12):
            count = await buttons.count()
            for index in range(count):
                button = buttons.nth(index)
                try:
                    if not await button.is_visible() or not await button.is_enabled():
                        continue
                    box = await button.bounding_box()
                    if not box or box["y"] < viewport_h * 0.55:
                        continue
                    text = ((await button.inner_text()) or "").strip().lower()
                    aria = ((await button.get_attribute("aria-label")) or "").lower()
                    if any(icon in text for icon in SUBMIT_ICON_NAMES) or re.search(
                        r"generate|create|submit|send", f"{text} {aria}", re.I
                    ):
                        await button.click()
                        return
                except Exception:
                    continue
            await self.page.wait_for_timeout(500)
        raise FlowSelectorError("Generate/submit button was not found or remained disabled")

    async def _wait_for_new_media(self, kind: str, before: set[str], timeout_seconds: int):
        assert self.page is not None
        tag = "video" if kind == "video" else "img"
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        last_progress_log = 0.0
        while asyncio.get_running_loop().time() < deadline:
            await self._assert_not_blocked()
            items = self.page.locator(tag)
            count = await items.count()
            for index in range(count - 1, -1, -1):
                item = items.nth(index)
                try:
                    if not await item.is_visible():
                        continue
                    src = await item.evaluate("e => e.currentSrc || e.src || ''")
                    box = await item.bounding_box()
                    if src and src not in before and box and box["width"] >= 240 and box["height"] >= 120:
                        if kind == "video":
                            ready = await item.evaluate(
                                "e => (e.readyState || 0) >= 2 || Number.isFinite(e.duration)"
                            )
                            if not ready:
                                continue
                        return item, src
                except Exception:
                    continue
            now = asyncio.get_running_loop().time()
            if now - last_progress_log > 20:
                await self.log("info", f"Waiting for generated {kind}...", None)
                last_progress_log = now
            await self.page.wait_for_timeout(2_000)
        raise FlowAutomationError(f"Timed out after {timeout_seconds}s waiting for generated {kind}")

    async def _download_http_url(self, url: str, output_path: Path) -> bool:
        if not url.startswith("http"):
            return False
        assert self.context is not None
        cookies = await self.context.cookies([url])
        jar = httpx.Cookies()
        for cookie in cookies:
            jar.set(cookie["name"], cookie["value"], domain=cookie.get("domain"), path=cookie.get("path", "/"))
        try:
            async with httpx.AsyncClient(cookies=jar, timeout=180, follow_redirects=True, trust_env=False) as client:
                response = await client.get(url)
                response.raise_for_status()
                output_path.write_bytes(response.content)
            return output_path.stat().st_size > 0
        except Exception:
            return False

    async def _click_download_near(self, media, output_path: Path) -> bool:
        assert self.page is not None
        button_handle = await media.evaluate_handle(
            """e => {
                let node = e;
                for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
                  const buttons = [...node.querySelectorAll('button')];
                  const found = buttons.find(b => {
                    const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
                    return t.includes('download') || t.includes('file_download');
                  });
                  if (found) return found;
                }
                return null;
            }"""
        )
        try:
            element = button_handle.as_element()
            if not element:
                return False
            async with self.page.expect_download(timeout=15_000) as info:
                await element.click()
            download = await info.value
            await download.save_as(str(output_path))
            return output_path.exists() and output_path.stat().st_size > 0
        except Exception:
            return False
        finally:
            await button_handle.dispose()

    async def _save_via_page_fetch(self, src: str, output_path: Path) -> bool:
        assert self.page is not None
        try:
            result = await self.page.evaluate(
                """async ({src, maxBytes}) => {
                    const r = await fetch(src);
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const b = await r.blob();
                    if (b.size > maxBytes) return {tooLarge: true, size: b.size};
                    const buf = new Uint8Array(await b.arrayBuffer());
                    let binary = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < buf.length; i += chunk) {
                      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
                    }
                    return {data: btoa(binary), size: b.size, type: b.type};
                }""",
                {"src": src, "maxBytes": 120 * 1024 * 1024},
            )
            if not result or result.get("tooLarge") or not result.get("data"):
                return False
            output_path.write_bytes(base64.b64decode(result["data"]))
            return output_path.stat().st_size > 0
        except Exception:
            return False

    async def _save_media(self, kind: str, media, src: str, output_path: Path, response_mark: int) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if await self._download_http_url(src, output_path):
            return output_path
        for captured_kind, url in reversed(self._media_urls[response_mark:]):
            if captured_kind == kind and await self._download_http_url(url, output_path):
                return output_path
        if await self._click_download_near(media, output_path):
            return output_path
        if await self._save_via_page_fetch(src, output_path):
            return output_path
        raise FlowAutomationError(f"Generated {kind} was visible, but could not be downloaded")

    async def generate_image(self, prompt: str, output_path: Path) -> Path:
        if settings.mock_flow:
            await self.log("info", "Mock image generation", {"prompt": prompt[:120]})
            return await create_mock_image(output_path)
        assert self.page is not None
        await self._ensure_editor()
        await self._assert_not_blocked()
        before = await self._snapshot_media("image")
        mark = len(self._media_urls)
        await self._configure("Image")
        await self._fill_prompt(prompt)
        await self._click_submit()
        await self.log("info", "Image prompt submitted through Flow UI", None)
        media, src = await self._wait_for_new_media("image", before, settings.flow_timeout_seconds)
        saved = await self._save_media("image", media, src, output_path, mark)
        await self.log("success", "Image downloaded", {"path": str(saved)})
        return saved

    async def generate_video(
        self,
        prompt: str,
        duration: int,
        output_path: Path,
        reference_image: Path | None = None,
    ) -> Path:
        if settings.mock_flow:
            await self.log(
                "info",
                "Mock video generation",
                {"prompt": prompt[:120], "duration": duration, "reference": str(reference_image or "")},
            )
            return await create_mock_video(output_path, duration, self.options.aspect)
        assert self.page is not None
        await self._ensure_editor()
        await self._assert_not_blocked()
        before = await self._snapshot_media("video")
        mark = len(self._media_urls)
        await self._configure("Video", duration=duration)
        if reference_image:
            await self._upload_reference(reference_image)
        await self._fill_prompt(prompt)
        await self._click_submit()
        await self.log(
            "info",
            "Video prompt submitted through Flow UI",
            {"duration": duration, "mode": "i2v" if reference_image else "t2v"},
        )
        media, src = await self._wait_for_new_media("video", before, settings.flow_timeout_seconds)
        saved = await self._save_media("video", media, src, output_path, mark)
        await self.log("success", "Video clip downloaded", {"path": str(saved)})
        return saved
