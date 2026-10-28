"use strict";

// Shared EQ DSP + validation (plan.md §3, §4).
// Loaded in background, MAIN-world content, ISOLATED content and UI pages,
// so a preset can never desync from the DSP graph.
(function (global) {
  // 10-band ISO octave centers: lowshelf -> 8x peaking -> highshelf.
  const BANDS = [
    { freq: 31.5, type: "lowshelf" },
    { freq: 63, type: "peaking", q: 1.04 },
    { freq: 125, type: "peaking", q: 1.04 },
    { freq: 250, type: "peaking", q: 1.04 },
    { freq: 500, type: "peaking", q: 1.04 },
    { freq: 1000, type: "peaking", q: 1.04 },
    { freq: 2000, type: "peaking", q: 1.04 },
    { freq: 4000, type: "peaking", q: 1.04 },
    { freq: 8000, type: "peaking", q: 1.04 },
    { freq: 16000, type: "highshelf" }
  ];

  const NB = BANDS.length;
  const GAIN_MIN = -12;
  const GAIN_MAX = 12;
  const MASTER_MIN = 0;
  const MASTER_MAX = 2;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function zeros() {
    return new Array(NB).fill(0);
  }

  function clampGain(v) {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, GAIN_MIN, GAIN_MAX) : 0;
  }

  function sanitizeGains(arr) {
    if (!Array.isArray(arr)) return zeros();
    const out = new Array(NB);
    for (let i = 0; i < NB; i++) out[i] = clampGain(arr[i]);
    return out;
  }

  function sanitizeMaster(v) {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, MASTER_MIN, MASTER_MAX) : 1;
  }

  function validPreset(p) {
    return (
      p &&
      typeof p.id === "string" && p.id.length > 0 && p.id.length < 64 &&
      typeof p.name === "string" && p.name.length > 0 && p.name.length < 80 &&
      Array.isArray(p.gains) && p.gains.length === NB
    );
  }

  function normalizePreset(p) {
    const now = new Date().toISOString();
    return {
      id: p.id,
      name: p.name,
      gains: sanitizeGains(p.gains),
      master: sanitizeMaster(p.master),
      createdAt: p.createdAt || now,
      updatedAt: p.updatedAt || now
    };
  }

  function setSmooth(param, value, ctx) {
    // setTargetAtTime avoids zipper noise / clicks on live audio (R7).
    if (param.setTargetAtTime) {
      param.setTargetAtTime(value, ctx.currentTime, 0.015);
    } else {
      param.value = value;
    }
  }

  // Builds: input -> [biquad cascade] -> master -> analyser -> outputNode.
  // Returns a handle that can update gains live without rebuilding.
  function buildEqChain(ctx, gains, outputNode, master) {
    const g = sanitizeGains(gains);
    const input = ctx.createGain();
    const filters = [];
    let node = input;
    for (let i = 0; i < NB; i++) {
      const f = ctx.createBiquadFilter();
      f.type = BANDS[i].type;
      f.frequency.value = BANDS[i].freq;
      if (BANDS[i].q) f.Q.value = BANDS[i].q;
      f.gain.value = g[i];
      node.connect(f);
      node = f;
      filters.push(f);
    }
    const masterGain = ctx.createGain();
    masterGain.gain.value = sanitizeMaster(master);
    node.connect(masterGain);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    masterGain.connect(analyser);
    analyser.connect(outputNode);
    return {
      input: input,
      filters: filters,
      master: masterGain,
      analyser: analyser,
      setGains: function (g2, smooth) {
        const arr = sanitizeGains(g2);
        for (let i = 0; i < NB; i++) {
          if (smooth === false) filters[i].gain.value = arr[i];
          else setSmooth(filters[i].gain, arr[i], ctx);
        }
      },
      setMaster: function (m, smooth) {
        if (smooth === false) masterGain.gain.value = sanitizeMaster(m);
        else setSmooth(masterGain.gain, sanitizeMaster(m), ctx);
      }
    };
  }

  // RMS of an analyser's time-domain signal (for DRM/silence detection).
  function rmsOf(analyser) {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  global.FxEQ = {
    BANDS: BANDS,
    NB: NB,
    GAIN_MIN: GAIN_MIN,
    GAIN_MAX: GAIN_MAX,
    MASTER_MIN: MASTER_MIN,
    MASTER_MAX: MASTER_MAX,
    zeros: zeros,
    clamp: clamp,
    clampGain: clampGain,
    sanitizeGains: sanitizeGains,
    sanitizeMaster: sanitizeMaster,
    validPreset: validPreset,
    normalizePreset: normalizePreset,
    buildEqChain: buildEqChain,
    rmsOf: rmsOf
  };
})(globalThis);
