# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A Firefox Manifest V3 WebExtension adding a real-time 10-band EQ to tab audio. **No build step,
no framework, no package.json.** Plain browser JS shared across three script contexts. Read
`plan.md` first — it is the source of truth for architecture and decisions (feasibility,
platform matrix, risks, milestones).

## Hard rules (violating these breaks the extension)

- **No `chrome.*`.** This is Firefox: use the `browser.*` promise-based APIs everywhere.
- **`content/eq-main.js` runs in the MAIN world and has no `browser.*` access.** It talks to the
  extension only via `window.postMessage` through `content/bridge.js`. Never call `browser.*`
  from it. Payloads crossing that boundary must be number-validated (`FxEQ.sanitize*`) — a page
  can forge a `postMessage`, so never trust shapes coming from the page.
- **`background.js` is the ONLY writer of storage.** Content scripts and UI pages are stateless
  workers that apply what they're told; they never write `storage.local`. Multiple open UIs stay
  in sync through `storage.onChanged`.
- **Keep `common/eq.js` free of DOM/browser code.** It is loaded into background, MAIN, ISOLATED,
  and UI contexts so a preset can never desync from the DSP graph. If it touches the DOM or
  `browser.*`, it's in the wrong file.
- **All cross-context messages use the single envelope** `{v:1,type,payload}` from
  `common/messages.js` (`FxEQ_MSG.envelope` / `.isEnvelope`). Add new types to that table, don't
  invent ad-hoc shapes.
- **Every UI write goes through the background** so the pushed `APPLY_EQ` reaches open tabs.

## Globals & conventions

- Shared single globals: `window.FxEQ` (DSP, bands, presets, sanitizers), `window.FxEQ_MSG`
  (protocol), `window.FxEqWidget` (the editor widget). Scripts are loaded via `<script>` /
  `manifest` `scripts` arrays in dependency order — there is no module system, so load order
  matters (messages → eq → engine/UI).
- Files start with `"use strict";` and a `/* global ... */` comment for the globals they consume.
- Match existing style: small named functions, no classes except `FxEqWidget`, defensive
  try/catch around anything a page could have patched, and terse comments that explain *why*.
- Live audio changes use `setTargetAtTime` (via `FxEQ`'s smooth setters) to avoid zipper noise.

## The widget (`ui/eq-widget.js` / `.css`)

- `FxEqWidget` is a **controlled component**: it renders and reports intent through callbacks
  (`onGains`, `onSetting`, `onPreset`, `onSavePreset`, `onAB`, `onRefresh`) but owns no
  persistence — the parent (`popup.js` / `options.js`) applies state and persists via messages.
  Keep it that way; do not add `browser.*` or `fetch` inside the widget.
- Preamp is shown in dB but maps to the linear master gain log-wise (`masterToDb` / `dbToMaster`).
- The popup is a fixed-width Firefox action popup. **Do not use `vw`/`%` for the popup width** —
  inside an action popup that resolves against a content-sized viewport and collapses the UI.
  The body is a fixed pixel width with `box-sizing: border-box` and `overflow: hidden`.
- `ui/eq-widget.css` is scoped to `.fxeqw` — keep it self-contained so it stays portable between
  the popup and the options page.

## Commands

```bash
npx web-ext lint        # MUST pass (0 errors) before finishing a task
npx web-ext run         # load in Firefox for manual testing
node --check <file>     # fast syntax check; there is no compiler/test runner
```

There is **no automated test suite**. Verification is manual with the add-on loaded
(`about:debugging` → Load Temporary Add-on → `manifest.json`) plus the static fixtures under
`test/fixtures/` for UI layout. Run `node --check` on every JS file you touch and `npx web-ext
lint` at the end. If you change DSP, audio must be confirmed by ear on `test/fixtures/media.html`.

## Gotchas

- `strict_min_version` is `128.0`; the MAIN-world content script and MV3 event page depend on it.
- Android: `storage.sync` is unavailable (bug 1625257) — `storage.local` is primary and
  `storage.sync` is a best-effort desktop mirror only. JSON export/import is the only portable
  format; don't rely on sync for correctness.
- The autoplay policy means the extension's AudioContext starts suspended until a user gesture;
  the code re-asserts on `pointerdown`/`keydown`. Don't remove that arming logic.
- Recommended presets in `common/eq.js` are adapted from SoundForge-Equalizer (MIT) — keep the
  attribution comment.
- Popups can't use `vw`; recommended presets have `presetId: null`, so the widget identifies the
  active preset by matching gains, not id — preserve both behaviors when editing the widget.

## Do NOT

- Add a bundler, transpiler, TypeScript, or a front-end framework.
- Use `chrome.*`, write storage outside `background.js`, or call `browser.*` from MAIN world.
- Inject visible UI into web pages (the options/popup live in extension pages on purpose).
- Remove the DRM-silence detection or the per-host kill-switch.
