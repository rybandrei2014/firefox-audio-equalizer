"use strict";

/* global FxEQ, FxEQ_MSG, FxEqWidget */

const M = FxEQ_MSG;
const Fx = FxEQ;

let state = null;
let bypass = false;
let preBypass = null; // {gains, master} captured when A/B switched off
let widget = null;

const $ = (id) => document.getElementById(id);

async function send(type, payload) {
  const reply = await browser.runtime.sendMessage(M.envelope(type, payload));
  if (M.isEnvelope(reply) && reply.payload && reply.payload.state) {
    state = reply.payload.state;
  }
  return reply;
}

// ---- EQ widget (classic editor, see ui/eq-widget.js) ----

function buildWidget() {
  widget = FxEqWidget.create($("eqWidget"), {
    onGains: (gains, master) => {
      warnBoost(gains);
      if (bypass) {
        preBypass = { gains, master }; // remember while audio stays flat
        return;
      }
      queueApply(gains, master);
    },
    onSetting: async (key, value) => {
      await send(M.T.UI_SET_SETTING, { key, value });
      renderSettings();
    },
    onPreset: (item) => applyCurve(item.gains, item.master, item.presetId),
    onSavePreset: () => {
      const name = prompt("Save current curve as preset:", "My preset");
      if (name && name.trim()) savePreset(name.trim());
    },
    onAB: (on) => setBypass(on),
    onRefresh: async () => {
      await send(M.T.UI_GET_STATE);
      renderAll();
    }
  });
}

function presetOptions() {
  const list = [];
  for (const p of state.presets) {
    list.push({ group: "My presets", name: p.name, gains: p.gains.slice(), master: p.master, presetId: p.id });
  }
  for (const r of Fx.RECOMMENDED) {
    list.push({ group: r.cat, name: r.name, gains: r.gains.slice(), master: r.master, presetId: null });
  }
  return list;
}

function renderEq() {
  warnBoost(state.active.gains);
  widget.update({
    gains: state.active.gains,
    master: state.active.master,
    enabled: state.settings.enabled,
    mono: state.settings.mono,
    snap: state.settings.snap,
    theme: state.settings.theme,
    ab: bypass
  });
  widget.setPresets(presetOptions(), state.active.presetId);
}

function warnBoost(gains) {
  const boost = gains.reduce((s, g) => s + Math.max(0, g), 0);
  const warn = $("boostWarn");
  if (boost > 6) {
    warn.textContent = "Total boost +" + boost.toFixed(1) + " dB — risk of clipping; lower the Preamp if audio distorts.";
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
}

let applyTimer = null;
function queueApply(gains, master) {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(async () => {
    await send(M.T.UI_SET_ACTIVE, { gains, master, presetId: null });
    markActivePreset();
  }, 150);
}

async function applyCurve(gains, master, presetId) {
  bypass = false;
  await send(M.T.UI_SET_ACTIVE, { gains, master, presetId: presetId || null });
  renderAll();
}

async function setBypass(on) {
  if (on === bypass) return;
  bypass = on;
  if (bypass) {
    preBypass = { gains: widget.st.gains.slice(), master: widget.st.master };
    await send(M.T.UI_SET_ACTIVE, { gains: Fx.zeros(), master: 1, presetId: null });
  } else {
    const p = preBypass || { gains: Fx.zeros(), master: 1 };
    await send(M.T.UI_SET_ACTIVE, { gains: p.gains, master: p.master, presetId: null });
  }
  renderAll();
}

// ---- presets ----

function markActivePreset() {
  if (widget) widget.markPreset(state.active.presetId);
  document.querySelectorAll("#presetList li").forEach((li) => {
    li.classList.toggle("active", li.dataset.id === state.active.presetId);
  });
}

async function savePreset(name) {
  bypass = false;
  await send(M.T.UI_SAVE_PRESET, { name });
  renderAll();
}

function renderPresets() {
  const ul = $("presetList");
  ul.innerHTML = "";
  if (state.presets.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="name hint">No presets yet — dial in the sliders and press “Save current” or ♥.</span>';
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
    load.addEventListener("click", () => applyCurve(p.gains.slice(), p.master, p.id));

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
      if (widget) widget.setPresets(presetOptions(), state.active.presetId);
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
  await savePreset(name);
  $("presetName").value = "";
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
  if (widget) {
    widget.update({
      enabled: state.settings.enabled,
      mono: state.settings.mono,
      snap: state.settings.snap,
      theme: state.settings.theme,
      ab: bypass
    });
  }
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
  renderEq();
  renderPresets();
  renderHosts();
  renderSettings();
}

(async function init() {
  buildWidget();
  await send(M.T.UI_GET_STATE);
  // keep multiple open UIs in sync (background is the only writer)
  browser.storage.onChanged.addListener(async () => {
    if (widget && widget.dragging) return;
    const ae = document.activeElement;
    await send(M.T.UI_GET_STATE);
    if (!(ae && ae.closest && ae.closest("#eqWidget"))) renderAll();
  });
  renderAll();
  refreshDiag();
})();
