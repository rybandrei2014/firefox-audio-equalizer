# Release & distribution

## Release checklist

1. Bump `version` in `manifest.json` and add a `## [vX.Y.Z] - YYYY-MM-DD` section to
   `CHANGELOG.md` (Keep a Changelog format — the release workflow copies that exact section
   into the GitHub Release notes). The build warns if `CHANGELOG.md` has no `[vX.Y.Z]` entry.
2. `node test/eq-smoke.cjs` (no network; must exit 0).
3. `powershell tools/build.ps1` → `dist/firefox-audio-equalizer-<version>.xpi`
   (it stages only runtime files into `dist/staging/` and zips that with forward-slash entries).
4. `git commit -am "vX.Y.Z: ..." && git tag vX.Y.Z && git push --follow-tags`
   → `.github/workflows/release.yml` runs the checks + `web-ext lint`, builds the xpi, signs it
   with AMO if `AMO_API_KEY`/`AMO_API_SECRET` repo secrets exist, and publishes a GitHub Release
   with the xpi attached.

Unsigned xpis **cannot** be installed in normal Firefox releases — signing is what makes
self-hosted distribution viable. Set repo secrets: `AMO_API_KEY` = AMO **JWT issuer**
(e.g. `user:1234567:890`), `AMO_API_SECRET` = AMO **JWT secret** — both from the AMO
[Developer Credentials](https://addons.mozilla.org/developers/addon/api/key/) page. Type the
secret **names** by hand and the values into the Value field (pasted names can carry invisible
characters that make GitHub reject them; an issuer pasted into the Name box fails the same way).

The add-on id is `rybandrei2014+firefox-audio-eq@gmail.com` (Gmail ignores `+tags`, so it
delivers to the same inbox and stays unique per add-on). Keep this id stable — AMO updates only
work under the same id, and a new id means a new listing.

## Layout note

The add-on lives at the **repo root** (manifest.json, background.js, common/, content/, ui/,
icons/). `tools/build.ps1` copies only those runtime files into `dist/staging/` and both the
xpi and `web-ext lint`/`web-ext sign --source-dir` run against that staging copy, so `test/`,
`docs/`, `*.md`, and the icon generator never ship.

## Distribution channels

| Channel | Auto-updates | Effort | Notes |
|---|---|---|---|
| AMO listing (addons.mozilla.org) | yes | one review per version (usually minutes–hours, automated first pass) | best reach; users click "Add to Firefox"; version updates via re-upload |
| GitHub Release, unlisted-signed xpi | no (manual re-download) | CI signs automatically | users: `about:add-ons` → gear → Install Add-on From File |
| Temporary add-on (`about:debugging`) | no | none | development only |

Recommended: publish to **AMO as "listed"** (primary) and keep CI attaching the same signed xpi
to GitHub Releases (fallback). With `AMO_API_KEY`/`AMO_API_SECRET` set, CI can even submit for
review automatically — change `--channel unlisted` to `--channel listed` in `release.yml`.
Firefox for Android can only install AMO-listed or AMO-signed add-ons, so listed-on-AMO is the
practical Android path.

## Policy sanity (reviewer-facing)

This add-on equalizes **the page's own Web Audio**; it does **not** touch protected media.
- It contains **no DRM circumvention**: EME-protected media is explicitly detected and left
  unrouted (the badge reports "not supported" rather than producing silence), which is the
  opposite of bypassing protection.
- **No remote code / no eval**: all DSP is static Web Audio nodes shipped in the package.
- Permissions are the minimum the model needs: `storage`, `tabs`, `webNavigation` + `<all_urls>`
  host (required to reach media elements on any site). No telemetry; `data_collection_permissions`
  is `none`.

If a reviewer flags the host permission, that is the rationale to point at.

## If a site's audio breaks

Sites that already call `createMediaElementSource` themselves, or exotic audio graphs, can
conflict. The kill-switch handles it: add the host (popup toggle or the options per-site list)
and that page is never rerouted. The per-tab badge + options diagnostics panel show EQ state
independently of the site, so "is it us or the site?" is answerable. Fix flow if code must
change: patch, bump version, `eq-smoke` must pass, ship — AMO auto-delivers to listed installs.
