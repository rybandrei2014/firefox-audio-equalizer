"use strict";

// Background (MV3 event page, plan.md §3): the ONLY writer of storage.
// Owns effective settings, pushes APPLY_EQ to tabs, keeps per-tab badge state.

const DEFAULTS = {
  version: 1,
  settings: {
    enabled: true,
    disabledHosts: [],
    webAudioPatch: false, // M2 ships opt-in (plan §10.5)
    warnWebAudio: true
  },
  active: { gains: FxEQ.zeros(), master: 1.0, presetId: null },
  presets: []
};

let state = JSON.parse(JSON.stringify(DEFAULTS));
const tabStatus = new Map(); // tabId -> last STATUS payload

function mergeDefaults(st) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  if (!st || typeof st !== "object") return out;
  if (st.settings && typeof st.settings === "object") {
    if (typeof st.settings.enabled === "boolean") out.settings.enabled = st.settings.enabled;
    if (typeof st.settings.webAudioPatch === "boolean") out.settings.webAudioPatch = st.settings.webAudioPatch;
    if (typeof st.settings.warnWebAudio === "boolean") out.settings.warnWebAudio = st.settings.warnWebAudio;
    if (Array.isArray(st.settings.disabledHosts)) {
      out.settings.disabledHosts = st.settings.disabledHosts.filter(h => typeof h === "string").slice(0, 500);
    }
  }
  if (st.active && typeof st.active === "object") {
    out.active.gains = FxEQ.sanitizeGains(st.active.gains);
    out.active.master = FxEQ.sanitizeMaster(st.active.master);
    if (typeof st.active.presetId === "string" || st.active.presetId === null) {
      out.active.presetId = st.active.presetId;
    }
  }
  if (Array.isArray(st.presets)) {
    out.presets = st.presets.filter(FxEQ.validPreset).map(FxEQ.normalizePreset);
  }
  return out;
}

async function load() {
  const data = await browser.storage.local.get(["version", "settings", "active", "presets"]);
  state = mergeDefaults(data);
}
const ready = load().then(refreshAllBadges);

async function persist() {
  await browser.storage.local.set(state);
  mirrorSync();
}

// Desktop-only best-effort write-through mirror (plan §4); ignored on Android.
function mirrorSync() {
  try {
    if (browser.storage && browser.storage.sync) {
      browser.storage.sync
        .set({ version: state.version, settings: state.settings, presets: state.presets })
        .catch(() => {});
    }
  } catch (e) { /* no sync on this platform */ }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function effectiveFor(host) {
  const on = state.settings.enabled && (!host || !state.settings.disabledHosts.includes(host));
  return {
    enabled: on,
    gains: state.active.gains,
    master: state.active.master,
    webAudioPatch: !!state.settings.webAudioPatch
  };
}

async function pushToTab(tab) {
  if (!tab || tab.id == null || !tab.url) return;
  const host = hostOf(tab.url);
  if (!host) return;
  try {
    await browser.tabs.sendMessage(tab.id, FxEQ_MSG.envelope("APPLY_EQ", effectiveFor(host)));
  } catch (e) { /* no content script in this tab (privileged page etc.) */ }
  updateBadge(tab.id, host);
}

async function pushAllTabs() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) await pushToTab(tab);
}

// ---- badge: on / off / unsupported (plan §3 background duties) ----

function updateBadge(tabId, host) {
  const st = tabStatus.get(tabId);
  const eff = effectiveFor(host);
  let text = "";
  let color = "#4c8dff";
  if (!eff.enabled) {
    text = "off";
    color = "#9aa0a6";
  } else if (st && st.suspectSilence) {
    text = "!";
    color = "#d93025";
  } else if (st && st.unsupported && st.unsupported.length > 0 && st.playing > 0) {
    text = "!";
    color = "#e37400";
  } else if (eff.enabled) {
    text = "EQ";
  }
  browser.action.setBadgeText({ tabId: tabId, text: text }).catch(() => {});
  browser.action.setBadgeBackgroundColor({ tabId: tabId, color: color }).catch(() => {});
  const title = !eff.enabled
    ? "Firefox Audio Equalizer — disabled on this site"
    : st && st.suspectSilence
      ? "Firefox Audio Equalizer — not supported on this site (protected/silent audio)"
      : "Firefox Audio Equalizer — active";
  browser.action.setTitle({ tabId: tabId, title: title }).catch(() => {});
}

async function refreshAllBadges() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    const host = hostOf(tab.url);
    if (host) updateBadge(tab.id, host);
  }
}

// ---- storage mutations (all UI writes funnel through here) ----

function findPreset(id) {
  return state.presets.find(p => p.id === id) || null;
}

async function setActive(gains, master, presetId) {
  state.active.gains = FxEQ.sanitizeGains(gains);
  state.active.master = FxEQ.sanitizeMaster(master);
  if (presetId !== undefined) state.active.presetId = presetId;
  await persist();
  await pushAllTabs();
}

// ---- message routing ----

const SETTINGS_KEYS = ["enabled", "webAudioPatch", "warnWebAudio"];

browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (!FxEQ_MSG.isEnvelope(msg)) return undefined;
  await ready;
  const T = FxEQ_MSG.T;

  switch (msg.type) {
    case T.READY: {
      // content script just loaded: reply with effective settings for its tab
      const tab = sender.tab;
      if (!tab) return FxEQ_MSG.envelope(T.STATE, { state: state });
      const host = hostOf(tab.url);
      updateBadge(tab.id, host);
      return FxEQ_MSG.envelope(T.APPLY_EQ, effectiveFor(host));
    }

    case T.STATUS: {
      if (sender.tab) {
        tabStatus.set(sender.tab.id, msg.payload || {});
        const host = hostOf(sender.tab.url);
        updateBadge(sender.tab.id, host);
      }
      return FxEQ_MSG.envelope(T.STATE, {});
    }

    case T.UI_GET_STATE:
      return FxEQ_MSG.envelope(T.STATE, { state: state });

    case T.UI_SET_ACTIVE:
      await setActive(msg.payload.gains, msg.payload.master, msg.payload.presetId);
      return FxEQ_MSG.envelope(T.STATE, { state: state });

    case T.UI_APPLY_PRESET: {
      const p = findPreset(msg.payload.id);
      if (!p) return FxEQ_MSG.envelope(T.STATE, { state: state, error: "preset not found" });
      await setActive(p.gains, p.master, p.id);
      return FxEQ_MSG.envelope(T.STATE, { state: state });
    }

    case T.UI_SAVE_PRESET: {
      const name = String(msg.payload.name || "").trim().slice(0, 80) || "Preset";
      const now = new Date().toISOString();
      const id = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "p" + Date.now();
      state.presets.push({
        id: id, name: name,
        gains: state.active.gains.slice(), master: state.active.master,
        createdAt: now, updatedAt: now
      });
      state.active.presetId = id;
      await persist();
      await pushAllTabs();
      return FxEQ_MSG.envelope(T.STATE, { state: state });
    }

    case T.UI_DELETE_PRESET:
      state.presets = state.presets.filter(p => p.id !== msg.payload.id);
      if (state.active.presetId === msg.payload.id) state.active.presetId = null;
      await persist();
      return FxEQ_MSG.envelope(T.STATE, { state: state });

    case T.UI_RENAME_PRESET: {
      const p = findPreset(msg.payload.id);
      if (p) {
        p.name = String(msg.payload.name || "").trim().slice(0, 80) || p.name;
        p.updatedAt = new Date().toISOString();
        await persist();
      }
      return FxEQ_MSG.envelope(T.STATE, { state: state });
    }

    case T.UI_SET_SETTING: {
      const key = msg.payload.key;
      if (!SETTINGS_KEYS.includes(key)) {
        return FxEQ_MSG.envelope(T.STATE, { state: state, error: "unknown setting" });
      }
      state.settings[key] = !!msg.payload.value;
      await persist();
      await pushAllTabs();
      return FxEQ_MSG.envelope(T.STATE, { state: state });
    }

    case T.UI_TOGGLE_HOST: {
      const host = String(msg.payload.host || "").toLowerCase();
      if (!host) return FxEQ_MSG.envelope(T.STATE, { state: state, error: "bad host" });
      const list = state.settings.disabledHosts;
      if (msg.payload.disable) {
        if (!list.includes(host)) list.push(host);
      } else {
        state.settings.disabledHosts = list.filter(h => h !== host);
      }
      await persist();
      await pushAllTabs();
      return FxEQ_MSG.envelope(T.STATE, { state: state });
    }

    case T.UI_IMPORT: {
      const imported = mergeDefaults(msg.payload.data);
      state = imported;
      await persist();
      await pushAllTabs();
      return FxEQ_MSG.envelope(T.STATE, { state: state });
    }

    case T.UI_GET_TAB_STATUS: {
      const st = tabStatus.get(msg.payload.tabId) || null;
      return FxEQ_MSG.envelope(T.TAB_STATUS, { status: st });
    }

    default:
      return undefined;
  }
});

// ---- tab / navigation events: re-apply after loads (plan §3) ----

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") ready.then(() => pushToTab(tab));
});

browser.tabs.onActivated.addListener(async (info) => {
  await ready;
  try {
    const tab = await browser.tabs.get(info.tabId);
    updateBadge(tab.id, hostOf(tab.url));
  } catch (e) { /* tab gone */ }
});

browser.tabs.onRemoved.addListener((tabId) => tabStatus.delete(tabId));

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  ready.then(async () => {
    try {
      const tab = await browser.tabs.get(details.tabId);
      await pushToTab(tab);
    } catch (e) { /* tab gone */ }
  });
});
