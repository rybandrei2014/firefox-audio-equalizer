"use strict";

// Standalone diagnostic: a page script claims the element (this is exactly
// what the extension must handle as "already-routed"). If the extension is
// installed, this throws and reports it — proving routing ownership.
document.getElementById("probeBtn").addEventListener("click", () => {
  const msg = document.getElementById("probeMsg");
  const ctx = new AudioContext();
  let src;
  try {
    src = ctx.createMediaElementSource(document.getElementById("player"));
  } catch (e) {
    msg.textContent =
      "createMediaElementSource refused: the extension already owns this element " +
      "(expected with extension active). Use options -> Diagnostics instead.";
    return;
  }
  const an = ctx.createAnalyser();
  src.connect(an);
  an.connect(ctx.destination);
  const buf = new Float32Array(an.fftSize);
  setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    document.getElementById("meterFill").style.width = Math.min(100, rms * 400) + "%";
  }, 100);
  msg.textContent = "Probe running — meter shows element RMS.";
});
