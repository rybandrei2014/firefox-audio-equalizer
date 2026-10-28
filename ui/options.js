"use strict";

/* global FxEQ, FxEQ_MSG */

const M = FxEQ_MSG;
const Fx = FxEQ;

let state = null;
let bypass = false;
let preBypass = null; // {gains, master} captured when A/B switched off

const $ = (id) => document.getElementById(id);

async function send(type, payload) {
  const reply = await browser.runtime.sendMessage(M.envelope(type, payload));
  if (M.isEnvelope(reply) && reply.payload && reply.payload.state) {
    state = reply.payload.state;
  }
  return reply;
}

// ---- EQ sliders ----

function freqLabel(hz) {
  return hz >= 1000 ? hz / 1000 + "k" : String(hz);
}

function buildBands() {
  const wrap = $("bands");
  wrap.innerHTML = "";
  Fx.BANDS.forEach((b, i) => {
    const col = document.createElement("div");
    col.className = "band";

    const val = document.createElement("span");
    val.className = "readout";
    val.id = "val" + i;

    const sl = document.createElement("input");
    sl.type = "range";
    sl.min = String(Fx.GAIN_MIN);
    sl.max = String(Fx.GAIN_MAX);
    sl.step = "0.5";
    sl.value = "0";
    sl.setAttribute("orient", "vertical"); // Firefox native vertical slider
    sl.id = "sl" + i;
    sl.setAttribute("aria-label", freqLabel(b.freq) + " Hz gain");

    const lab = document.createElement("span");
    lab.className = "freq";
    lab.textContent = freqLabel(b.freq);

    sl.addEventListener("input", () => {
      readouts();
      queueApply();
    });

    col.append(val, sl, lab);
    wrap.append(col);
  });

  $("master").addEventListener("input", () => {
    readouts();
    queueApply();
  });
}

function collect() {
  const gains = Fx.BANDS.map((_, i) => parseFloat($("sl" + i).value));
  const master = parseFloat($("master").value);
  return { gains, master };
}

function readouts() {
  Fx.BANDS.forEach((_, i) => {
    const v = parseFloat($("sl" + i).value);
    $("val" + i).textContent = (v > 0 ? "+" : "") + v.toFixed(1);
  });
  const m = parseFloat($("master").value);
  $("masterVal").textContent = Math.round(m * 100) + "%";

  const { gains } = collect();
  const boost = gains.reduce((s, g) => s + Math.max(0, g), 0);
  const warn = $("boostWarn");
  if (boost > 6) {
    warn.textContent = "Total boost +" + boost.toFixed(1) + " dB — risk of clipping; lower master gain if audio distorts.";
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
}

let applyTimer = null;
function queueApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(async () => {
    const { gains, master } = collect();
    if (bypass) {
      preBypass = { gains, master }; // remember while audio stays flat
      return;
    }
    await send(M.T.UI_SET_ACTIVE, { gains, master, presetId: null });
    markActivePreset();
  }, 150);
}

function setSliders(gains, master) {
  gains.forEach((g, i) => { $("sl" + i).value = String(g); });
  $("master").value = String(master);
  readouts();
}

// ---- A/B bypass ----

function updateBypassBtn() {
  $("bypassBtn").textContent = bypass ? "A/B: EQ OFF" : "A/B: EQ ON";
}

$("bypassBtn").addEventListener("click", async () => {
  const cur = collect();
  if (!bypass) {
    bypass = true;
    preBypass = cur;
    await send(M.T.UI_SET_ACTIVE, { gains: Fx.zeros(), master: 1, presetId: null });
  } else {
    bypass = false;
    const p = preBypass || cur;
    await send(M.T.UI_SET_ACTIVE, { gains: p.gains, master: p.master, presetId: null });
  }
  updateBypassBtn();
});

// ---- presets ----

function markActivePreset() {
  document.querySelectorAll("#presetList li").forEach((li) => {
    li.classList.toggle("active", li.dataset.id === state.active.presetId);
  });
}

function renderPresets() {
  const ul = $("presetList");
  ul.innerHTML = "";
  if (state.presets.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="name hint">No presets yet — dial in sliders and press “Save current”.</span>';
    ul.append(li);
  }
  for (const p of state.presets) {
    const li = document.createElement("li");
    li.dataset.id = p.id;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = "master " + Math.round(p.master * 100) + "% · " + p.updatedAt.slice(0, 10);

    const load = document.createElement("button");
    load.textContent = "Load";
    load.addEventListener("click", async () => {
      bypass = false;
      updateBypassBtn();
      await send(M.T.UI_APPLY_PRESET, { id: p.id });
      setSliders(state.active.gains, state.active.master);
      markActivePreset();
    });

    const rename = document.createElement("button");
    rename.textContent = "Rename";
    rename.addEventListener("click", async () => {
      const n = prompt("Preset name:", p.name);
      if (n && n.trim()) await send(M.T.UI_RENAME_PRESET, { id: p.id, name: n.trim() });
      renderPresets();
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      if (!confirm('Delete preset "' + p.name + '"?')) return;
      await send(M.T.UI_DELETE_PRESET, { id: p.id });
      renderPresets();
    });

    li.append(name, meta, load, rename, del);
    ul.append(li);
  }
  markActivePreset();
}

$("savePresetBtn").addEventListener("click", async () => {
  const name = $("presetName").value.trim();
  if (!name) {
    $("presetName").focus();
    return;
  }
  bypass = false;
  updateBypassBtn();
  await send(M.T.UI_SAVE_PRESET, { name });
  $("presetName").value = "";
  renderPresets();
});

// ---- export / import ----

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "firefox-audio-equalizer.json";
  a.click();
  URL.revokeObjectURL(a.href);
  flashPort("Exported.");
});

$("importBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const reply = await send(M.T.UI_IMPORT, { data });
    if (reply && reply.payload && reply.payload.error) throw new Error(reply.payload.error);
    renderAll();
    flashPort("Imported " + state.presets.length + " preset(s).");
  } catch (err) {
    flashPort("Import failed: " + err.message);
  }
  e.target.value = "";
});

function flashPort(msg) {
  $("portMsg").textContent = msg;
  setTimeout(() => { if ($("portMsg").textContent === msg) $("portMsg").textContent = ""; }, 4000);
}

// ---- per-site kill switch ----

function normHost(v) {
  v = v.trim().toLowerCase();
  if (!v) return "";
  try {
    if (!/^[a-z]+:\/\//.test(v)) v = "http://" + v;
    return new URL(v).hostname;
  } catch (e) {
    return "";
  }
}

function renderHosts() {
  const ul = $("hostList");
  ul.innerHTML = "";
  if (state.settings.disabledHosts.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="name hint">No disabled sites — EQ applies everywhere.</span>';
    ul.append(li);
  }
  for (const h of state.settings.disabledHosts) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = h;
    const btn = document.createElement("button");
    btn.textContent = "Re-enable";
    btn.addEventListener("click", async () => {
      await send(M.T.UI_TOGGLE_HOST, { host: h, disable: false });
      renderHosts();
    });
    li.append(name, btn);
    ul.append(li);
  }
}

$("addHostBtn").addEventListener("click", async () => {
  const host = normHost($("hostInput").value);
  if (!host) {
    $("hostInput").focus();
    return;
  }
  await send(M.T.UI_TOGGLE_HOST, { host, disable: true });
  $("hostInput").value = "";
  renderHosts();
});

// ---- behavior settings ----

$("enabledChk").addEventListener("change", async (e) => {
  await send(M.T.UI_SET_SETTING, { key: "enabled", value: e.target.checked });
  renderSettings();
});

$("patchChk").addEventListener("change", async (e) => {
  await send(M.T.UI_SET_SETTING, { key: "webAudioPatch", value: e.target.checked });
  renderSettings();
});

function renderSettings() {
  $("enabledChk").checked = state.settings.enabled;
  $("patchChk").checked = state.settings.webAudioPatch;
  $("patchWarn").classList.toggle("hidden", !(state.settings.webAudioPatch && state.settings.warnWebAudio));
  const pill = $("globalState");
  pill.textContent = state.settings.enabled ? "enabled" : "globally bypassed";
}

// ---- diagnostics (active tab STATUS from background cache) ----

async function activeMediaTab() {
  const tabs = await browser.tabs.query({});
  const candidates = tabs.filter(
    (t) => t.active && t.url && !t.url.startsWith("moz-extension:")
  );
  return candidates[0] || null;
}

function dl(out, pairs) {
  out.innerHTML = "";
  for (const [k, v, bad] of pairs) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    if (bad) dd.classList.add("bad");
    out.append(dt, dd);
  }
}

async function refreshDiag() {
  const tab = await activeMediaTab();
  if (!tab) {
    $("diagTabName").textContent = "no web tab found";
    $("diagOut").innerHTML = "";
    return;
  }
  $("diagTabName").textContent = tab.title || tab.url;
  const reply = await send(M.T.UI_GET_TAB_STATUS, { tabId: tab.id });
  const st = reply && reply.payload ? reply.payload.status : null;
  const out = $("diagOut");
  if (!st) {
    dl(out, [["status", "no report from this tab yet (reload it)", true]]);
    return;
  }
  dl(out, [
    ["context", st.ctxState, st.ctxState !== "running"],
    ["media elements routed", String(st.sources), false],
    ["currently playing", String(st.playing), false],
    ["output level (rms)", st.rms >= 0 ? st.rms.toFixed(5) : "n/a", false],
    ["WebAudio patch", st.webAudioPatched ? "installed" : "off", false],
    [
      "silence warning",
      st.suspectSilence
        ? "audio is silent after EQ — likely protected (DRM) media; unsupported here"
        : "none",
      !!st.suspectSilence
    ]
  ]);
  if (st.unsupported && st.unsupported.length) {
    const dt = document.createElement("dt");
    dt.textContent = "not routed";
    const dd = document.createElement("dd");
    dd.className = "bad";
    dd.textContent = st.unsupported.map((u) => u.tag + " " + u.host + " (" + u.reason + ")").join(", ");
    out.append(dt, dd);
  }
}

$("refreshDiagBtn").addEventListener("click", refreshDiag);
setInterval(() => {
  if (!document.hidden) refreshDiag();
}, 2500);

// ---- init ----

function renderAll() {
  setSliders(state.active.gains, state.active.master);
  renderPresets();
  renderHosts();
  renderSettings();
  updateBypassBtn();
}

(async function init() {
  buildBands();
  await send(M.T.UI_GET_STATE);
  // keep multiple open UIs in sync (background is the only writer)
  browser.storage.onChanged.addListener(async () => {
    const ae = document.activeElement;
    await send(M.T.UI_GET_STATE);
    if (!(ae && ae.closest && ae.closest("#bands"))) renderAll();
  });
  renderAll();
  refreshDiag();
})();
