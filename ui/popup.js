"use strict";

/* global FxEQ_MSG */

const M = FxEQ_MSG;
const $ = (id) => document.getElementById(id);

let state = null;
let host = "";

function safeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return "";
  }
}

async function refresh() {
  const reply = await browser.runtime.sendMessage(M.envelope(M.T.UI_GET_STATE));
  if (M.isEnvelope(reply) && reply.payload.state) state = reply.payload.state;
}

function render() {
  const disabledByHost = host && state.settings.disabledHosts.includes(host);
  const eff = state.settings.enabled && !disabledByHost;
  $("siteToggle").checked = eff;

  if (!state.settings.enabled && !disabledByHost) {
    $("note").textContent = "Globally bypassed — re-enable on the options page.";
  } else if (eff) {
    $("note").textContent = "";
  }

  const sel = $("presetSel");
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— current sliders —";
  sel.append(none);
  for (const p of state.presets) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    sel.append(o);
  }
  sel.value = state.active.presetId && state.presets.some((p) => p.id === state.active.presetId)
    ? state.active.presetId
    : "";
}

$("siteToggle").addEventListener("change", async (e) => {
  if (e.target.checked) {
    if (host && state.settings.disabledHosts.includes(host)) {
      await browser.runtime.sendMessage(M.envelope(M.T.UI_TOGGLE_HOST, { host, disable: false }));
    } else {
      await browser.runtime.sendMessage(M.envelope(M.T.UI_SET_SETTING, { key: "enabled", value: true }));
    }
  } else if (host) {
    await browser.runtime.sendMessage(M.envelope(M.T.UI_TOGGLE_HOST, { host, disable: true }));
  }
  await refresh();
  render();
});

$("applyBtn").addEventListener("click", async () => {
  const id = $("presetSel").value;
  if (!id) {
    $("note").textContent = "Pick a preset first (save them on the options page).";
    return;
  }
  await browser.runtime.sendMessage(M.envelope(M.T.UI_APPLY_PRESET, { id }));
  await refresh();
  render();
  $("note").textContent = "Preset applied to all tabs.";
});

$("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

(async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  host = tabs[0] ? safeHost(tabs[0].url || "") : "";
  $("host").textContent = host || "no tab";
  await refresh();
  render();
})();
