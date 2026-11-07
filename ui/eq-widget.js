"use strict";

/* global FxEQ */

// Classic Realtek-style EQ editor widget (ui/eq-widget.css), matching
// g:\snapper\output\audio-equalizer.png:
//  - top band: ON|OFF + flatten buttons, live response curve, ↻ ? ♥ icons
//  - Preamp + 10 ISO-band vertical sliders (blue fill, round thumb, ticks)
//  - bottom bar: Mono / Snap checkboxes, preset dropdown, ↻ randomize, 🌙 night, A A/B
// Controlled component: the parent owns state and persistence; the widget only
// renders and reports intent through the callbacks in `opts`.
(function (global) {
  const Fx = global.FxEQ;
  const NB = Fx.NB;
  const PAD = 8; // slider travel inset in px (matches CSS)
  const HELP =
    "ON|OFF — enable the equalizer everywhere.\n" +
    "⇆ — flatten all sliders.\n" +
    "↻ (top) — reload state; ↻ (bottom) — randomize curve.\n" +
    "♥ — save current curve as a preset.\n" +
    "Mono — downmix to mono. Snap — snap sliders to whole dB.\n" +
    "🌙 — night mode. A — A/B: compare against flat EQ.";

  function masterToDb(m) {
    return Fx.clamp(20 * Math.log10(Math.max(m, 1e-4)), Fx.GAIN_MIN, Fx.GAIN_MAX);
  }

  function dbToMaster(db) {
    return Fx.sanitizeMaster(Math.pow(10, db / 20));
  }

  function hzLabel(hz) {
    // Display uses the nominal ISO octave names (matches reference UI).
    const disp = { 31.5: "32", 63: "64" };
    if (disp[hz]) return disp[hz];
    return hz >= 1000 ? hz / 1000 + "k" : String(hz);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  class FxEqWidget {
    constructor(root, opts) {
      this.o = opts || {};
      this.root = root;
      this.dragging = false;
      this.st = {
        gains: Fx.zeros(),
        master: 1,
        enabled: true,
        mono: false,
        snap: true,
        theme: "light",
        ab: false
      };
      this.curves = []; // {group, name, gains, master, presetId}
      this.bq = null; // offline ctx filter chain for the preview curve
      this._build();
      this._reflect();
      this._scheduleCurve();
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => this._scheduleCurve()).observe(this.curveWrap);
      }
    }

    // ---------- DOM ----------

    _build() {
      const w = el("div", "fxeqw");
      w.dataset.theme = this.st.theme;
      this.w = w;

      // top band
      const top = el("div", "eqw-top");

      const power = el("div", "eqw-power");
      const onOff = el("div", "eqw-onoff");
      this.btnOn = el("button", null, "ON");
      this.btnOn.title = "Enable equalizer";
      this.btnOn.setAttribute("aria-pressed", "true");
      this.btnOn.addEventListener("click", () => this._fireSetting("enabled", true));
      this.btnOff = el("button", null, "OFF");
      this.btnOff.title = "Disable equalizer everywhere";
      this.btnOff.setAttribute("aria-pressed", "false");
      this.btnOff.addEventListener("click", () => this._fireSetting("enabled", false));
      onOff.append(this.btnOn, el("span", "eqw-sep", "|"), this.btnOff);
      const flat = el("button", "eqw-flatbtn", "⇆");
      flat.title = "Flatten all sliders";
      flat.addEventListener("click", () => {
        this.st.gains = Fx.zeros();
        this.st.master = 1;
        this._reflectSliders();
        this._fireGains();
      });
      power.append(onOff, flat);

      this.curveWrap = el("div", "eqw-curveWrap");
      this.canvas = el("canvas");
      this.curveWrap.append(
        this.canvas,
        el("span", "eqw-dbc tl", "+" + Fx.GAIN_MAX + "  db"),
        el("span", "eqw-dbc tr", "+" + Fx.GAIN_MAX + "  db"),
        el("span", "eqw-dbc bl", Fx.GAIN_MIN + "  db"),
        el("span", "eqw-dbc br", Fx.GAIN_MIN + "  db")
      );

      const icons = el("div", "eqw-iconCol");
      const iRefresh = el("button", "eqw-icon", "↻");
      iRefresh.title = "Reload state from storage";
      iRefresh.addEventListener("click", () => this.o.onRefresh && this.o.onRefresh());
      const iHelp = el("button", "eqw-icon", "?");
      iHelp.title = "Help";
      iHelp.addEventListener("click", () => {
        if (this.o.onHelp) this.o.onHelp();
        else global.alert(HELP);
      });
      const iFav = el("button", "eqw-icon", "♥");
      iFav.title = "Save current curve as a preset";
      iFav.addEventListener("click", () => this.o.onSavePreset && this.o.onSavePreset());
      icons.append(iRefresh, iHelp, iFav);

      top.append(power, this.curveWrap, icons);

      // sliders
      const sliders = el("div", "eqw-sliders");
      this.sliders = [];
      const labels = ["Preamp"].concat(Fx.BANDS.map((b) => hzLabel(b.freq)));
      for (let i = 0; i <= NB; i++) {
        const col = el("div", "eqw-col");
        const sl = el("div", "eqw-slider");
        const groove = el("span", "eqw-groove");
        const fill = el("span", "eqw-fill");
        const thumb = el("span", "eqw-thumb");
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(Fx.GAIN_MIN);
        input.max = String(Fx.GAIN_MAX);
        input.step = "0.5";
        input.value = "0";
        input.setAttribute("orient", "vertical");
        input.setAttribute("aria-label", labels[i] === "Preamp" ? "Preamp gain" : labels[i] + " Hz gain");
        sl.append(groove, fill, thumb, input);
        const lbl = el("span", "eqw-lbl", labels[i]);
        col.append(sl, lbl);
        sliders.append(col);
        const rec = { input, fill, thumb, sl };
        this.sliders.push(rec);
        this._bindSlider(rec, i);
      }

      // bottom bar
      const bot = el("div", "eqw-bottom");
      this.chkMono = document.createElement("input");
      this.chkMono.type = "checkbox";
      this.chkMono.addEventListener("change", () => this._fireSetting("mono", this.chkMono.checked));
      const lMono = el("label", "eqw-check");
      lMono.append(this.chkMono, el("span", null, "Mono"));

      this.chkSnap = document.createElement("input");
      this.chkSnap.type = "checkbox";
      this.chkSnap.addEventListener("change", () => this._fireSetting("snap", this.chkSnap.checked));
      const lSnap = el("label", "eqw-check");
      lSnap.append(this.chkSnap, el("span", null, "Snap"));

      this.sel = el("select");
      this.sel.title = "Apply a preset";
      this.sel.addEventListener("change", () => {
        const idx = this.sel.selectedIndex;
        if (idx <= 0) return;
        const item = this.curves[idx - 1];
        if (item && this.o.onPreset) this.o.onPreset(item);
        this.sel.selectedIndex = 0;
      });

      const rnd = el("button", "eqw-icon", "↻");
      rnd.title = "Randomize curve";
      rnd.addEventListener("click", () => this._randomize());
      const night = el("button", "eqw-icon", "☾");
      night.title = "Toggle night mode";
      night.addEventListener("click", () => this._fireSetting("theme", this.st.theme === "dark" ? "light" : "dark"));
      this.btnAB = el("button", "eqw-icon", "A");
      this.btnAB.title = "A/B: compare against flat EQ";
      this.btnAB.addEventListener("click", () => this.o.onAB && this.o.onAB(!this.st.ab));
      bot.append(lMono, lSnap, el("span", "eqw-div"), this.sel, rnd, night, this.btnAB);

      w.append(top, sliders, bot);
      this.root.innerHTML = "";
      this.root.append(w);

      this._buildPresetSelect();
    }

    _bindSlider(rec, idx) {
      const { input, sl } = rec;
      input.addEventListener("input", () => {
        if (!this.dragging) this._fromSlider(idx);
      });
      const moveTo = (clientY) => {
        const r = sl.getBoundingClientRect();
        const t = (r.bottom - PAD - clientY) / (r.height - 2 * PAD);
        let v = Fx.GAIN_MIN + Fx.clamp(t, 0, 1) * (Fx.GAIN_MAX - Fx.GAIN_MIN);
        v = this.st.snap ? Math.round(v) : Math.round(v / 0.5) * 0.5;
        v = Fx.clampGain(v);
        if (parseFloat(input.value) === v) return;
        input.value = String(v);
        this._fromSlider(idx);
      };
      input.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.dragging = true;
        input.setPointerCapture(e.pointerId);
        moveTo(e.clientY);
        const mv = (ev) => moveTo(ev.clientY);
        const up = () => {
          this.dragging = false;
          input.removeEventListener("pointermove", mv);
          input.removeEventListener("pointerup", up);
          input.removeEventListener("pointercancel", up);
        };
        input.addEventListener("pointermove", mv);
        input.addEventListener("pointerup", up);
        input.addEventListener("pointercancel", up);
      });
    }

    _fromSlider(idx) {
      const v = parseFloat(this.sliders[idx].input.value);
      if (idx === 0) this.st.master = dbToMaster(v);
      else this.st.gains[idx - 1] = v;
      this.activePresetId = null;
      this._reflectSliders();
      this._syncSelectLabel();
      this._fireGains();
    }

    _fireGains() {
      if (this.o.onGains) {
        this.o.onGains(this.st.gains.slice(), this.st.master);
      }
    }

    _fireSetting(key, value) {
      this.st[key] = value;
      this._reflect();
      if (this.o.onSetting) this.o.onSetting(key, value);
    }

    _randomize() {
      const p1 = Math.random() * 6.28;
      const p2 = Math.random() * 6.28;
      const a1 = 3 + Math.random() * 4;
      const a2 = 2 + Math.random() * 4;
      this.st.gains = Fx.BANDS.map((_, i) => Fx.clampGain(a1 * Math.sin(p1 + i * 0.62) + a2 * Math.sin(p2 + i * 0.21)));
      this.activePresetId = null;
      this._reflectSliders();
      this._syncSelectLabel();
      this._fireGains();
    }

    // ---------- state in ----------

    update(st) {
      if (this.dragging) return;
      if (st.gains) this.st.gains = Fx.sanitizeGains(st.gains);
      if (st.master != null) this.st.master = Fx.sanitizeMaster(st.master);
      ["enabled", "mono", "snap", "ab"].forEach((k) => {
        if (st[k] != null) this.st[k] = !!st[k];
      });
      if (st.theme) this.st.theme = st.theme === "dark" ? "dark" : "light";
      this._reflect();
    }

    // presets: [{group, name, gains, master, presetId|null}]
    setPresets(list, activePresetId) {
      this.curves = list.slice();
      this._buildPresetSelect();
      this.markPreset(activePresetId);
    }

    markPreset(presetId) {
      this.activePresetId = presetId || null;
      this._syncSelectLabel();
    }

    _syncSelectLabel() {
      if (!this.sel.options.length) return;
      let cur = this.curves.find((c) => c.presetId && c.presetId === this.activePresetId);
      if (!cur) {
        // Recommended presets have no presetId — match by the active curve itself.
        cur = this.curves.find(
          (c) =>
            Math.abs(c.master - this.st.master) < 1e-6 &&
            c.gains.length === this.st.gains.length &&
            c.gains.every((g, i) => Math.abs(g - this.st.gains[i]) < 1e-6)
        );
      }
      this.sel.options[0].textContent = cur ? cur.name : "— Preset —";
    }

    _buildPresetSelect() {
      this.sel.innerHTML = "";
      const ph = el("option", null, "— Preset —");
      ph.disabled = false;
      this.sel.append(ph);
      let group = null;
      let og = null;
      for (const c of this.curves) {
        if (c.group !== group) {
          group = c.group;
          og = document.createElement("optgroup");
          og.label = group;
          this.sel.append(og);
        }
        const o = el("option", null, c.name);
        og.append(o);
      }
      this.sel.selectedIndex = 0;
      this._syncSelectLabel();
    }

    // ---------- visual sync ----------

    _reflect() {
      this.w.dataset.theme = this.st.theme;
      this.btnOn.setAttribute("aria-pressed", this.st.enabled ? "true" : "false");
      this.btnOff.setAttribute("aria-pressed", this.st.enabled ? "false" : "true");
      this.chkMono.checked = this.st.mono;
      this.chkSnap.checked = this.st.snap;
      this.btnAB.setAttribute("aria-pressed", this.st.ab ? "true" : "false");
      this.btnAB.style.background = this.st.ab ? "var(--w-fill)" : "";
      this.btnAB.style.color = this.st.ab ? "#fff" : "";
      this._reflectSliders();
    }

    _reflectSliders() {
      const vals = [masterToDb(this.st.master)].concat(this.st.gains);
      for (let i = 0; i <= NB; i++) {
        const rec = this.sliders[i];
        rec.input.value = String(vals[i]);
        rec.input.title = (vals[i] > 0 ? "+" : "") + vals[i].toFixed(1) + " dB";
        const r = rec.sl.getBoundingClientRect();
        const h = r.height || 148;
        const t = (vals[i] - Fx.GAIN_MIN) / (Fx.GAIN_MAX - Fx.GAIN_MIN);
        const travel = h - 2 * PAD;
        const y = h - PAD - t * travel; // thumb center from top
        rec.thumb.style.top = y + "px";
        rec.fill.style.height = Math.max(0, h - PAD - y) + "px";
      }
      this._scheduleCurve();
    }

    // ---------- response curve ----------

    _scheduleCurve() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._drawCurve();
      });
    }

    _ensureFilters() {
      if (this.bq !== null) return this.bq;
      try {
        const OC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        const ctx = new OC(1, 1, 48000);
        const filters = Fx.BANDS.map((b) => {
          const f = ctx.createBiquadFilter();
          f.type = b.type;
          f.frequency.value = b.freq;
          if (b.q) f.Q.value = b.q;
          return f;
        });
        for (let i = 0; i + 1 < filters.length; i++) filters[i].connect(filters[i + 1]);
        this._octx = ctx;
        this._freqs = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          this._freqs[i] = 20 * Math.pow(1000, i / 255); // 20 Hz .. 20 kHz log
        }
        this.bq = filters;
      } catch (e) {
        this.bq = false; // no WebAudio here: grid-only fallback
      }
      return this.bq;
    }

    _drawCurve() {
      const cv = this.canvas;
      const wrap = this.curveWrap;
      const dpr = global.devicePixelRatio || 1;
      const w = cv.clientWidth || 400;
      const h = cv.clientHeight || 80;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const FMIN = 20, FMAX = 20000, LOGSPAN = Math.log10(FMAX / FMIN);
      const xOf = (f) => ((Math.log10(f) - Math.log10(FMIN)) / LOGSPAN) * w;
      const yOf = (db) => h - ((db - Fx.GAIN_MIN) / (Fx.GAIN_MAX - Fx.GAIN_MIN)) * h;

      // grid
      g.strokeStyle = getComputedStyle(this.w).getPropertyValue("--w-grid") || "#5c5f62";
      g.lineWidth = 1;
      g.beginPath();
      for (const b of Fx.BANDS) {
        const x = Math.round(xOf(b.freq)) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, h);
      }
      for (const db of [-6, 0, 6]) {
        const y = Math.round(yOf(db)) + 0.5;
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();

      const filters = this._ensureFilters();
      if (!filters) return;

      const preampDb = masterToDb(this.st.master);
      const mags = new Float32Array(256);
      const phase = new Float32Array(256);
      const db = new Float32Array(256);
      try {
        for (let i = 0; i < NB; i++) filters[i].gain.value = this.st.gains[i];
        for (let i = 0; i < 256; i++) db[i] = preampDb;
        // Cascade all 10 biquads: summed dB response (linear magnitudes multiply).
        for (let b = 0; b < NB; b++) {
          filters[b].getFrequencyResponse(this._freqs, mags, phase);
          for (let i = 0; i < 256; i++) db[i] += 20 * Math.log10(Math.max(mags[i], 1e-6));
        }
      } catch (e) {
        return;
      }

      g.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = xOf(this._freqs[i]);
        const y = Fx.clamp(yOf(db[i]), -4, h + 4);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.lineJoin = "round";
      g.lineCap = "round";
      g.strokeStyle = "#c96a1e";
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = "#ef8a3c";
      g.lineWidth = 5;
      g.stroke();
    }
  }

  global.FxEqWidget = {
    create: function (root, opts) {
      return new FxEqWidget(root, opts);
    },
    masterToDb: masterToDb,
    dbToMaster: dbToMaster
  };
})(globalThis);
