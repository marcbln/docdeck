/**
 * Short deterministic relative times ("4m ago").
 *
 * Custom rather than `Intl.RelativeTimeFormat` so tests do not depend on ICU
 * data or a locale, and so the wording stays stable across platforms.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(modifiedTime: number, now: number): string {
  const elapsed = Math.max(0, now - modifiedTime);

  if (elapsed < 10 * SECOND) return "just now";
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;

  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Exact timestamp for the row tooltip. */
export function formatExactTime(modifiedTime: number): string {
  return new Date(modifiedTime).toLocaleString();
}
