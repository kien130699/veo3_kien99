from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path


def replace_block(
    text: str,
    start_pattern: str,
    end_pattern: str,
    replacement: str,
) -> str:
    pattern = re.compile(rf"(?ms)^{start_pattern}.*?(?=^{end_pattern})")
    replacement_text = replacement.rstrip() + "\n\n"
    updated, count = pattern.subn(
        lambda _match: replacement_text,
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError(
            f"Không tìm thấy đúng block cần vá: {start_pattern} -> {end_pattern}"
        )
    return updated


def insert_once(text: str, needle: str, replacement: str, label: str) -> str:
    if needle not in text:
        raise RuntimeError(f"Không tìm thấy vị trí chèn: {label}")
    return text.replace(needle, replacement, 1)


RECOVERY_AND_DETECT_BLOCK = r'''    # ---------- V33 workspace recovery ----------
    def _project_root_url(self, url: Optional[str] = None) -> Optional[str]:
        value = str(url or self.page.url or "")
        match = re.match(
            r"^(https://labs\.google/fx(?:/[a-z]{2})?/tools/flow/project/[^/?#]+)",
            value,
            re.I,
        )
        return match.group(1) if match else None

    async def _workspace_ready(self) -> bool:
        """True only on the project composer, not on a media /edit page."""
        try:
            return bool(await self.page.evaluate(
                """() => {
                    const rendered = el => {
                        if (!(el instanceof Element) || !el.isConnected) return false;
                        const s = getComputedStyle(el);
                        const r = el.getBoundingClientRect();
                        return s.display !== 'none'
                            && s.visibility !== 'hidden'
                            && Number(s.opacity || 1) !== 0
                            && r.width > 2 && r.height > 2;
                    };
                    const norm = value => String(value || '')
                        .replace(/\\s+/g, ' ').trim();
                    const buttons = [...document.querySelectorAll('button')]
                        .filter(rendered);

                    const classic = buttons.some(button => {
                        const r = button.getBoundingClientRect();
                        const text = norm([
                            button.innerText,
                            button.textContent,
                            button.getAttribute('aria-label'),
                            button.getAttribute('title')
                        ].filter(Boolean).join(' '));
                        const icons = norm([...button.querySelectorAll('i')]
                            .map(icon => icon.textContent || '').join(' '));
                        return r.y > innerHeight * 0.55
                            && /crop_(16_9|9_16)|crop_landscape|crop_portrait|crop_square/i.test(icons)
                            && /\\bx[1-4]\\b/i.test(text);
                    });
                    if (classic) return true;

                    const agentTune = buttons.some(button => {
                        const r = button.getBoundingClientRect();
                        const text = norm([
                            button.innerText,
                            button.textContent,
                            button.getAttribute('aria-label'),
                            button.getAttribute('title')
                        ].filter(Boolean).join(' '));
                        const icons = norm([...button.querySelectorAll('i')]
                            .map(icon => icon.textContent || '').join(' '));
                        return r.y > innerHeight * 0.55
                            && /\\btune\\b/i.test(icons)
                            && /settings|cài đặt/i.test(text);
                    });
                    if (agentTune) return true;

                    return Boolean(document.querySelector(
                        '[role="radio"][value="AUTO_APPROVE"], '
                        + '[role="radio"][value="ALWAYS_ASK"]'
                    ));
                }"""
            ))
        except Exception:
            return False

    async def _wait_workspace_ready(self, timeout_ms: int = 18000) -> bool:
        deadline = time.time() + timeout_ms / 1000.0
        while time.time() < deadline:
            if await self._workspace_ready():
                return True
            await asyncio.sleep(0.25)
        return False

    async def _click_back_to_project(self) -> bool:
        try:
            target = await self.page.evaluate(
                """() => {
                    const rendered = el => {
                        if (!(el instanceof Element) || !el.isConnected) return false;
                        const s = getComputedStyle(el);
                        const r = el.getBoundingClientRect();
                        return s.display !== 'none'
                            && s.visibility !== 'hidden'
                            && Number(s.opacity || 1) !== 0
                            && r.width > 2 && r.height > 2;
                    };
                    const norm = value => String(value || '')
                        .replace(/\\s+/g, ' ').trim();
                    for (const button of document.querySelectorAll('button')) {
                        if (!rendered(button)) continue;
                        const r = button.getBoundingClientRect();
                        const text = norm([
                            button.innerText,
                            button.textContent,
                            button.getAttribute('aria-label'),
                            button.getAttribute('title')
                        ].filter(Boolean).join(' '));
                        const icons = norm([...button.querySelectorAll('i')]
                            .map(icon => icon.textContent || '').join(' '));
                        const projectBack = /quay lại dự án|back to project/i.test(text);
                        if (projectBack && /arrow_back/i.test(icons)) {
                            return {
                                x: r.x + r.width / 2,
                                y: r.y + r.height / 2,
                                text,
                                icons
                            };
                        }
                    }
                    return null;
                }"""
            )
            if not target:
                return False
            self.log(
                "[Recovery] Click nút quay lại dự án:",
                target.get("text", ""),
            )
            await self.page.mouse.click(target["x"], target["y"])
            return True
        except Exception as error:
            self.dbg("Click quay lại dự án lỗi", str(error))
            return False

    async def _recover_project_workspace(
        self,
        *,
        reason: str,
        force: bool = False,
    ) -> bool:
        """Return to the project composer instead of terminating on /edit pages."""
        current_url = str(self.page.url or "")
        root_url = self._project_root_url(current_url)
        is_media_editor = "/edit/" in current_url.lower()

        # Never disturb an already healthy composer.
        if not is_media_editor and await self._workspace_ready():
            return False

        if not is_media_editor and not force:
            if await self._wait_workspace_ready(timeout_ms=10000):
                return False

        self.log(
            f"[Recovery] Khôi phục project workspace: reason={reason}; "
            f"url={current_url}"
        )

        changed = False
        if is_media_editor:
            clicked = await self._click_back_to_project()
            if clicked:
                changed = True
                if await self._wait_workspace_ready(timeout_ms=10000):
                    self.log("[Recovery] Đã trở lại project bằng nút Quay lại dự án.")
                    return True

        if root_url:
            try:
                self.log("[Recovery] Mở lại project:", root_url)
                await self.page.goto(
                    root_url,
                    wait_until="domcontentloaded",
                    timeout=30000,
                )
                changed = True
                if await self._wait_workspace_ready(timeout_ms=18000):
                    self.log("[Recovery] Project composer đã sẵn sàng.")
                    return True
            except Exception as error:
                self.dbg("Mở lại project lỗi", str(error))

            try:
                self.log("[Recovery] Reload project một lần.")
                await self.page.reload(
                    wait_until="domcontentloaded",
                    timeout=30000,
                )
                changed = True
                if await self._wait_workspace_ready(timeout_ms=18000):
                    self.log("[Recovery] Project composer sẵn sàng sau reload.")
                    return True
            except Exception as error:
                self.dbg("Reload project lỗi", str(error))

        return changed

    async def _detect_settings_ui(self) -> str:
        # First try the current page. If it is a media editor or stale view,
        # automatically return to the project and try once more.
        for attempt in range(2):
            if await self._agent_settings_open():
                return "agent"
            if await self._classic_settings_menu():
                return "classic"
            if await self._find_classic_settings_trigger(required=False):
                return "classic"
            if await self._find_agent_tune_button(required=False):
                return "agent"

            if attempt == 0:
                await self._recover_project_workspace(
                    reason="settings_ui_missing",
                    force=True,
                )
                continue

        debug_dir = ensure_dir(Path(self.cfg.output_dir) / "debug")
        screenshot = debug_dir / f"{now_ts()}_settings_ui_unknown_after_recovery.png"
        try:
            await self.page.screenshot(path=str(screenshot), full_page=False)
        except Exception:
            pass
        raise RuntimeError(
            "Không nhận diện được Classic UI hoặc Agent UI sau khi đã "
            "tự quay lại/reload project. "
            f"url={self.page.url}; screenshot={screenshot}"
        )'''


def patch(source: Path, destination: Path) -> None:
    text = source.read_text(encoding="utf-8")

    text = replace_block(
        text,
        r"    async def _detect_settings_ui\(self\) -> str:",
        r"    async def open_settings\(self\):",
        RECOVERY_AND_DETECT_BLOCK,
    )

    connect_needle = (
        '        self.log("[Progress] Đang nghe response API/DOM; '
        'file: progress.json")\n'
    )
    connect_replacement = connect_needle + (
        '        await self._recover_project_workspace(\n'
        '            reason="connect",\n'
        '            force=False,\n'
        '        )\n'
    )
    text = insert_once(
        text,
        connect_needle,
        connect_replacement,
        "connect workspace recovery",
    )

    download_needle = '        self.log("Đã tải video:", out_path)\n'
    download_replacement = download_needle + (
        '        await self._recover_project_workspace(\n'
        '            reason="after_video_download",\n'
        '            force=False,\n'
        '        )\n'
    )
    text = insert_once(
        text,
        download_needle,
        download_replacement,
        "return after video download",
    )

    # Remove the known false progress event from acknowledgement/config calls.
    api_needle = '''            url = response.url or ""\n            lower_url = url.lower()\n'''
    api_replacement = api_needle + '''            if any(token in lower_url for token in (\n                "fetchuseracknowledgement",\n                "useracknowledgement",\n                "featureflag",\n            )):\n                return\n'''
    text = insert_once(
        text,
        api_needle,
        api_replacement,
        "ignore unrelated progress API",
    )

    destination.write_text(text, encoding="utf-8")
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    print(f"Đã tạo: {destination}")
    print(f"SHA-256: {digest}")
    print("V33 gồm:")
    print("  - tự nhận biết URL /edit/<media-id>")
    print("  - click Quay lại dự án trước")
    print("  - fallback mở thẳng project root")
    print("  - fallback reload project một lần")
    print("  - thử nhận diện UI lại trước khi báo lỗi")
    print("  - tự quay lại project sau khi tải video")
    print("  - bỏ log progress giả fetchUserAcknowledgement")
    print("Kiểm tra:")
    print(f'  py -3.13 -m py_compile "{destination.name}"')
    print("Chạy:")
    print(
        f'  py -3.13 "{destination.name}" '
        "--input scenes.txt --output-dir flow_outputs"
    )


def main() -> None:
    source = Path(
        sys.argv[1]
        if len(sys.argv) >= 2
        else "flow_auto_full_v32_progress.py"
    )
    destination = Path(
        sys.argv[2]
        if len(sys.argv) >= 3
        else source.with_name("flow_auto_full_v33_recover.py")
    )
    if not source.exists():
        raise SystemExit(f"Không tìm thấy file nguồn: {source}")
    patch(source, destination)


if __name__ == "__main__":
    main()
