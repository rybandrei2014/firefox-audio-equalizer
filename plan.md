# Firefox Audio Equalizer — Implementation Plan

> Deliverable of the analysis phase requested in `task.md`.
> Goal: a WebExtension that adds a real-time parametric equalizer to any audio/video playing
> in Firefox tabs, with a slider UI and user presets persisted to storage. Works on the same
> codebase across Windows, macOS and Android (single MV3 add-on).

---

## 1. Requirements

| # | Requirement | Priority |
|---|-------------|----------|
| R1 | Real-time equalizer applied to tab audio (music, video, web players) | P0 |
| R2 | UI with EQ sliders (per-band gain) that apply live | P0 |
| R3 | Save current slider setting as a named preset; list/load/delete presets; persisted across restarts | P0 |
| R4 | Same extension runs on Firefox Desktop (Win/macOS/Linux) and Firefox for Android | P0 |
| R5 | Enable/disable per site (kill-switch for pages that break) | P1 |
| R6 | Presets/settings portable between platforms (Android cannot use `storage.sync`) | P1 |
| R7 | Low CPU overhead, no audible artifacts on neutral settings | P1 |
| R8 | Global bypass + master gain (volume safety) | P2 |
| R9 | Works alongside content blockers (uBlock Origin & co.) — no interference either direction | P0 |

**Hard limitations to accept up front (browser-imposed, not fixable by this extension):**

- **DRM/EME content cannot be equalized.** Protected media (Netflix, Disney+, Prime Video,
  Spotify-in-browser protected tier) bypasses the Web Audio pipeline by design. The extension
  detects this (silence after routing) and shows "not supported on this site".
- There is **no browser-level per-tab audio API** for extensions. All processing must happen
  *inside the page* via the Web Audio API. (Analysis of alternatives: §2.3)

---

## 2. Feasibility analysis

### 2.1 Where audio lives in a page

Page audio arrives from exactly two sources:

1. **HTML media elements** — `<audio>` / `<video>` (YouTube, Twitch, podcast players, MP4 files).
   Routable via `AudioContext.createMediaElementSource(el)`. Constraints:
   - one `MediaElementAudioSourceNode` per element ever; wrap each element once, cache the node;
   - EME-protected elements produce silence through Web Audio → detect + bypass;
   - pages that already called `createMediaElementSource` on the element will conflict →
     try/catch, skip that element, report state.
2. **Web Audio graphs the page builds itself** (games, DAWs, some streaming players). The page
   connects nodes to `ctx.destination`. Interceptable by replacing the `destination` getter:
   page output → our EQ chain → real destination.

### 2.2 Patching the page's own objects requires the MAIN world

Content scripts run in an **isolated world**: shared DOM, but separate JS globals — overriding
`window.AudioContext` there does **not** affect page scripts. Two sanctioned ways to run code in
the page's JS context, both declared in MV3:

| Route | How | Verdict |
|-------|-----|---------|
| `content_scripts[].world: "MAIN"` + `run_at: "document_start"` | declarative; supported in Firefox 128+ (incl. Android Fenix, same Gecko) | **Use this.** No extra permission prompt, runs before any page script |
| `browser.userScripts` API | programmatic; requires user to enable a hidden pref ("Allow accounts to run scripts") | Fallback only; bad UX |

MAIN-world scripts cannot call `browser.*` APIs. Bridge: MAIN script ↔ `window.postMessage` /
`CustomEvent` ↔ an ISOLATED content script ↔ `browser.runtime` messaging ↔ background/UI.

### 2.3 Rejected alternatives

- **`tabs.captureStream` / tab sharing APIs** — stream is for re-broadcast (screen share), cannot
  be fed back into the original tab's output; user would hear duplicated/delayed audio.
- **Chrome `offscreen` document** — not supported by Firefox; and there is no capture path into it.
- **Native messaging app doing OS-level DSP** — breaks "extension only", impossible on Android,
  per-OS drivers, install burden. Rejected.
- **`browserSettings` / any Firefox audio API** — does not exist.
- **Manifest V2** — Android never supported it for new installs; MV3 is the only option that
  satisfies R4. (Firefox MV3 background = event page via `background.scripts`; do **not** use
  `service_worker`, its Firefox support is newest/least stable.)

### 2.4 Autoplay policy (why the EQ "arms" on first interaction)

A `new AudioContext()` created by our script without a user gesture starts `suspended`.
Strategy: create the extension-owned `AudioContext` at `document_start`, then `resume()` it on
the first `pointerdown`/`keydown` on the page (once-listener), and opportunistically on media
`play`. Desktop users click a page within seconds anyway; on Android, autoplay is usually
user-initiated. Elements that start playing while suspended simply begin routing through the
graph the moment it resumes — no lost audio, and bypass mode is the default until the context
is running.

### 2.5 Platform / API support matrix (verify targets before release)

| Capability | Desktop | Android (Fenix) | Notes |
|------------|---------|-----------------|-------|
| MV3, `action`, options page | ✅ | ✅ (options via add-ons manager "Manage → settings"; popup support on Android is newer/limited → options page is the canonical UI) | |
| `content_scripts` `world: MAIN`, `document_start` | ✅ 128+ | ✅ same Gecko | set `strict_min_version: "128.0"` |
| Web Audio `BiquadFilterNode`, `createMediaElementSource` | ✅ | ✅ | long-stable |
| `browser.storage.local` | ✅ | ✅ | primary store |
| `browser.storage.sync` | ✅ | ❌ (bug 1625257) | optional desktop-only mirror; R6 met via JSON export/import instead |
| `tabs` messaging, badges | ✅ | ✅ | |
| Install path | `about:debugging` (temp) / AMO-signed | USB `about:debugging` (temp) / AMO-signed from browser | unsigned release won't install on Android |

### 2.6 Coexistence with content blockers (R9)

Architecturally orthogonal to blockers — by design, not by luck:

- **Different layers.** uBO-family blockers act on network requests, CSS/DOM cosmetics, and
  their own scriptlets. We never touch DOM, CSS, or the network: we only read `play` events and
  build a Web Audio graph inside the page's JS context. No shared mutable surface.
- **Injection channel.** Declarative `content_scripts` are injected by the browser and are not
  affected by page CSP (which a blocker may rewrite anyway). uBO does not patch
  `AudioContext`/`HTMLMediaElement`, so there is no competing monkey-patch; only another EQ/
  voice-changer-style extension could conflict → per-host kill-switch resolves it.
- **Ordering independence.** Blocker hiding/breaking an ad element cannot affect an already
  wrapped `MediaElementAudioSourceNode`; conversely our wrapping cannot make a blocked ad
  reappear — we add no DOM nodes.
- **Ad lifecycle.** YouTube with network-blocking: ad never loads, nothing to wrap; skimmer
  blockers: same or new `<video>` element → play-capture listener wraps ads too, EQ is
  continuous across ad breaks. Ad iframes: also matched (`all_frames`), EQ applies there too.
- **No UI injected into pages.** Options/popup live in extension pages → cosmetic filtering
  can't hide our UI (another reason the page is not the UI host).

### 2.7 Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `AudioContext` subclass breaks sites doing native-identity checks | site audio breaks | faithful subclass + `Object.defineProperty` passthrough; per-host kill-switch (R5); WebAudio interception ships behind a setting (M2 gate) |
| Dynamic / SPA-created media elements | new audio not equalized | `document`-level `play` capture listener + MutationObserver; wrap on first `play` |
| Iframe players (embeds, Discord) | missed audio | `all_frames: true`, `match_origin_as_fallback: true` |
| EME silence (DRM) | user thinks EQ is broken | detect silent analyser after 2s of playback → badge "not supported here", bypass element |
| Double amplification clipping | distorted sound | master gain default 1.0; sum-of-boosts warning in UI; optional compressor (R8 stretch) |
| Page detects/overwrites our patch | EQ silently off | re-install getter check on a timer (cheap), status ping from MAIN→UI |
| Android popup quirks | UI unreachable if popup-only | options page is first-class UI on every platform |
| Content blocker + our scripts on same page | perceived coupling, blame games | zero shared surface (§2.6); ship a diagnostics panel (M4) proving EQ state independently of blocker state; per-host kill-switch |

---

## 3. Architecture

```
┌────────── tab / page process ──────────┐      ┌──────── extension ────────┐
│ MAIN world: eq-main.js                 │      │                           │
│  • AudioContext subclass (v2)          │      │  background.js (MV3       │
│  • play-capture → media-element EQ     │◄────►│   event page)             │
│  • shared AudioContext + EQ chain      │ win. │   • routes messages       │
│  • status/telemetry ───────────────────┼ post │   • storage of active     │
│                                        │ Msg  │     gains + host rules    │
│ ISOLATED world: bridge.js ◄────────────┼─────►│   • onUpdated re-apply    │
│  • translate window.postMessage ↔      │runtime│   • badge state           │
│    browser.runtime messages            │      │                           │
└────────────────────────────────────────┘      │  options.html  (full EQ   │
                                                │   tuner + presets)        │
        audio graph (per page):                 │  popup.html   (quick     │
                                                │   enable + preset picker) │
   <video> ──► MediaElementSrcNode ─┐           │  common/eq.js  (DSP       │
   page AudioContext ─► [patched    ├──► input ─► BQ chain (10 bands)       │
      destination]      proxy path   │            ─► masterGain ─► real     │
                                      │            AnalyserNode(status) ─► ctx.destination
                                (per source: dedicated inputGain)
```

**Components**

- `content/eq-main.js` (MAIN world, `document_start`): installs `window.__fxEQ` state object;
  patches `window.AudioContext` (v2); listens for `play` in capture phase → creates one
  `MediaElementAudioSourceNode` per element into its own `inputGain`; owns one extension
  `AudioContext`; builds the EQ chain from current gains; replies to gain-update commands;
  reports sources/status via `postMessage`.
- `content/bridge.js` (ISOLATED world): dumb translator, `window` ↔ `browser.runtime`.
- `background.js`: source of truth for *effective settings* = `active gains`, `enabled`,
  `disabledHosts[]`; pushes to tabs on `tabs.sendMessage` and re-applies on
  `webNavigation.onCommitted`; keeps badge (on/off/unsupported) per tab.
- `ui/options.html` (+js/css): 10 vertical sliders, dB readouts, A/B bypass toggle, master
  gain, preset bar (**save** = name + current gains → `storage.local`; list / load / delete /
  rename), per-host rules list, export/import presets as JSON file.
- `ui/popup.html`: quick enable/disable for current tab, preset picker, link to options.
- `common/eq.js`: band table, node builder, clamp/validate helpers (shared UI↔content so a
  preset can never desync from the DSP graph).

**EQ DSP (v1):** standard 10-band ISO octave centers
`31.5, 63, 125, 250, 500, 1k, 2k, 4k, 8k, 16k` Hz;
`lowshelf(31.5) → peaking×8 (Q=1.04, octave widths) → highshelf(16k)`; gains `−12…+12 dB`;
cascaded biquads (per-band `inputGain` summing is v2 refinement if phase smear is disliked).
`AnalyserNode` after master for the status/telemetry path (DRM-silence detection, optional
simple meters in options page). CPU cost: ~10 biquads ≈ negligible.

## 4. Storage model (`browser.storage.local`, ~few KB)

```jsonc
{
  "version": 1,
  "settings": { "enabled": true, "disabledHosts": ["example.com"], "warnWebAudio": true },
  "active": { "gains": [0,0,0,0,0,0,0,0,0,0], "master": 1.0, "presetId": null },
  "presets": [ { "id": "p1", "name": "Podcast", "gains": [/*10*/], "master": 1,
                 "createdAt": "…", "updatedAt": "…" } ]
}
```

Desktop-only: write-through mirror of `settings` + `presets` to `storage.sync` (best-effort,
wrapped in feature check, ignored on Android). Portability (R6): JSON export/import of the
whole tree; JSON is the only format that survives Windows↔Android boundaries.

## 5. Message protocol (single envelope, versioned)

`{ v:1, type, payload }` — `GET_STATE` (UI→bg→content), `APPLY_EQ` (bg→content),
`STATUS` (content→bg→UI: sources[], ctxState, unsupported[]), `PRESET_CHANGED` (UI→bg broadcast).
Background is the only writer of storage; content scripts are stateless workers that apply
what they're told → UI and playback can never disagree.

## 6. Manifest skeleton

```jsonc
{
  "manifest_version": 3,
  "name": "Firefox Audio Equalizer", "version": "0.1.0",
  "browser_specific_settings": { "gecko": { "id": "equalizer@example.org",
                                           "strict_min_version": "128.0" } },
  "permissions": ["storage", "tabs", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": { "scripts": ["background.js"] },
  "action": { "default_popup": "ui/popup.html" },
  "options_ui": { "page": "ui/options.html", "open_in_tab": true },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content/eq-main.js"],
      "run_at": "document_start", "world": "MAIN" },
    { "matches": ["<all_urls>"], "js": ["common/eq.js", "content/bridge.js"],
      "run_at": "document_start", "all_frames": true, "match_origin_as_fallback": true }
  ],
  "icons": { "48": "icons/eq48.png", "96": "icons/eq96.png" }
}
```

No build step, no framework: vanilla JS + Web Components-free options page keeps the package
auditable and identical across platforms.

## 7. Milestones

| M | Scope | Verify (acceptance) |
|---|-------|---------------------|
| **M0** Scaffold | manifest, icons, empty options/popup, background logging | loads via `about:debugging` as temp add-on on Win desktop; no console errors |
| **M1** Core EQ path | MAIN play-capture wrap, shared ctx + resume-on-gesture, EQ chain, bridge, live sliders in options page | local fixture `test/fixtures/media.html` (looping wav) — sliders audibly change tone; YouTube tone changes; neutral preset ≈ bypass (null-test A/B) |
| **M1b** Blocker coexistence | same build with uBlock Origin installed and active | ads still blocked/skipped, EQ still applied before/during/after ad breaks, no errors in either extension's console |
| **M2** WebAudio interception | AudioContext subclass + destination proxy behind a settings toggle | `test/fixtures/webaudio.html` (oscillator demo) equalized; identity checks (`ctx instanceof AudioContext`) still pass |
| **M3** Presets + persistence | storage model, save/load/delete/rename, export/import JSON, per-host kill-switch, badge | preset survives browser restart, tab reload, second profile; import on Android applies |
| **M4** Hardening | DRM detection + bypass, re-assert patch, iframe players, error telemetry into options "diagnostics", CPU sanity (perf.log via `Performance` API) | embed-iframe player equalized; Netflix tab shows "unsupported" not silence; 10 tabs playback < 1% CPU delta |
| **M5** Release | `web-ext lint`, AMO unlisted sign, install signed xpi on Android via browser; README (dev + install paths) | `web-ext lint` 0 errors; signed xpi installs and works on Android + Win + macOS |

## 8. Project layout

```
firefox-audio-equalizer/
├─ manifest.json
├─ background.js
├─ common/   eq.js  messages.js
├─ content/  eq-main.js  bridge.js
├─ ui/       options.html|js|css  popup.html|js|css
├─ icons/    eq48.png eq96.png
├─ test/fixtures/  media.html  webaudio.html  (loopable wavs)
├─ plan.md  task.md
```

## 9. Testing & verification detail

- **Manual matrix:** M1/M3 flows on Win + macOS + Android(Fenix USB debug); sites: local
  fixtures, YouTube, SoundCloud, a `<video>` MP4, WebAudio demo, embedded YouTube iframe,
  one DRM site (expect "unsupported" path).
- **Blocker coexistence run (R9):** repeat YouTube tests with uBlock Origin installed —
  (a) default filters, (b) YouTube cookie opt-out dialog accepted, (c) mid-roll ad break
  skipped by uBO — EQ must remain applied across the transition and uBO must show ads blocked
  as before; also repeat with uBlock Origin Lite (MV3/declarativeNetRequest-only blocker) to
  cover the scriptlet-less variant.
- **Regression harness:** `test/fixtures/media.html` + options page + an `AnalyserNode` probe
  reading RMS per band while sweeping 31.5 Hz / 1 kHz / 16 kHz tones → assert per-band gain
  ordering (cheap, no audio libs needed).
- **`web-ext lint`** in CI-less loop (`npx web-ext lint`) gates every milestone.

## 10. Open decisions (defaults chosen; override any)

1. **Band count:** 10 ISO octaves (default) vs 15/31 bands — more bands = more CPU, marginal.
2. **Cascade vs parallel-sum biquads:** default cascade (simpler); revisit on phase complaints.
3. **Per-tab vs global gains:** default global setting + per-host disable list; per-tab EQ
   remembered is a v2 feature.
4. **Popup on desktop only** (options page everywhere) — or invest in Android popup testing.
5. Ship M2 (WebAudio patch) on by default or opt-in — plan ships opt-in, flip after M4 data.
