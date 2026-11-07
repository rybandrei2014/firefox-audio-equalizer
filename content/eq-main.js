"use strict";

// MAIN-world EQ engine (plan.md §3): runs in the page's JS context at
// document_start, before any page script. No browser.* APIs here — all
// messaging goes through content/bridge.js via window.postMessage.

(function (global) {
  if (global.__fxEQ && global.__fxEQ.installed) return;

  const Fx = global.FxEQ;
  const M = global.FxEQ_MSG;
  const NATIVE_AC = window.AudioContext; // captured before we ever patch

  const api = { installed: true, ctx: null, version: "0.1.0" };
  global.__fxEQ = api;

  // Effective settings mirrored from background (single source of truth).
  const S = { gains: Fx.zeros(), master: 1, enabled: true, mono: false, webAudioPatch: false };

  let ext = null; // our own ctx's EQ chain handle
  const pageChains = []; // EQ chains built inside patched page AudioContexts
  let patched = false;
  let reassertWanted = false;

  const sources = new Map(); // HTMLMediaElement -> {node, gain}
  const unsupported = new Map(); // HTMLMediaElement -> reason
  const pending = new Set(); // elements that failed to wrap, retry on tick
  const lastTimes = new Map(); // element -> last currentTime (progress detection)

  let silenceStreak = 0;
  let lastReportKey = "";
  let telemetryTimer = null;
  let armed = false;

  function post(type, payload) {
    try {
      window.postMessage({ __fxeq: true, dir: "main", type: type, payload: payload || {} }, "*");
    } catch (e) { /* detached frame */ }
  }

  function effectiveGains() {
    return S.enabled ? S.gains : Fx.zeros();
  }

  // ---- our own AudioContext + EQ chain (deferred until media exists) ----

  function ensureCtx() {
    if (ext) return true;
    if (!NATIVE_AC) return false;
    try {
      api.ctx = new NATIVE_AC();
      ext = Fx.buildEqChain(api.ctx, effectiveGains(), api.ctx.destination, S.enabled ? S.master : 1, S.enabled && S.mono);
      armResume();
      startTelemetry();
      return true;
    } catch (e) {
      api.ctx = null;
      ext = null;
      return false;
    }
  }

  function resumeCtx() {
    if (api.ctx && api.ctx.state === "suspended") {
      api.ctx.resume().then(() => report(true)).catch(() => {});
    }
  }

  // Autoplay policy (plan §2.4): resume on first user gesture, opportunistically.
  function armResume() {
    if (armed) return;
    armed = true;
    const r = () => resumeCtx();
    ["pointerdown", "keydown", "touchend"].forEach((t) =>
      window.addEventListener(t, r, { once: true, capture: true })
    );
  }

  // ---- media element routing (plan §2.1 source 1) ----

  function isRoutable(el) {
    // EME-protected media is silent through Web Audio by design — don't route.
    if (el.mediaKeys) return "drm";
    if (el.srcObject) return "media-stream";
    const src = el.currentSrc || el.src;
    if (!src) return null; // no source yet: routing is safe, will be same-origin
    try {
      const u = new URL(src, location.href);
      if (u.protocol === "blob:" || u.protocol === "data:") return null;
      if (u.origin !== location.origin) return "cross-origin";
    } catch (e) { /* unparseable: allow, try/catch guards */ }
    return null;
  }

  function markUnsupported(el, reason) {
    if (!unsupported.has(el)) {
      unsupported.set(el, reason);
      report(true);
    }
  }

  function wrap(el) {
    if (sources.has(el) || unsupported.has(el)) return;
    if (!S.enabled) return; // globally / per-host off: never reroute audio
    if (!ensureCtx()) {
      pending.add(el);
      return;
    }
    const skip = isRoutable(el);
    if (skip) {
      markUnsupported(el, skip);
      return;
    }
    try {
      const node = api.ctx.createMediaElementSource(el);
      const g = api.ctx.createGain();
      node.connect(g);
      g.connect(ext.input); // dedicated per-source inputGain (plan §3 graph)
      sources.set(el, { node: node, gain: g });
      pending.delete(el);
      resumeCtx();
      report(true);
    } catch (e) {
      // page already called createMediaElementSource on this element
      markUnsupported(el, "already-routed");
    }
  }

  // play doesn't bubble → capture-phase listener on document catches every element
  document.addEventListener("play", (e) => {
    const el = e.target;
    if (el instanceof HTMLMediaElement) {
      resumeCtx();
      wrap(el);
    }
  }, true);

  function scanNode(n) {
    if (!(n instanceof HTMLElement) && !(n instanceof HTMLMediaElement)) return;
    if (n instanceof HTMLMediaElement && !n.paused && !n.ended) wrap(n);
    if (n.querySelectorAll) {
      n.querySelectorAll("audio, video").forEach((el) => {
        if (!el.paused && !el.ended) wrap(el);
      });
    }
  }

  function scanAll() {
    document.querySelectorAll("audio, video").forEach((el) => {
      if (!el.paused && !el.ended) wrap(el);
    });
  }

  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.addedNodes) scanNode(n);
    }
  });
  function startObserver() {
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.documentElement) startObserver();
  else document.addEventListener("readystatechange", startObserver, { once: true });
  window.addEventListener("pageshow", scanAll); // bfcache resume: no new play events

  // ---- page AudioContext interception (M2, opt-in; plan §2.1 source 2) ----

  function patchPageContext(c) {
    try {
      const realDest = c.destination;
      const chain = Fx.buildEqChain(c, effectiveGains(), realDest, S.enabled ? S.master : 1, S.enabled && S.mono);
      pageChains.push(chain);
      Object.defineProperty(c, "destination", {
        configurable: true,
        get: function () { return chain.input; }
      });
    } catch (e) { /* site did something exotic; leave it unpatched */ }
  }

  function installPatch() {
    if (!NATIVE_AC) return;
    // already installed and nobody overwrote it
    if (patched && window.AudioContext === api.FxAC) return;
    patched = true;
    reassertWanted = true;
    function FxEqualizedAudioContext() {
      const c = new NATIVE_AC(...arguments);
      patchPageContext(c);
      return c;
    }
    // Faithful-enough subclass so `ctx instanceof AudioContext` still passes.
    FxEqualizedAudioContext.prototype = NATIVE_AC.prototype;
    try {
      Object.defineProperty(FxEqualizedAudioContext, "name", { value: "AudioContext", configurable: true });
    } catch (e) { /* some engines freeze function names */ }
    api.FxAC = FxEqualizedAudioContext;
    window.AudioContext = FxEqualizedAudioContext;
  }

  function uninstallPatch() {
    reassertWanted = false;
    if (patched && api.FxAC && window.AudioContext === api.FxAC) {
      window.AudioContext = NATIVE_AC;
    }
    patched = false;
  }

  // Cheap re-assert (plan §2.7 "page overwrites our patch"): checked per tick.
  function reassertPatch() {
    if (reassertWanted && (!patched || window.AudioContext !== api.FxAC)) installPatch();
  }

  // ---- APPLY_EQ from background (via bridge) ----

  function apply(payload) {
    const p = payload || {};
    S.gains = Fx.sanitizeGains(p.gains);
    S.master = Fx.sanitizeMaster(p.master);
    S.enabled = p.enabled !== false;
    S.mono = !!p.mono;
    S.webAudioPatch = !!p.webAudioPatch;

    if (S.webAudioPatch) installPatch();
    else uninstallPatch();

    if (S.enabled) {
      ensureCtx(); // have the graph ready so first play wraps immediately
      pending.forEach((el) => wrap(el));
    }
    if (ext) {
      ext.setGains(effectiveGains());
      ext.setMaster(S.enabled ? S.master : 1);
      ext.setMono(S.enabled && S.mono);
    }
    for (const c of pageChains) {
      c.setGains(effectiveGains());
      c.setMaster(S.enabled ? S.master : 1);
      c.setMono(S.enabled && S.mono);
    }
    report(true);
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__fxeq !== true || d.dir !== "bridge") return;
    // Page scripts can also post this; payloads are number-validated by Fx.sanitize*,
    // and there are no browser.* APIs here, so a forged APPLY_EQ cannot escalate.
    if (d.type === M.T.APPLY_EQ) apply(d.payload);
    else if (d.type === M.T.GET_STATE) { post(M.T.STATUS, statusPayload()); }
  });

  // ---- status telemetry (plan §3: AnalyserNode status path, DRM-silence detect) ----

  function statusPayload() {
    const list = [];
    let i = 0;
    for (const [el, reason] of unsupported) {
      if (i++ >= 12) break;
      let host = "";
      try { host = new URL(el.currentSrc || el.src || location.href).hostname; } catch (e) { /* noop */ }
      list.push({ tag: el.tagName.toLowerCase(), host: host, reason: reason });
    }
    let playing = 0;
    for (const el of sources.keys()) if (!el.paused && !el.ended) playing++;
    return {
      enabled: S.enabled,
      ctxState: api.ctx ? api.ctx.state : "none",
      sources: sources.size,
      playing: playing,
      unsupported: list,
      webAudioPatched: patched,
      suspectSilence: silenceStreak >= 1,
      rms: lastRms
    };
  }

  let lastRms = -1;

  function tick() {
    reassertPatch();
    if (pending.size) pending.forEach((el) => wrap(el));
    if (!api.ctx || api.ctx.state !== "running") {
      silenceStreak = 0;
      report(false);
      return;
    }
    // progress check: only suspect silence when media is actually advancing
    let advanced = 0;
    for (const el of sources.keys()) {
      if (el.paused || el.ended) { lastTimes.delete(el); continue; }
      const prev = lastTimes.get(el);
      if (prev != null && el.currentTime > prev + 0.05) advanced++;
      lastTimes.set(el, el.currentTime);
    }
    if (advanced > 0) {
      lastRms = Fx.rmsOf(ext.analyser);
      if (lastRms < 1e-4) silenceStreak++;
      else silenceStreak = 0;
    } else {
      silenceStreak = 0;
    }
    report(false);
  }

  function startTelemetry() {
    if (telemetryTimer != null) return;
    telemetryTimer = setInterval(tick, 2000);
  }

  function report(force) {
    const p = statusPayload();
    const key = JSON.stringify(p);
    if (!force && key === lastReportKey) return;
    lastReportKey = key;
    post(M.T.STATUS, p);
  }

  // Ask background for current settings on load (bridge also self-announces).
  post(M.T.READY, {});
  window.addEventListener("load", () => post(M.T.READY, {}));
})(globalThis);
