# Veo3 Kien99 V2

V2 is stored separately from V1. Nothing in the repository root was replaced.

## Extract the complete source

The complete ZIP is stored as four Base64 text parts because the GitHub connector cannot upload a binary archive directly.

```powershell
cd v2\veo3_kien99_v2_release
python extract_v2.py
cd veo3_kien99_v2
run_windows.bat
```

The extractor:

1. Joins `source_archive/part01.b64` through `part04.b64`.
2. Decodes `veo3_kien99_v2.zip`.
3. Verifies SHA-256 before extraction.
4. Extracts exactly one root folder: `veo3_kien99_v2/`.

## Isolation from V1

- V1 remains in the repository root.
- V2 server defaults to `http://127.0.0.1:8766`.
- V2 uses `data_v2/` and `output_v2/`.
- V2 does not overwrite V1 jobs or outputs.

## Ten V2 features

1. Reference Library with reusable aliases.
2. Reference roles: character, object, location, style, frame and video.
3. First/start-frame input.
4. Last/end-frame input.
5. Ingredients mode with up to three references.
6. Extend mode from a source video.
7. Automatic T2V/I2V/Frames/Ingredients/Extend mode selection.
8. Per-scene model, aspect ratio and continuity overrides.
9. Multi-output generation (1–4), variant selection and retained variant files.
10. Automatic retry plus retry-one-scene as a new job.

## Validation

- Unit/API/security/compositor tests: **18 passed**.
- Mock end-to-end generation and composition: passed.
- ZIP integrity test: passed.

Live Google Flow selectors still require verification against the authenticated Edge 9223 session because Google can A/B-test the Flow UI.
