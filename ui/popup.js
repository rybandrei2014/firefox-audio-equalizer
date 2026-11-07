"use strict";

/* global FxEQ, FxEQ_MSG, FxEqWidget */

const M = FxEQ_MSG;
const Fx = FxEQ;
const $ = (id) => document.getElementById(id);

let state = null;
let host = "";
let bypass = false;
let preBypass = null;
let widget = null;

function safeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return "";
  }
}

async function send(type, payload) {
  const reply = await browser.runtime.sendMessage(M.envelope(type, payload));
  if (M.isEnvelope(reply) && reply.payload && reply.payload.state) {
    state = reply.payload.state;
  }
  return reply;
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

function render() {
  const disabledByHost = host && state.settings.disabledHosts.includes(host);
  const eff = state.settings.enabled && !disabledByHost;
  $("siteToggle").checked = eff;
  $("note").textContent = !state.settings.enabled
    ? "Globally off — press ON above."
    : disabledByHost
      ? "Blocked for this site (re-enable here or on the options page)."
      : "";

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

// ---- widget callbacks ----

let applyTimer = null;
function queueApply(gains, master) {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(async () => {
    await send(M.T.UI_SET_ACTIVE, { gains, master, presetId: null });
    widget.markPreset(state.active.presetId);
  }, 120);
}

async function applyCurve(gains, master, presetId) {
  bypass = false;
  await send(M.T.UI_SET_ACTIVE, { gains, master, presetId: presetId || null });
  render();
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
  render();
}

function buildWidget() {
  widget = FxEqWidget.create($("eqWidget"), {
    onGains: (gains, master) => {
      if (bypass) {
        preBypass = { gains, master };
        return;
      }
      queueApply(gains, master);
    },
    onSetting: async (key, value) => {
      await send(M.T.UI_SET_SETTING, { key, value });
      render();
    },
    onPreset: (item) => applyCurve(item.gains, item.master, item.presetId),
    onSavePreset: async () => {
      const name = prompt("Save current curve as preset:", "My preset");
      if (name && name.trim()) await send(M.T.UI_SAVE_PRESET, { name: name.trim() });
      render();
    },
    onAB: (on) => setBypass(on),
    onRefresh: async () => {
      await send(M.T.UI_GET_STATE);
      render();
    }
  });
}

// ---- per-site toggle ----

$("siteToggle").addEventListener("change", async (e) => {
  if (e.target.checked) {
    if (host && state.settings.disabledHosts.includes(host)) {
      await send(M.T.UI_TOGGLE_HOST, { host, disable: false });
    } else {
      await send(M.T.UI_SET_SETTING, { key: "enabled", value: true });
    }
  } else if (host) {
    await send(M.T.UI_TOGGLE_HOST, { host, disable: true });
  }
  await send(M.T.UI_GET_STATE);
  render();
});

$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

(async function init() {
  buildWidget();
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  host = tabs[0] ? safeHost(tabs[0].url || "") : "";
  $("host").textContent = host || "no tab";
  await send(M.T.UI_GET_STATE);
  browser.storage.onChanged.addListener(async () => {
    if (widget && widget.dragging) return;
    const ae = document.activeElement;
    await send(M.T.UI_GET_STATE);
    if (!(ae && ae.closest && ae.closest("#eqWidget"))) render();
  });
  render();
})();
