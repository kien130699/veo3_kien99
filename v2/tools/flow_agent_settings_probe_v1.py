from __future__ import annotations

import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

CDP_URL = "http://127.0.0.1:9223"
OUT_DIR = Path("flow_outputs/debug")


def norm(value: str) -> str:
    return " ".join(str(value or "").split())


async def rendered(locator) -> bool:
    try:
        return await locator.evaluate(
            """el => {
                if (!el || !el.isConnected) return false;
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden'
                    && Number(s.opacity || 1) !== 0 && r.width > 2 && r.height > 2;
            }"""
        )
    except Exception:
        return False


async def text_of(locator) -> str:
    try:
        return norm(await locator.evaluate(
            """el => [
                el.innerText || '', el.textContent || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('title') || '',
                el.getAttribute('placeholder') || ''
            ].join(' ')"""
        ))
    except Exception:
        return ""


async def icons_of(locator) -> str:
    try:
        return norm(await locator.locator("i").all_text_contents())
    except Exception:
        return ""


async def close_obvious_modal(page) -> None:
    buttons = page.locator("button")
    for i in range(await buttons.count()):
        btn = buttons.nth(i)
        if not await rendered(btn):
            continue
        text = (await text_of(btn)).lower()
        icons = (await icons_of(btn)).lower()
        box = await btn.bounding_box()
        if not box:
            continue
        if "close this modal" in text or ("close" in icons and box["x"] > 1700 and box["y"] < 100):
            try:
                await btn.click(timeout=5000)
                await asyncio.sleep(0.5)
            except Exception:
                pass
            return


async def find_tune_button(page):
    buttons = page.locator("button")
    candidates = []
    for i in range(await buttons.count()):
        btn = buttons.nth(i)
        if not await rendered(btn):
            continue
        text = await text_of(btn)
        icons = await icons_of(btn)
        box = await btn.bounding_box()
        if not box:
            continue
        score = 0
        if "tune" in icons.lower():
            score += 1000
        if "settings" in text.lower():
            score += 500
        if box["y"] > 700:
            score += 200
        candidates.append({"index": i, "score": score, "text": text, "icons": icons, "box": box, "locator": btn})
    candidates.sort(key=lambda x: x["score"], reverse=True)
    if not candidates or candidates[0]["score"] < 1000:
        raise RuntimeError("Không tìm thấy nút tune Settings trong composer Agent.")
    return candidates[0]


async def collect(page):
    selectors = [
        '[role="dialog"]', '[role="menu"]', '[role="listbox"]',
        '[role="tablist"]', '[role="tab"]', '[role="option"]',
        '[role="menuitem"]', '[role="radio"]', '[role="switch"]',
        '[role="combobox"]', 'button', 'input', 'textarea', 'select', 'label'
    ]
    rows = []
    seen = set()
    for selector in selectors:
        loc = page.locator(selector)
        for i in range(await loc.count()):
            item = loc.nth(i)
            if not await rendered(item):
                continue
            try:
                snapshot = await item.evaluate(
                    """el => {
                        const r = el.getBoundingClientRect();
                        const attrs = {};
                        for (const name of [
                            'role','aria-label','aria-controls','aria-selected','aria-checked',
                            'aria-expanded','data-state','data-value','value','name','type','title'
                        ]) {
                            const value = el.getAttribute(name);
                            if (value !== null) attrs[name] = value;
                        }
                        return {
                            tag: el.tagName.toLowerCase(),
                            text: [el.innerText || '', el.textContent || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || ''].join(' ').replace(/\\s+/g,' ').trim(),
                            icons: [...el.querySelectorAll('i')].map(x => x.textContent || '').join(' ').replace(/\\s+/g,' ').trim(),
                            attrs,
                            box: {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)}
                        };
                    }"""
                )
            except Exception:
                continue
            key = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            rows.append({"selector": selector, "index": i, **snapshot})
    return rows


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(CDP_URL)
        pages = [p for c in browser.contexts for p in c.pages if "labs.google/fx" in (p.url or "") and "/flow/project/" in (p.url or "")]
        if not pages:
            raise RuntimeError("Không tìm thấy tab project Google Flow.")
        page = pages[-1]
        await page.bring_to_front()
        await close_obvious_modal(page)

        tune = await find_tune_button(page)
        print("TUNE:", json.dumps({k: v for k, v in tune.items() if k != "locator"}, ensure_ascii=False))
        await tune["locator"].click(timeout=15000)
        await asyncio.sleep(1.2)

        rows = await collect(page)
        payload = {
            "url": page.url,
            "title": await page.title(),
            "tune": {k: v for k, v in tune.items() if k != "locator"},
            "elements": rows,
        }
        json_path = OUT_DIR / "flow_agent_settings_probe.json"
        png_path = OUT_DIR / "flow_agent_settings_probe.png"
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        await page.screenshot(path=str(png_path), full_page=True)

        print(f"Đã lưu: {json_path}")
        print(f"Đã lưu: {png_path}")
        print("Các control đáng chú ý:")
        for row in rows:
            text = row.get("text", "")
            icons = row.get("icons", "")
            attrs = row.get("attrs", {})
            signal = f"{text} {icons} {json.dumps(attrs, ensure_ascii=False)}".lower()
            if any(token in signal for token in [
                "image", "hình ảnh", "video", "veo", "nano", "aspect", "16:9",
                "9:16", "output", "x1", "x2", "x3", "x4", "model", "duration",
                "thành phần", "components", "frames", "khung hình"
            ]):
                print(json.dumps(row, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
