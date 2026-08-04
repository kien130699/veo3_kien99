# Veo3 Kien99 V2.2.0

V1 Clean remains in the repository root. V2 remains separate and runs on port `8766`.

## Main V2.2 changes

V2.2 keeps all V2 functions and adds **DEBUG-level selector/tab logging** plus fault-tolerant scene processing.

### DEBUG logging

Every job records:

```text
data_v2/jobs/<job_id>/logs/debug.txt
data_v2/jobs/<job_id>/logs/debug.jsonl
```

The DEBUG stream includes:

- every Edge tab URL and title;
- detected Flow UI mode;
- every prompt selector and match count;
- candidate visibility, bounding box, text and selection score;
- the exact prompt editor and submit button selected;
- UI step name, attempt number, retries and recovery action;
- exception type, message and traceback.

Failures also save:

```text
data_v2/jobs/<job_id>/debug/<sequence>_<step>.png
data_v2/jobs/<job_id>/debug/<sequence>_<step>.json
```

The snapshot JSON includes active URL/title, tab list, UI mode and a limited body-text sample. Cookies, authorization headers and browser profiles are not exported.

### Agent UI support

The prompt detector now supports the new Flow Agent composer shown on the user's account, including the Vietnamese placeholder:

```text
Bạn muốn làm gì?
```

It checks textarea, textbox, contenteditable, aria-label and data-placeholder forms.

### Fault-tolerant queue

- Each UI step retries twice by default.
- After a UI failure, V2 rescans all Flow tabs and project/editor selectors.
- A failed scene is recorded in `failed_scenes` and skipped by default.
- Later scenes and queued jobs continue.
- CAPTCHA, unusual activity and rate-limit pages still pause the job and are never bypassed.

## Full V2 functions retained

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

- `32 passed` unit/API/compositor/selector/debug tests;
- Python compile check passed;
- JavaScript syntax check passed;
- mock end-to-end job completed;
- a deliberately broken scene was skipped and the next scene completed;
- two mock scene clips were composed into one final MP4;
- ZIP integrity passed.

## Release

ZIP: `veo3_kien99_v2_2.2.0.zip`

SHA-256:

```text
ed7e07e87a97f2293367ad89ccdc463882ced79e7b420c29a7755518dad56e19
```

Run the extracted package with `START_V2.bat`, then open `http://127.0.0.1:8766`.
