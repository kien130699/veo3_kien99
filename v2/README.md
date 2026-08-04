# Veo3 Kien99 V2.1.0

V1 Clean remains in the repository root. V2 remains separate and runs on port `8766`.

## Critical fix from the user's live test

The old V2 selected the **first** Edge tab whose URL looked like Google Flow. When several Flow tabs were open, it often attached to the gallery even though V1 Clean was already attached to a working `/project/...` tab.

V2.1.0 now uses the proven V1 Clean Flow core:

1. Scan every Edge context Flow tab.
2. Prefer a tab containing a visible Slate editor.
3. Otherwise prefer the newest `/project/` tab.
4. Only use the gallery when no project tab exists.
5. After clicking `Dự án mới`, rescan every Flow tab because Flow may open the project in another tab.
6. Find `Tạo` using label/icon plus distance from the prompt editor instead of assuming it is in the lower half of the page.

## Full V2 features retained

- batch scenes and multiple final videos;
- FFmpeg composition;
- background music and uploaded voice tracks;
- Reference Library;
- First/Last Frame;
- Ingredients and Extend modes;
- multi-output variant selection;
- retries, queue, pause/resume/cancel;
- V1-compatible parser plus V2 options.

## Validation

- `27 passed` unit/API/compositor/selector tests;
- Python compile check passed;
- mock end-to-end job completed;
- two scene clips were composed into one final MP4;
- ZIP integrity passed.

## Release

ZIP: `veo3_kien99_v2_2.1.0.zip`

SHA-256:

```text
78e3dad9f397474db666739acf84f5127cf031dde605251f46614e4f6ee58897
```

Run the extracted package with `START_V2.bat`, then open `http://127.0.0.1:8766`.
