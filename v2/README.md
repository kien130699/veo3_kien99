# Veo3 Kien99 V2

V1 remains in the repository root. V2 runs separately on `http://127.0.0.1:8766` and uses `data_v2/` plus `output_v2/`.

## Current hotfix: V2.0.1

The validation crash below is fixed in GitHub:

```text
Cannot read properties of undefined (reading 'toFixed')
```

The fix is stored at:

```text
v2/veo3_kien99_v2_release/hotfix_2.0.1/
```

It contains the corrected backend model serialization and defensive frontend validation code. Run `APPLY_HOTFIX.bat` from that folder after extracting the original V2 release, or replace the old installation with the complete V2.0.1 ZIP.

V2.0.1 complete ZIP SHA-256:

```text
30f256bf2795ff45eb744e1712d69026e981242d9dbded519e222244899cc5b7
```

Validation performed locally:

- 20 tests passed.
- `/api/validate` returns `scene_count`, list `total_duration`, and overall `total_duration`.
- Frontend no longer calls `.toFixed()` on an undefined value.
- Invalid requests show readable FastAPI 422 details.

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

The correct interface displays a `V2` or `V2.0.1` badge and includes the **Reference** tab. The older interface shown on port `8765` is V1.
