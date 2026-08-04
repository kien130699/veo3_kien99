from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT.parent / "veo3_kien99_v2"
EDGE = TARGET / "app" / "edge_flow.py"

OLD = '    async def _fill_prompt(self, prompt: str) -> None:\n        assert self.page is not None\n        editor = await self._find_prompt_input()\n        await editor.click()\n        try:\n            await editor.fill("")\n            await editor.fill(prompt)\n        except Exception:\n            await self.page.keyboard.press("Control+A")\n            await self.page.keyboard.press("Backspace")\n            await self.page.keyboard.type(prompt, delay=4)\n        await self.page.wait_for_timeout(350)\n'

NEW = '    async def _fill_prompt(self, prompt: str) -> None:\n        """Enter prompt through real CDP keyboard events so Flow/Slate updates state."""\n        assert self.page is not None\n        if not prompt.strip():\n            raise ValueError("Prompt must not be empty")\n        editor = await self._find_prompt_input()\n        await editor.scroll_into_view_if_needed()\n        await editor.click(force=True)\n        await self.page.keyboard.press("Control+A")\n        await self.page.keyboard.press("Delete")\n        await self.page.wait_for_timeout(120)\n        await self.page.keyboard.type(prompt, delay=8)\n        await self.page.wait_for_timeout(450)\n        entered = await editor.evaluate(\n            """el => {\n                if (\'value\' in el) return String(el.value || \'\');\n                return String(el.innerText || el.textContent || \'\');\n            }"""\n        )\n        expected = re.sub(r"\\s+", " ", prompt).strip()\n        actual = re.sub(r"\\s+", " ", str(entered)).strip()\n        if expected not in actual and actual not in expected:\n            raise FlowSelectorError(\n                "Flow prompt editor was found, but trusted keyboard input was not retained. "\n                "Click the visible prompt box once and retry."\n            )\n'


def replace_version(path: Path) -> None:
    if path.exists():
        text = path.read_text(encoding="utf-8").replace("2.0.2", "2.0.3")
        path.write_text(text, encoding="utf-8")


def main() -> None:
    if not EDGE.exists():
        raise SystemExit(f"Missing extracted V2 folder: {TARGET}")
    text = EDGE.read_text(encoding="utf-8")
    if OLD in text:
        text = text.replace(OLD, NEW)
    elif "keyboard.type(prompt, delay=8)" not in text:
        raise SystemExit("Unsupported edge_flow.py version; install complete V2.0.3 ZIP instead")
    text = text.replace(
        'r"generate|create|submit|send", f"{text} {aria}", re.I',
        'r"generate|create|submit|send|tạo|gerar|criar|crear", f"{text} {aria}", re.I',
    )
    EDGE.write_text(text, encoding="utf-8")
    for rel in ("app/__init__.py", "app/main.py", "app/static/index.html", "tests/test_api.py"):
        replace_version(TARGET / rel)
    pyproject = TARGET / "pyproject.toml"
    if pyproject.exists():
        p = pyproject.read_text(encoding="utf-8").replace('version = "2.0.0"', 'version = "2.0.3"')
        pyproject.write_text(p, encoding="utf-8")
    print("Applied V2.0.3 trusted prompt-entry hotfix")


if __name__ == "__main__":
    main()
