# V2.0.3 trusted prompt-entry hotfix

Fixes the case where prompt text is visible in Google Flow but Flow still treats the prompt as empty.

## Cause

Google Flow uses a Slate/React editor. Text inserted by DevTools Console code, `textContent`, `execCommand`, or direct DOM mutation can be visible without updating the internal Slate state.

## Fix

V2.0.3 uses Playwright/CDP trusted keyboard input:

```text
focus visible Slate editor
→ Control+A
→ Delete
→ real keyboard typing
→ read editor back
→ click Tạo/Create only when enabled
```

It also recognizes Vietnamese `Tạo` and Portuguese/Spanish create labels.

## Apply

Place this folder next to the extracted `veo3_kien99_v2` folder, then run:

```bat
APPLY_HOTFIX.bat
```

Restart V2 and open `http://127.0.0.1:8766`.

Complete V2.0.3 ZIP SHA-256:

```text
cf947ade932ff143b7966162f79022c5cfecf1cff5b72f269eb5d2bddc434fab
```

Validation: 24 tests passed; ZIP integrity passed.
