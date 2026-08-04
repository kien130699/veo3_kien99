# V2.0.2 Flow selector hotfix

Fixes:

```text
app.edge_flow.FlowSelectorError: Could not find the Flow prompt editor
```

The affected Flow session opens at the project gallery and renders the Vietnamese button `+ Dự án mới`. V2.0.1 searched only English project labels and treated generic contenteditable elements as the main prompt editor.

V2.0.2:

- Detects Flow Slate editors via `data-slate-editor=true`.
- Supports ProseMirror and role=textbox fallbacks.
- Opens Vietnamese, English, Portuguese and Spanish project buttons.
- Uses the locale-stable `add` icon as a fallback.
- Waits for the Flow SPA editor to mount.
- Includes the standalone Console test at `v2/tools/flow_prompt_test.js`.

## Apply to an extracted V2.0.1 folder

Place this hotfix folder next to the extracted `veo3_kien99_v2` folder and run:

```bat
APPLY_HOTFIX.bat
```

Then close the old V2 server, run `START_V2.bat`, open `http://127.0.0.1:8766`, and press `Ctrl+Shift+R`.

## Complete package

Complete V2.0.2 ZIP SHA-256:

```text
add6a22f52884ff5a34a6dc17c1a68f4c5efa576df88ff0429c81d60ae961cf6
```

Local validation: 22 tests passed; ZIP integrity passed.
