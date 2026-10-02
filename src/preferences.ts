/** Single storage key. The version suffix lets a future schema change coexist
 *  with an old key rather than migrating it in place. */
const STORAGE_KEY = "docdeck.preferences.v1";

const SCHEMA_VERSION = 1;

export type ThemeMode = "dark" | "light";

export interface Preferences {
  themeMode: ThemeMode;
  tocVisible: boolean;
  frontmatterVisible: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  themeMode: "dark",
  tocVisible: false,
  frontmatterVisible: true,
});

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

/**
 * Decodes a stored payload into preferences, validating each field
 * independently.
 *
 * The layers fail independently on purpose. A `localStorage` read can throw in
 * a restricted webview, the JSON can be corrupt, and any single field can hold
 * the wrong type after a schema change. Validating per field means one bad
 * value costs the reader that preference, not all three.
 */
function decode(raw: string | null): Preferences {
  if (raw === null) return { ...DEFAULT_PREFERENCES };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_PREFERENCES };
  }

  const record = parsed as Record<string, unknown>;
  return {
    themeMode: isThemeMode(record.themeMode)
      ? record.themeMode
      : DEFAULT_PREFERENCES.themeMode,
    tocVisible:
      typeof record.tocVisible === "boolean"
        ? record.tocVisible
        : DEFAULT_PREFERENCES.tocVisible,
    frontmatterVisible:
      typeof record.frontmatterVisible === "boolean"
        ? record.frontmatterVisible
        : DEFAULT_PREFERENCES.frontmatterVisible,
  };
}

export function loadPreferences(): Preferences {
  try {
    return decode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage can be unavailable (private mode, restricted webview context).
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, ...preferences }),
    );
  } catch {
    // Persistence is a convenience; failing to write must not break a toggle.
  }
}

/**
 * Writes preferences on a trailing debounce.
 *
 * Four toggles flapping in quick succession should cost one write, not four,
 * and `localStorage` is synchronous — it blocks the webview's main thread.
 */
export function createPreferenceWriter(delayMs = 250): {
  schedule(preferences: Preferences): void;
  flush(preferences: Preferences): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Preferences | null = null;

  return {
    schedule(preferences: Preferences): void {
      pending = preferences;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) savePreferences(pending);
        pending = null;
      }, delayMs);
    },
    flush(preferences: Preferences): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      savePreferences(preferences);
    },
  };
}