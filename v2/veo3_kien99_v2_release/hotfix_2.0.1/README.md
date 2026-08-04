# V2.0.1 validation hotfix

This patch fixes the browser crash:

```text
Cannot read properties of undefined (reading 'toFixed')
```

Root cause: Pydantic properties `scene_count` and `total_duration` were not serialized in `/api/validate`, while the frontend assumed both values always existed.

Fixes included:

- Serialize group and overall duration fields with `computed_field`.
- Add defensive duration/scene calculations in `app.js`.
- Render FastAPI 422 details clearly.
- Stop job creation when validation fails.
- Return 204 for `/favicon.ico`.
- Add cache-busting static asset versions.
- Version bumped to 2.0.1.
- Regression suite: 20 tests passed.

## Apply to an extracted V2 folder

Copy this `hotfix_2.0.1` folder beside the extracted `veo3_kien99_v2` folder, then run:

```bat
APPLY_HOTFIX.bat
```

Or use the complete V2.0.1 ZIP supplied separately.

Expected UI badge after restart: `V2.0.1`.
Expected URL: `http://127.0.0.1:8766`.
