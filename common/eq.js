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

  // Built-in recommended presets — 50 curves extracted from SoundForge-Equalizer
  // https://github.com/Maximka1993271/SoundForge-Equalizer (MIT, Maxim Melnikov),
  // Firefox/modules/config.js. Gains mapped 1:1 to our ISO band order
  // [31.5,63,125,250,500,1k,2k,4k,8k,16k]; master 1.0 = their 100% volume
  // (their extra "bass" 100Hz shelf node is not part of the 10-band gains).
  const RECOMMENDED = [
    // 🎵 Main
    { cat: "Main", name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], master: 1.0 },
    { cat: "Main", name: "Natural", gains: [0.5, 1, 1.5, 1, 0.5, 0, 0.5, 1, 1.5, 1], master: 1.0 },
    { cat: "Main", name: "Universal", gains: [1.5, 2, 2, 1.5, 0.5, 0.5, 1, 1.5, 2, 1.5], master: 1.0 },
    { cat: "Main", name: "Balanced", gains: [1, 1.5, 1.5, 1, 0.5, 0.5, 1, 1, 1.5, 1], master: 1.0 },
    // 🎶 Electronic
    { cat: "Electronic", name: "Club", gains: [4, 5, 4, 2, -0.5, 0.5, 1.5, 2.5, 3, 2.5], master: 1.0 },
    { cat: "Electronic", name: "Dance", gains: [3.5, 4.5, 3.5, 1.5, 0, 1, 2, 3, 3.5, 3], master: 1.0 },
    { cat: "Electronic", name: "EDM", gains: [4.5, 5.5, 4, 1.5, -1, 0.5, 2.5, 3.5, 4, 3.5], master: 1.0 },
    { cat: "Electronic", name: "Synthwave", gains: [2.5, 3.5, 3, 1.5, -0.5, 1, 2, 2.5, 3, 2.5], master: 1.0 },
    { cat: "Electronic", name: "Deep House", gains: [3.5, 4.5, 3.5, 1.5, 0, 0.5, 1.5, 2, 2.5, 2], master: 1.0 },
    { cat: "Electronic", name: "Festival", gains: [5, 6, 5, 2.5, 0.5, 1, 2.5, 3.5, 4.5, 4], master: 1.0 },
    // 🎸 Rock / Metal
    { cat: "Rock / Metal", name: "Rock", gains: [2.5, 3, 2.5, 1, -0.5, 1, 2.5, 3.5, 4, 3], master: 1.0 },
    { cat: "Rock / Metal", name: "Metal", gains: [3.5, 4, 3, 0.5, -2, 0.5, 3, 4.5, 5, 4], master: 1.0 },
    { cat: "Rock / Metal", name: "Hard Rock", gains: [3, 3.5, 2.5, 1, -1, 1, 3, 4, 4.5, 3.5], master: 1.0 },
    { cat: "Rock / Metal", name: "Grunge", gains: [2, 2.5, 2, 1, -0.5, 0.5, 2, 3, 3, 2], master: 1.0 },
    // 🎤 Vocal / Podcast
    { cat: "Vocal / Podcast", name: "Vocal", gains: [-3, -1.5, -0.5, 1, 2, 3.5, 3, 2, 1, 0.5], master: 1.0 },
    { cat: "Vocal / Podcast", name: "Podcast", gains: [-4, -2.5, -1, 1, 2.5, 4, 3.5, 2.5, 1, 0], master: 1.0 },
    { cat: "Vocal / Podcast", name: "Speech", gains: [-5, -3.5, -1.5, 0.5, 2.5, 4.5, 4, 3, 1, 0], master: 1.0 },
    { cat: "Vocal / Podcast", name: "Rap", gains: [3.5, 4, 2.5, 1, -0.5, 1, 2, 3, 3.5, 2.5], master: 1.0 },
    // 🎻 Acoustic / Classical
    { cat: "Acoustic / Classical", name: "Acoustic", gains: [0, 0.5, 1, 1.5, 2, 2.5, 2, 1.5, 1, 0.5], master: 1.0 },
    { cat: "Acoustic / Classical", name: "Piano", gains: [-1, -0.5, 0, 1, 2, 3, 3.5, 2.5, 2, 1.5], master: 1.0 },
    { cat: "Acoustic / Classical", name: "Orchestra", gains: [0.5, 1, 1, 1.5, 1.5, 2, 2, 1.5, 1, 0.5], master: 1.0 },
    { cat: "Acoustic / Classical", name: "Classical", gains: [0, 0.5, 0.5, 0.5, 1, 1.5, 1.5, 1, 0.5, 0.5], master: 1.0 },
    { cat: "Acoustic / Classical", name: "Jazz", gains: [1, 1.5, 2, 1.5, 1, 1.5, 2, 1.5, 1, 0.5], master: 1.0 },
    // 🎧 Special
    { cat: "Special", name: "Headphones", gains: [1, 1.5, 1.5, 1, 0.5, 0.5, 1, 1.5, 2, 1.5], master: 1.0 },
    { cat: "Special", name: "Car", gains: [3.5, 4.5, 3.5, 1.5, 0, 0.5, 1.5, 2, 3, 2.5], master: 1.0 },
    { cat: "Special", name: "Night", gains: [-1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5, -1, -1.5], master: 1.0 },
    { cat: "Special", name: "Bass boost (Max Bass)", gains: [6, 7, 5, 2.5, 0, 0.5, 0.5, 0.5, 1, 0.5], master: 1.0 },
    { cat: "Special", name: "Full Bass & Treble", gains: [5, 4.5, 2.5, 0, -1.5, -1, 0.5, 2.5, 4.5, 5.5], master: 1.0 },
    { cat: "Special", name: "Pop", gains: [1, 1.5, 1.5, 1, 1.5, 2.5, 3, 2.5, 2, 1.5], master: 1.0 },
    { cat: "Special", name: "K-Pop", gains: [2.5, 3, 2.5, 1.5, 1, 2, 3, 3.5, 4, 3.5], master: 1.0 },
    { cat: "Special", name: "World", gains: [1.5, 2, 2, 1.5, 1, 2, 2, 1.5, 1, 0.5], master: 1.0 },
    { cat: "Special", name: "Ambient", gains: [0.5, 1, 1.5, 1.5, 1.5, 2, 2.5, 2.5, 3, 2.5], master: 1.0 },
    { cat: "Special", name: "Hip-Hop", gains: [4.5, 5.5, 4, 2, -0.5, 1, 2, 2.5, 3.5, 3], master: 1.0 },
    { cat: "Special", name: "Soul", gains: [2.5, 3, 2.5, 2, 1.5, 2, 1.5, 1, 0.5, 0], master: 1.0 },
    { cat: "Special", name: "Blues", gains: [1.5, 2, 2, 1.5, 1, 1.5, 2, 1.5, 1, 0.5], master: 1.0 },
    { cat: "Special", name: "Reggae", gains: [3.5, 4, 3.5, 2, 0.5, 1, 1.5, 2, 2.5, 2], master: 1.0 },
    { cat: "Special", name: "Chill", gains: [1, 1.5, 1.5, 1, 0.5, 0.5, 1, 1, 0.5, 0], master: 1.0 },
    { cat: "Special", name: "Lo-Fi", gains: [1, 1.5, 1, 0.5, 0, -0.5, -1.5, -2.5, -3.5, -4.5], master: 1.0 },
    { cat: "Special", name: "Sunset", gains: [0.5, 1, 1, 0.5, 0, 0.5, 0.5, 0.5, 0, -0.5], master: 1.0 },
    { cat: "Special", name: "Clarity", gains: [-1.5, -0.5, 0, 0.5, 1, 2.5, 4, 4.5, 3.5, 2.5], master: 1.0 },
    // 🌊 Wave / Phonk
    { cat: "Wave / Phonk", name: "Wave", gains: [5.5, 6.5, 4.5, 1.5, -1.5, -0.5, 0.5, 2, 3.5, 4], master: 1.0 },
    { cat: "Wave / Phonk", name: "Phonk", gains: [7, 8, 5.5, 2, -2.5, -1.5, 0, 2, 4.5, 5], master: 1.0 },
    // ⚡ MAX BOOST
    { cat: "MAX BOOST", name: "Logitech G321", gains: [3, 3.5, 2.5, 1.5, 0.5, 1, 2, 2.5, 3, 2.5], master: 1.0 },
    { cat: "MAX BOOST", name: "MAX BOOST", gains: [4, 5, 3.5, 2, 1, 1, 2, 2.5, 3, 2.5], master: 1.0 },
    // 🎮 Gaming / Movie
    { cat: "Gaming / Movie", name: "Gaming", gains: [2, 2.5, 2, 1, 0.5, 1.5, 3, 4, 4.5, 3.5], master: 1.0 },
    { cat: "Gaming / Movie", name: "Movie", gains: [3.5, 4, 3.5, 2, 1, 1.5, 2, 2.5, 3, 2.5], master: 1.0 },
    { cat: "Gaming / Movie", name: "FPS", gains: [-1, -0.5, 0, 0.5, 1.5, 3, 4.5, 5.5, 5, 4], master: 1.0 },
    // 🌟 Premium
    { cat: "Premium", name: "Hi-Fi", gains: [0.5, 1, 1, 0.5, 0.5, 0.5, 1, 1.5, 2, 1.5], master: 1.0 },
    { cat: "Premium", name: "Studio", gains: [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], master: 1.0 },
    { cat: "Premium", name: "Premium", gains: [1.5, 2, 1.5, 1, 0.5, 1, 1.5, 2, 2.5, 2], master: 1.0 },
    { cat: "Premium", name: "Master", gains: [1, 1.5, 1, 0.5, 0.5, 1, 1.5, 2, 2.5, 2], master: 1.0 }
  ];

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

  // mono downmix via a 4-gain L/R cross matrix (kept in-graph so toggling
  // Mono never rebuilds the audio graph).
  function setMonoGains(mg, on, ctx, smooth) {
    const v = on ? [0.5, 0.5, 0.5, 0.5] : [1, 0, 0, 1]; // [LL, LR, RL, RR]
    const p = [mg.gLL.gain, mg.gLR.gain, mg.gRL.gain, mg.gRR.gain];
    for (let i = 0; i < 4; i++) {
      if (smooth === false) p[i].value = v[i];
      else setSmooth(p[i], v[i], ctx);
    }
  }

  function setMonoGains(mg, on, ctx, smooth) {
    const v = on ? [0.5, 0.5, 0.5, 0.5] : [1, 0, 0, 1]; // [LL, LR, RL, RR]
    const p = [mg.gLL.gain, mg.gLR.gain, mg.gRL.gain, mg.gRR.gain];
    for (let i = 0; i < 4; i++) {
      if (smooth === false) p[i].value = v[i];
      else setSmooth(p[i], v[i], ctx);
    }
  }

  // Builds: input -> [biquad cascade] -> master -> [mono downmix] -> analyser -> outputNode.
  // The mono stage is always present (4 gains switched 1/0 <-> 0.5), so toggling
  // Mono never rebuilds the graph.
  // Returns a handle that can update gains live without rebuilding.
  function buildEqChain(ctx, gains, outputNode, master, mono) {
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
    // mono stage: out_L = gLL*in_L + gLR*in_R, out_R = gRL*in_L + gRR*in_R.
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const gLL = ctx.createGain();
    const gLR = ctx.createGain();
    const gRL = ctx.createGain();
    const gRR = ctx.createGain();
    masterGain.connect(splitter);
    splitter.connect(gLL, 0);
    splitter.connect(gLR, 1);
    splitter.connect(gRL, 0);
    splitter.connect(gRR, 1);
    gLL.connect(merger, 0, 0);
    gLR.connect(merger, 0, 0);
    gRL.connect(merger, 0, 1);
    gRR.connect(merger, 0, 1);
    const monoG = { gLL: gLL, gLR: gLR, gRL: gRL, gRR: gRR };
    setMonoGains(monoG, !!mono, ctx, false);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    merger.connect(analyser);
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
      },
      setMono: function (on, smooth) {
        setMonoGains(monoG, !!on, ctx, smooth);
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
    RECOMMENDED: RECOMMENDED,
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
