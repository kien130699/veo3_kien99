from __future__ import annotations

import re
import sys
from pathlib import Path

PROMPT_OLD = '''PROMPT_SELECTORS = (
    '[contenteditable="true"]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
)'''

PROMPT_NEW = '''PROMPT_SELECTORS = (
    '[data-slate-editor="true"][contenteditable="true"]',
    '[data-slate-editor="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-placeholder]',
    '[contenteditable="true"]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
)'''

ENSURE_PATTERN = re.compile(
    r"    async def _ensure_editor\(self\) -> None:\n.*?\n    async def _find_prompt_input",
    re.S,
)

ENSURE_REPLACEMENT = '''    async def _ensure_editor(self) -> None:
        assert self.page is not None
        project_pattern = re.compile(
            r"start project|new project|create project|"
            r"dự án mới|tạo dự án|bắt đầu dự án|"
            r"novo projeto|criar projeto|nuevo proyecto|crear proyecto",
            re.I,
        )

        # Flow opens on the project gallery. The prompt editor does not exist until
        # a project is opened. Labels follow the Flow UI language, not ?hl=en.
        for _ in range(4):
            if await self._find_prompt_input(required=False):
                return

            candidates = (
                self.page.get_by_role("button", name=project_pattern),
                self.page.locator("button, [role='button']").filter(has_text=project_pattern),
                self.page.get_by_text(project_pattern),
                self.page.locator(
                    "button:has(i.google-symbols:text-is('add')), "
                    "[role='button']:has(i.google-symbols:text-is('add'))"
                ),
            )
            clicked = False
            for locator in candidates:
                try:
                    count = await locator.count()
                    for index in range(count):
                        item = locator.nth(index)
                        if not await item.is_visible(timeout=800):
                            continue
                        box = await item.bounding_box()
                        if not box or box["width"] < 60 or box["height"] < 25:
                            continue
                        await item.click()
                        clicked = True
                        await self.log(
                            "info",
                            "Opening a Flow project from the gallery",
                            {"url": self.page.url},
                        )
                        break
                    if clicked:
                        break
                except Exception:
                    continue

            # Flow is an SPA; wait for the Slate composer instead of sleeping once.
            for _poll in range(30 if clicked else 4):
                if await self._find_prompt_input(required=False):
                    return
                await self.page.wait_for_timeout(500)

        raise FlowSelectorError(
            "Could not find the Flow prompt editor. The driver reached the Flow gallery "
            "but could not open a project or locate the Slate prompt box. "
            "Open a project manually, exit Agent mode if enabled, then retry."
        )

    async def _find_prompt_input'''


def resolve_root() -> Path:
    candidates = [
        Path.cwd(),
        Path.cwd() / "veo3_kien99_v2",
        Path(__file__).resolve().parents[1] / "veo3_kien99_v2",
        Path(__file__).resolve().parents[2] / "veo3_kien99_v2",
    ]
    if len(sys.argv) > 1:
        candidates.insert(0, Path(sys.argv[1]))
    for root in candidates:
        if (root / "app" / "edge_flow.py").exists():
            return root.resolve()
    raise SystemExit("Could not locate veo3_kien99_v2/app/edge_flow.py")


def replace_version(root: Path) -> None:
    for rel in ("app/__init__.py", "app/main.py", "app/static/index.html"):
        path = root / rel
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace("2.0.1", "2.0.2"), encoding="utf-8")


def main() -> None:
    root = resolve_root()
    path = root / "app" / "edge_flow.py"
    text = path.read_text(encoding="utf-8")

    if PROMPT_NEW not in text:
        if PROMPT_OLD not in text:
            raise SystemExit("Prompt selector block differs from V2.0.1; hotfix stopped safely")
        text = text.replace(PROMPT_OLD, PROMPT_NEW)

    if "dự án mới" not in text:
        text, count = ENSURE_PATTERN.subn(ENSURE_REPLACEMENT, text, count=1)
        if count != 1:
            raise SystemExit("_ensure_editor block differs from V2.0.1; hotfix stopped safely")

    path.write_text(text, encoding="utf-8")
    replace_version(root)
    print(f"Applied V2.0.2 hotfix to: {root}")
    print("Restart START_V2.bat, open http://127.0.0.1:8766 and press Ctrl+Shift+R")


if __name__ == "__main__":
    main()
