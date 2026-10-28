"use strict";

// Message protocol shared by background, content and UI scripts.
// Single envelope: { v: 1, type, payload } (plan.md §5).
(function (global) {
  const V = 1;

  const T = {
    // content (MAIN via bridge) -> background
    READY: "READY",
    STATUS: "STATUS",
    // background -> content
    APPLY_EQ: "APPLY_EQ",
    // UI -> background
    UI_GET_STATE: "UI_GET_STATE",
    UI_SET_ACTIVE: "UI_SET_ACTIVE",
    UI_APPLY_PRESET: "UI_APPLY_PRESET",
    UI_SAVE_PRESET: "UI_SAVE_PRESET",
    UI_DELETE_PRESET: "UI_DELETE_PRESET",
    UI_RENAME_PRESET: "UI_RENAME_PRESET",
    UI_SET_SETTING: "UI_SET_SETTING",
    UI_TOGGLE_HOST: "UI_TOGGLE_HOST",
    UI_IMPORT: "UI_IMPORT",
    UI_GET_TAB_STATUS: "UI_GET_TAB_STATUS",
    // background -> UI (replies)
    STATE: "STATE",
    TAB_STATUS: "TAB_STATUS"
  };

  function envelope(type, payload) {
    return { v: V, type: type, payload: payload || {} };
  }

  function isEnvelope(m) {
    return !!m && m.v === V && typeof m.type === "string";
  }

  global.FxEQ_MSG = { V: V, T: T, envelope: envelope, isEnvelope: isEnvelope };
})(globalThis);
