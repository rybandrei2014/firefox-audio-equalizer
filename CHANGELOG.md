# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Release notes for GitHub Releases are taken from the matching `## [vX.Y.Z]` section below (see `.github/workflows/release.yml`).

## [Unreleased]

## [v0.1.0] - 2026-11-07

### Added

- Real-time 10-band parametric EQ for any Firefox tab's audio, built entirely on the Web Audio
  API inside the page (MAIN-world content script + isolated bridge). ISO octave centers
  (31.5 Hz → 16 kHz), low-shelf + 8 peaking (Q≈1.04) + high-shelf, ±12 dB per band.
- Classic Realtek-style editor widget (`ui/eq-widget.js`) that opens as the toolbar-popup modal:
  ON|OFF, master preamp, live frequency-response curve, Mono downmix, whole-dB Snap, preset
  picker, night mode, and A/B compare. Also embedded on the options page.
- Presets: 50+ recommended curves plus save/load/rename/delete of your own, persisted to
  `storage.local`; the dropdown marks the active preset by matching the curve.
- Per-site kill-switch, global enable, and an opt-in Web Audio interception for a page's own graphs.
- DRM/EME silence detection + bypass, per-tab badge (on/off/unsupported), and an options-page
  diagnostics panel.
- Mono downmix via an always-on gain matrix (toggling Mono never rebuilds the graph).
- JSON export/import — the only format that survives Windows ↔ macOS ↔ Android transfers.
- CI: `test/eq-smoke.cjs` (background load-clean + DSP invariants against a mock AudioContext),
  `tools/build.ps1`, and `.github/workflows/release.yml` (build → `web-ext lint` → optional AMO
  signing → GitHub Release with the xpi attached). See `docs/DISTRIBUTION.md`.

[Unreleased]: https://github.com/rybandrei2014/firefox-audio-equalizer/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/rybandrei2014/firefox-audio-equalizer/releases/tag/v0.1.0
