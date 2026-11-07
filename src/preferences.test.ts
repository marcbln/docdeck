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
      browseMode: "all",
      openSectionCollapsed: true,
      browseSectionCollapsed: true,
      layout: {
        sidebarWidth: 360,
        tocWidth: 280,
        eventLogHeight: 240,
        sidebarSplit: 40,
      },
    });
    expect(loadPreferences()).toEqual({
      themeMode: "light",
      tocVisible: true,
      frontmatterVisible: false,
      inboxVisible: false,
      browseMode: "all",
      openSectionCollapsed: true,
      browseSectionCollapsed: true,
      layout: {
        sidebarWidth: 360,
        tocWidth: 280,
        eventLogHeight: 240,
        sidebarSplit: 40,
      },
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

  it("defaults the sidebar fields for a legacy payload", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "dark",
        tocVisible: false,
        frontmatterVisible: true,
        inboxVisible: true,
      }),
    );
    expect(loadPreferences()).toMatchObject({
      browseMode: "recent",
      openSectionCollapsed: false,
      browseSectionCollapsed: false,
    });
  });

  it("rejects an unknown browse mode", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, browseMode: "entropy" }),
    );
    expect(loadPreferences().browseMode).toBe("recent");
  });
});

describe("layout preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults the four pane sizes", () => {
    expect(loadPreferences().layout).toEqual({
      sidebarWidth: 300,
      tocWidth: 240,
      eventLogHeight: 200,
      sidebarSplit: 50,
    });
  });

  it("round-trips a layout payload", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        layout: {
          sidebarWidth: 420,
          tocWidth: 300,
          eventLogHeight: 260,
          sidebarSplit: 35,
        },
      }),
    );

    expect(loadPreferences().layout).toEqual({
      sidebarWidth: 420,
      tocWidth: 300,
      eventLogHeight: 260,
      sidebarSplit: 35,
    });
  });

  it("defaults the layout for a legacy payload without it", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "light",
        tocVisible: true,
        frontmatterVisible: false,
        inboxVisible: true,
        browseMode: "all",
      }),
    );

    const preferences = loadPreferences();
    expect(preferences.layout).toEqual({
      sidebarWidth: 300,
      tocWidth: 240,
      eventLogHeight: 200,
      sidebarSplit: 50,
    });
    expect(preferences.themeMode).toBe("light");
  });

  it("falls back per field while other preferences survive", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        themeMode: "light",
        layout: {
          sidebarWidth: 350,
          tocWidth: "wide",
          eventLogHeight: NaN,
          sidebarSplit: 120,
        },
      }),
    );

    const preferences = loadPreferences();
    expect(preferences.themeMode).toBe("light");
    expect(preferences.layout).toEqual({
      sidebarWidth: 350,
      tocWidth: 240,
      eventLogHeight: 200,
      sidebarSplit: 50,
    });
  });

  it("rejects non-finite and out-of-range values", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        layout: {
          sidebarWidth: Infinity,
          tocWidth: 10,
          eventLogHeight: 20_000,
          sidebarSplit: 0,
        },
      }),
    );

    expect(loadPreferences().layout).toEqual({
      sidebarWidth: 300,
      tocWidth: 240,
      eventLogHeight: 200,
      sidebarSplit: 50,
    });
  });

  it("returns a mutable layout copy on a fresh profile", () => {
    const preferences = loadPreferences();
    expect(() => {
      preferences.layout.sidebarWidth = 360;
    }).not.toThrow();
    expect(preferences.layout.sidebarWidth).toBe(360);
  });

  it("keeps the storage key and version", () => {
    savePreferences({
      ...DEFAULT_PREFERENCES,
    });

    const stored = window.localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string).version).toBe(1);
  });
});