# V2.2 DEBUG specification

## Event fields

Each event contains at least:

```json
{
  "time": "ISO-8601",
  "level": "debug|info|warning|error|success",
  "job_id": "...",
  "message": "...",
  "data": {}
}
```

## Selector diagnostics

Prompt scans record, for every selector:

- selector string;
- number of matches;
- candidate index;
- visible state;
- bounding box;
- text/placeholder/aria label preview;
- calculated selection score.

The chosen prompt editor and submit button are logged explicitly.

## Tab diagnostics

Every scan and recovery records all Edge pages with:

- tab index;
- URL;
- page title;
- closed state;
- detected UI mode;
- whether a prompt surface was found.

## Retry and recovery

Every UI step logs:

```text
UI step start
UI step success
UI step failed
UI recovery started
Flow page selected
```

The default is two retries per UI step. After failure, V2 rescans all Flow tabs and prefers a page containing the Agent/Slate prompt editor, then a `/project/` page.

## Scene failure policy

`continue_on_scene_error=true` by default. Failed scenes are appended to the job's `failed_scenes` list with group, scene, exception type, message, traceback and timestamp. The queue then proceeds to later scenes.

Google risk/CAPTCHA blocks are excluded from this skip behavior: those pause the job for manual resolution.
