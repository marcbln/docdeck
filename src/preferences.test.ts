import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "./preferences";

const KEY = "docdeck.preferences.v1";

describe("loadPreferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns defaults when nothing is stored", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips a saved preference set", () => {
    savePreferences({
      themeMode: "light",
      tocVisible: true,
      frontmatterVisible: false,
      inboxVisible: false,
    });
    expect(loadPreferences()).toEqual({
      themeMode: "light",
      tocVisible: true,
      frontmatterVisible: false,
      inboxVisible: false,
    });
  });

  it("falls back to defaults on corrupt JSON", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("falls back to defaults when the payload is not an object", () => {
    window.localStorage.setItem(KEY, '"a string"');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid fields when one field has the wrong type", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "light",
        tocVisible: "yes",
        frontmatterVisible: false,
      }),
    );
    const preferences = loadPreferences();
    expect(preferences.themeMode).toBe("light");
    expect(preferences.frontmatterVisible).toBe(false);
    expect(preferences.tocVisible).toBe(DEFAULT_PREFERENCES.tocVisible);
  });

  it("rejects an unknown theme mode", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, themeMode: "solarized" }),
    );
    expect(loadPreferences().themeMode).toBe("dark");
  });

  it("defaults inboxVisible to true for stored objects from before the field", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "dark",
        tocVisible: false,
        frontmatterVisible: true,
      }),
    );
    expect(loadPreferences().inboxVisible).toBe(true);
  });
});