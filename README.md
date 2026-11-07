# Firefox Audio Equalizer

A Firefox WebExtension (Manifest V3) that adds a real-time 10-band parametric equalizer to any
audio or video playing in a browser tab — plus named presets, a per-site kill-switch, and JSON
export/import so settings survive transfers between Windows, macOS, and Android.

All processing happens inside the page through the Web Audio API. The UI is a classic
Realtek-style widget (ON|OFF, live response curve, blue vertical sliders, presets) that opens
from the toolbar icon.

## Features

- **10-band EQ** at ISO octave centers (31.5, 63, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz):
  low-shelf + 8 peaking (Q≈1.04) + high-shelf, ±12 dB per band.
- **Classic widget UI** in the toolbar popup: ON/OFF, master preamp, live frequency-response
  curve, Mono downmix, whole-dB Snap, preset picker, night mode, and A/B compare.
- **Presets**: 50+ recommended curves built in, plus save/load/rename/delete of your own,
  persisted to `storage.local`.
- **Per-site kill-switch** for pages that break.
- **Portability**: JSON export/import is the only format that crosses Windows ↔ macOS ↔ Android.
- **DRM awareness**: EME-protected media can't be routed and is detected + bypassed (the badge
  shows "not supported on this site" instead of silence).

## Install for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json` in this folder.
3. Click the toolbar icon to open the equalizer popup, or open the extension's
   **Options** for the full editor and preset management.

Signed releases must be installed from AMO (Android requires an AMO-signed XPI).

## Development

No build step and no framework — vanilla JS with three shared globals.

```bash
npx web-ext lint            # lint gate (run before every milestone)
npx web-ext run             # launch Firefox with the extension loaded
```

Preview the widget UI without the extension (static file server + fixtures):

```bash
npx http-server -p 8931 -c-1 .
# then open http://127.0.0.1:8931/test/fixtures/popup.html
```

The widget needs `browser.*` APIs to persist, so fixtures only preview layout/interaction; the
real DSP path must be tested with the add-on loaded.

## How it works

```
tab / page process                          extension
────────────────────────────                ──────────────────────────
MAIN world  eq-main.js ──┐   window         background.js  (MV3 event page)
  AudioContext subclass   │   postMessage     · sole writer of storage
  play → media-elem EQ ───┼◄────────► bridge  · pushes APPLY_EQ to tabs
  shared ctx + EQ chain  ─┘   (ISOLATED)      · per-tab badge state
  status telemetry ───────┘                    options.html  (full editor)
                                               popup.html    (widget modal)
                                               common/eq.js   (shared DSP)

audio graph (per page): <video> / page ctx ─► input ─► 10 biquads
                                              ─► master ─► mono matrix
                                              ─► analyser ─► ctx.destination
```

## Project layout

```
manifest.json      MV3 manifest (background.scripts event page, MAIN-world content script)
background.js      Sole storage writer; effective settings; tab/badge state
common/
  eq.js            Band table, EQ chain builder, sanitize helpers, presets → window.FxEQ
  messages.js      {v,type,payload} envelope + message types → window.FxEQ_MSG
content/
  eq-main.js       MAIN-world engine (no browser.* here); runs before page scripts
  bridge.js        ISOLATED-world postMessage ↔ browser.runtime translator
ui/
  popup.html|js|css     Toolbar popup hosting the widget
  options.html|js|css   Full editor, preset management, diagnostics
  eq-widget.js|css      The classic editor widget → window.FxEqWidget
test/fixtures/     widget.html / popup.html (UI preview), media.html / webaudio.html (audio)
icons/             make-icons.ps1
plan.md            Analysis + architecture + milestones (source of truth for decisions)
task.md            Original request
```

## Known limitations

- **DRM / EME content cannot be equalized** — a browser-imposed boundary, not a bug.
- There is no browser-level per-tab audio API; everything is injected per-page via Web Audio.
- Web Audio interception of a page's own graphs ships behind an opt-in setting.

## License / credits

Recommended presets are adapted from
[SoundForge-Equalizer](https://github.com/Maximka1993271/SoundForge-Equalizer) (MIT, Maxim
Melnikov). See the header comment in `common/eq.js`.
