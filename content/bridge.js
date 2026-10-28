"use strict";

// ISOLATED-world translator (plan.md §2.2/§3): dumb bridge between
// window.postMessage (MAIN world) and browser.runtime (background).

(function (global) {
  "use strict";
  const M = global.FxEQ_MSG;
  if (global.__fxEQ_bridge) return;
  global.__fxEQ_bridge = true;

  function relay(msg) {
    try {
      window.postMessage({ __fxeq: true, dir: "bridge", type: msg.type, payload: msg.payload }, "*");
    } catch (e) { /* detached frame */ }
  }

  // MAIN -> background (READY, STATUS); reply (APPLY_EQ) goes back to MAIN.
  window.addEventListener("message", (ev) => {
    if (ev.source !== global) return;
    const d = ev.data;
    if (!d || d.__fxeq !== true || d.dir !== "main" || typeof d.type !== "string") return;
    const msg = M.envelope(d.type, d.payload);
    browser.runtime.sendMessage(msg).then((reply) => {
      if (M.isEnvelope(reply)) relay(reply);
    }).catch(() => { /* background asleep/unavailable; it re-pushes on navigation */ });
  });

  // background -> MAIN (APPLY_EQ pushes)
  browser.runtime.onMessage.addListener((msg) => {
    if (M.isEnvelope(msg)) relay(msg);
  });

  // Announce ourselves at document_start so background pushes effective settings
  // immediately (MAIN's own READY may fire before this listener exists).
  browser.runtime
    .sendMessage(M.envelope(M.T.READY, {}))
    .then((reply) => {
      if (M.isEnvelope(reply)) relay(reply);
    })
    .catch(() => {});
})(globalThis);
