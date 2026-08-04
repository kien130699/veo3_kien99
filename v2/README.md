# Veo3 Kien99 V2

V1 remains in the repository root. V2 runs separately on `http://127.0.0.1:8766` and uses `data_v2/` plus `output_v2/`.

## Current hotfix: V2.0.3

V2.0.3 fixes two Flow UI problems:

```text
Could not find the Flow prompt editor
Prompt text is visible, but Flow still treats it as empty
```

The current hotfix is stored at:

```text
v2/veo3_kien99_v2_release/hotfix_2.0.3/
```

It adds Vietnamese project/editor support and enters prompts using trusted Playwright/CDP keyboard events instead of Console DOM mutation or `locator.fill()` against Flow's Slate editor.

Apply it by placing the hotfix folder next to an extracted `veo3_kien99_v2` folder and running:

```bat
APPLY_HOTFIX.bat
```

Complete V2.0.3 ZIP SHA-256:

```text
cf947ade932ff143b7966162f79022c5cfecf1cff5b72f269eb5d2bddc434fab
```

Validation performed locally:

- 24 tests passed.
- ZIP integrity passed.
- Slate editor discovery includes `data-slate-editor=true`.
- Prompt entry uses `Control+A`, `Delete`, then real keyboard typing through CDP.
- Submit button matching includes Vietnamese `Tạo`.

## Console test

`v2/tools/flow_prompt_test.js` is now selector-only. DevTools Console JavaScript cannot reliably produce trusted input for Flow's Slate/React state. Use it to locate/focus the editor, not as the generation transport.

## Original release layout

The isolated V2 release is stored at:

- `v2/veo3_kien99_v2_release/`
- ZIP root after extraction: `veo3_kien99_v2/`
- Default server: `http://127.0.0.1:8766`

Run the extracted release with:

```powershell
cd veo3_kien99_v2
run_windows.bat
```

The correct interface displays a V2 badge and includes the **Reference** tab. The interface on port `8765` is V1.
