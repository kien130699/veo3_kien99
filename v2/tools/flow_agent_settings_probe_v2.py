from __future__ import annotations

import asyncio
import json
import traceback
from pathlib import Path

from playwright.async_api import async_playwright

CDP_URL = "http://127.0.0.1:9223"
OUT_DIR = Path("flow_outputs/debug")


def compact(value: object) -> str:
    return " ".join(str(value or "").split())


async def find_flow_page(browser):
    pages = [
        page
        for context in browser.contexts
        for page in context.pages
        if "labs.google/fx" in (page.url or "") and "/flow/project/" in (page.url or "")
    ]
    if not pages:
        raise RuntimeError("Không tìm thấy tab project Google Flow.")
    return pages[-1]


async def close_account_modal(page) -> None:
    result = await page.evaluate(
        """() => {
            const rendered = el => {
                if (!(el instanceof Element) || !el.isConnected) return false;
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden'
                    && Number(s.opacity || 1) !== 0 && r.width > 2 && r.height > 2;
            };
            for (const button of document.querySelectorAll('button')) {
                if (!rendered(button)) continue;
                const text = [button.innerText, button.textContent,
                    button.getAttribute('aria-label'), button.getAttribute('title')]
                    .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase();
                const icons = [...button.querySelectorAll('i')]
                    .map(x => x.textContent || '').join(' ').toLowerCase();
                const r = button.getBoundingClientRect();
                if (text.includes('close this modal') ||
                    (icons.includes('close') && r.x > innerWidth * 0.70 && r.y < 100)) {
                    return {found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, text, icons};
                }
            }
            return {found: false};
        }"""
    )
    if result.get("found"):
        await page.mouse.click(result["x"], result["y"])
        await asyncio.sleep(0.4)
        print("Đã đóng modal tài khoản.", flush=True)


async def find_tune(page):
    result = await page.evaluate(
        """() => {
            const rendered = el => {
                if (!(el instanceof Element) || !el.isConnected) return false;
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden'
                    && Number(s.opacity || 1) !== 0 && r.width > 2 && r.height > 2;
            };
            const rows = [];
            [...document.querySelectorAll('button')].forEach((button, index) => {
                if (!rendered(button)) return;
                const r = button.getBoundingClientRect();
                const text = [button.innerText, button.textContent,
                    button.getAttribute('aria-label'), button.getAttribute('title')]
                    .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim();
                const icons = [...button.querySelectorAll('i')]
                    .map(x => x.textContent || '').join(' ').replace(/\\s+/g, ' ').trim();
                let score = 0;
                if (/\\btune\\b/i.test(icons)) score += 1000;
                if (/settings/i.test(text)) score += 500;
                if (r.y > innerHeight * 0.60) score += 200;
                rows.push({
                    index, score, text, icons,
                    box: {x:r.x, y:r.y, width:r.width, height:r.height},
                    center: {x:r.x+r.width/2, y:r.y+r.height/2}
                });
            });
            rows.sort((a,b) => b.score-a.score);
            return {best: rows[0] || null, candidates: rows.slice(0, 12)};
        }"""
    )
    best = result.get("best")
    if not best or best.get("score", 0) < 1000:
        raise RuntimeError(f"Không tìm thấy tune Settings. Candidates={result.get('candidates')}")
    return result


async def fast_collect(page):
    return await page.evaluate(
        """() => {
            const rendered = el => {
                if (!(el instanceof Element) || !el.isConnected) return false;
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden'
                    && Number(s.opacity || 1) !== 0 && r.width > 2 && r.height > 2;
            };
            const selectors = [
                '[role="dialog"]','[role="menu"]','[role="listbox"]',
                '[role="tablist"]','[role="tab"]','[role="option"]',
                '[role="menuitem"]','[role="radio"]','[role="switch"]',
                '[role="combobox"]','button','input','textarea','select','label'
            ];
            const seen = new Set();
            const rows = [];
            for (const selector of selectors) {
                const nodes = document.querySelectorAll(selector);
                nodes.forEach((el, index) => {
                    if (!rendered(el)) return;
                    const r = el.getBoundingClientRect();
                    const attrs = {};
                    for (const name of [
                        'id','class','role','aria-label','aria-controls','aria-selected',
                        'aria-checked','aria-expanded','aria-haspopup','data-state',
                        'data-value','value','name','type','title','placeholder'
                    ]) {
                        const value = el.getAttribute(name);
                        if (value !== null) attrs[name] = value;
                    }
                    const text = [el.innerText || '', el.textContent || '',
                        el.getAttribute('aria-label') || '', el.getAttribute('title') || '',
                        el.getAttribute('placeholder') || '']
                        .join(' ').replace(/\\s+/g,' ').trim();
                    const icons = [...el.querySelectorAll('i')]
                        .map(x => x.textContent || '').join(' ').replace(/\\s+/g,' ').trim();
                    const row = {
                        selector, index, tag: el.tagName.toLowerCase(), text, icons, attrs,
                        box: {x:Math.round(r.x), y:Math.round(r.y),
                              width:Math.round(r.width), height:Math.round(r.height)}
                    };
                    const key = JSON.stringify(row);
                    if (seen.has(key)) return;
                    seen.add(key);
                    rows.push(row);
                });
            }
            return {
                viewport: {width: innerWidth, height: innerHeight},
                bodyText: (document.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 20000),
                rows
            };
        }"""
    )


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "flow_agent_settings_probe_v2.json"
    png_path = OUT_DIR / "flow_agent_settings_probe_v2.png"
    before_path = OUT_DIR / "flow_agent_settings_probe_v2_before.png"

    payload = {"ok": False, "stage": "start"}

    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(CDP_URL)
        page = await find_flow_page(browser)
        await page.bring_to_front()
        print("Đã connect:", page.url, flush=True)

        try:
            payload["stage"] = "close_modal"
            await close_account_modal(page)
            await page.screenshot(path=str(before_path), full_page=False)
            print("Đã lưu ảnh trước click:", before_path, flush=True)

            payload["stage"] = "find_tune"
            tune_result = await find_tune(page)
            payload["tune"] = tune_result
            print("TUNE:", json.dumps(tune_result["best"], ensure_ascii=False), flush=True)

            payload["stage"] = "click_tune"
            center = tune_result["best"]["center"]
            await page.mouse.move(center["x"], center["y"])
            await page.mouse.click(center["x"], center["y"])
            print("Đã click tune bằng mouse CDP.", flush=True)
            await asyncio.sleep(1.0)

            payload["stage"] = "collect"
            print("Đang quét DOM một lần...", flush=True)
            collected = await asyncio.wait_for(fast_collect(page), timeout=15)
            payload.update(collected)
            print(f"Đã quét {len(collected.get('rows', []))} control.", flush=True)

            payload["stage"] = "screenshot"
            await page.screenshot(path=str(png_path), full_page=False)
            payload["ok"] = True
            payload["stage"] = "done"

        except Exception as error:
            payload["error"] = repr(error)
            payload["traceback"] = traceback.format_exc()
            print("PROBE ERROR:", repr(error), flush=True)
            try:
                await page.screenshot(path=str(png_path), full_page=False)
            except Exception as screenshot_error:
                payload["screenshot_error"] = repr(screenshot_error)
        finally:
            json_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print("Đã lưu JSON:", json_path, flush=True)
            print("Đã lưu PNG:", png_path, flush=True)

            rows = payload.get("rows", [])
            print("Controls đáng chú ý:", flush=True)
            tokens = [
                "image","hình ảnh","video","veo","nano","aspect","16:9","9:16",
                "output","x1","x2","x3","x4","model","duration","thành phần",
                "components","frames","khung hình","agent","settings"
            ]
            for row in rows:
                signal = compact(
                    f"{row.get('text','')} {row.get('icons','')} "
                    f"{json.dumps(row.get('attrs',{}), ensure_ascii=False)}"
                ).lower()
                if any(token in signal for token in tokens):
                    print(json.dumps(row, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
