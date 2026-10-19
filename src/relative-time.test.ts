import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const NOW = 1_800_000_000_000;

describe("formatRelativeTime", () => {
  it("uses just now for the last ten seconds", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("just now");
  });

  it("clamps future timestamps", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("just now");
  });

  it("renders every unit boundary", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("30s ago");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
    expect(formatRelativeTime(NOW - 10 * 86_400_000, NOW)).toBe("1w ago");
    expect(formatRelativeTime(NOW - 60 * 86_400_000, NOW)).toBe("2mo ago");
    expect(formatRelativeTime(NOW - 400 * 86_400_000, NOW)).toBe("1y ago");
  });
});
