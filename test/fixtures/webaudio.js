"use strict";

// AudioContext is created lazily on Play so the extension's APPLY_EQ round-trip
// (which installs the patch at document_start) has definitely completed.
let ctx = null;
let gain = null;
let osc = null;
let freq = 31.5;

function ensureCtx() {
  if (ctx) return;
  ctx = new AudioContext();
  gain = ctx.createGain();
  gain.gain.value = 0.25;
  // page-side graph ends at ctx.destination — intercepted when patched
  gain.connect(ctx.destination);
  reportIdentity();
}

function play() {
  ensureCtx();
  stop();
  osc = ctx.createOscillator();
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start();
}

function stop() {
  if (osc) {
    try { osc.stop(); } catch (e) { /* already stopped */ }
    osc = null;
  }
}

document.getElementById("playBtn").addEventListener("click", () => {
  ensureCtx();
  ctx.resume().then(play);
});
document.getElementById("stopBtn").addEventListener("click", stop);
document.querySelectorAll("button[data-f]").forEach((b) =>
  b.addEventListener("click", () => {
    freq = parseFloat(b.dataset.f);
    document.querySelectorAll("button[data-f]").forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel");
    if (osc) osc.frequency.value = freq;
  })
);

function reportIdentity() {
  document.getElementById("ident").textContent = ctx instanceof AudioContext;
  document.getElementById("ctor").textContent = ctx.constructor.name;
  let intercepted = "n/a";
  try {
    const realDest = Object.getOwnPropertyDescriptor(AudioContext.prototype, "destination").get.call(ctx);
    intercepted = ctx.destination === realDest ? "native" : "INTERCEPTED (EQ in path)";
  } catch (e) { /* exotic engine */ }
  document.getElementById("destType").textContent =
    ctx.destination.constructor.name + " (" + intercepted + ")";
}
