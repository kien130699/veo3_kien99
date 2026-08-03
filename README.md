# Veo3 Kien99

Local web application for running a Google Flow prompt queue through a real Microsoft
Edge session on CDP port **9223**, downloading the generated clips, trimming each clip
to the requested duration and composing final videos with optional background music
and voice audio.

The generation path is deliberately UI-only:

```text
Python/FastAPI
  -> Playwright CDP
  -> Microsoft Edge 9223
  -> Google Flow UI
  -> Flow's own JavaScript submits generation
```

It does **not** construct or replay Google private generation API payloads. If Google
Flow displays CAPTCHA, unusual-activity or rate-limit messages, the job stops instead
of attempting to bypass them.

## Main features

- Original dark web UI inspired by common Chrome side-panel batch tools.
- Connects to the Edge command supplied for port `9223`.
- Imports text in this exact format:

  ```text
  image prompt | video prompt | duration
  ```

- One scene per line; duration is in seconds.
- A line containing `___` separates independent lists. Each list becomes one final
  video.
- Use `\|` inside prompt text when a literal pipe is required.
- Generates a reference image first when `image prompt` is present.
- Generates Video from Text when image prompt is empty.
- Scenes longer than ten seconds are split into supported Flow durations. The last
  frame can be passed into the next generation to continue the scene.
- Final FFmpeg composition trims generated clips to the exact durations requested.
- Optional background music and voice uploads with independent volume controls.
- Local SSE logs, pause/resume/cancel controls and persistent job records.
- Mock mode for testing the whole pipeline without Edge or Google Flow.

## Pinned upstream reference

The automation architecture and resilient selector strategy are based on studying
`gflow-cli`, pinned to:

```text
Tag:    v0.49.0
Commit: 127c3cc873ca777d5744b0e94dc3dec22337efe9
```

Clone and verify the exact source snapshot:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_gflow.ps1
```

This creates `vendor\gflow-cli`. The application uses its own Edge-9223 adapter so
that it attaches to the user's already-open Edge rather than starting gflow-cli's
separate browser profile.

## Windows setup

### 1. Requirements

- Windows 10/11.
- Python 3.11 or newer.
- Microsoft Edge at:

  ```text
  C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
  ```

- FFmpeg and FFprobe available in `PATH`.
- Google Flow access in the Google account used by the dedicated Edge profile.

### 2. Start Edge on port 9223

Run:

```bat
scripts\start_edge_9223.bat
```

Equivalent command:

```bat
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
  --remote-debugging-address=127.0.0.1 ^
  --remote-debugging-port=9223 ^
  --user-data-dir="C:\temp\edge-debug-9223" ^
  --new-window ^
  --flag-switches-begin --flag-switches-end ^
  https://labs.google/fx/tools/flow
```

Sign in to Google Flow manually. This profile is isolated from the normal Edge
profile.

### 3. Start the application

```bat
run_windows.bat
```

The server opens:

```text
http://127.0.0.1:8765
```

No inbound LAN interface is used by default.

## Input example

```text
Cinematic close-up of a silver-haired explorer inside a glowing cave | Slow push-in, subtle breathing, dust particles drifting through volumetric light | 8
Ancient mechanical door in the same cave | Camera tracks forward as gears turn and warm light spills out | 12
___
A small red robot standing on a rainy neon street | Gentle handheld camera, robot looks up, reflections ripple in puddles | 6
```

This creates:

- Final video 1: two scenes, target length 20 seconds.
- Final video 2: one scene, target length 6 seconds.

A 12-second scene is generated as `10s + 4s`, then trimmed during final composition
to `10s + 2s`.

## Music and voice

Upload an audio file in the **Âm thanh cuối** section.

- Music loops until the final video ends.
- Voice starts at time zero.
- Source clip audio, music and voice each have independent volume controls.
- Loudness normalization can be enabled before AAC encoding.

The server also exposes `POST /api/compose`, allowing existing job clips to be
recomposed with different audio settings without spending Flow credits again.

## Mock test

To exercise parsing, queueing, generated clips and FFmpeg composition without Edge:

```bat
run_mock_windows.bat
```

or:

```powershell
$env:VEO_MOCK_FLOW="1"
python run.py
```

Mock mode creates local test-pattern images and clips.

## API overview

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Server and pin information |
| GET | `/api/edge/status` | Check Edge CDP endpoint |
| POST | `/api/validate` | Parse input and calculate Flow duration chunks |
| POST | `/api/assets?kind=music` | Upload music/voice assets |
| POST | `/api/jobs` | Start a generation job |
| GET | `/api/jobs` | List persistent jobs |
| GET | `/api/jobs/{id}/events` | SSE job events |
| POST | `/api/jobs/{id}/control` | Pause, resume or cancel |
| POST | `/api/compose` | Recompose existing generated clips |
| GET | `/api/outputs/{filename}` | Download a final MP4 |

## Known limitations

Google can change the Flow interface without notice. The adapter uses semantic role,
text, icon and geometry fallbacks, but live selector adjustment may still be needed.
The application cannot be fully live-tested without the user's authenticated Edge
session and Flow account.

The current workflow selects the first newly visible generated image/video. For
`output_count > 1`, extra outputs remain in Flow; only the first result is included in
the automatic final video.

A job paused because of Google verification must be resolved manually in Edge. The
software intentionally contains no CAPTCHA bypass, cookie clearing or risk-check
evasion.

## Security guidance

- Use a dedicated Google account/profile for automation.
- Never expose CDP port 9223 to the LAN. The supplied script binds it to
  `127.0.0.1`.
- Do not run this server with `VEO_HOST=0.0.0.0` unless API authentication is added.
- Do not upload browser profiles, HAR files, cookies or job directories to GitHub.
- Review upstream changes before changing the pinned `gflow-cli` tag.
- Install from source and use the provided scripts rather than unknown EXE/CRX files.

## Testing

```powershell
python -m pip install -r requirements-dev.txt
$env:VEO_MOCK_FLOW="1"
pytest -q
```

## License

This project is MIT licensed. See `THIRD_PARTY_NOTICES.md` for upstream attribution.
Google Flow and Veo are Google services and are governed by Google's own terms.
