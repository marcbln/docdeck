import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastHost } from "./toast";

describe("ToastHost", () => {
  let host: ToastHost;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    host = new ToastHost(document.body, 2000);
  });

  afterEach(() => {
    host.dismiss();
    vi.useRealTimers();
  });

  it("mounts one accessible status element and shows the message", () => {
    host.show("Path copied");

    const toast = document.querySelector(".toast");
    expect(toast?.textContent).toBe("Path copied");
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.getAttribute("aria-live")).toBe("polite");
    expect(toast?.classList.contains("toast-visible")).toBe(true);
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("fades out after the configured duration", () => {
    host.show("Path copied");
    vi.advanceTimersByTime(1999);
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(true);

    vi.advanceTimersByTime(1);
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(false);
  });

  it("reuses the node and restarts the countdown for a new message", () => {
    host.show("Path copied");
    vi.advanceTimersByTime(1500);

    host.show("Copy failed", "error");
    const toast = document.querySelector(".toast");
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    expect(toast?.textContent).toBe("Copy failed");
    expect(toast?.classList.contains("toast-error")).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(toast?.classList.contains("toast-visible")).toBe(true);

    vi.advanceTimersByTime(500);
    expect(toast?.classList.contains("toast-visible")).toBe(false);
  });

  it("clears the error tone when a success message follows", () => {
    host.show("Copy failed", "error");
    host.show("Path copied");
    expect(
      document.querySelector(".toast")?.classList.contains("toast-error"),
    ).toBe(false);
  });

  it("dismiss hides immediately and cancels the pending timer", () => {
    host.show("Path copied");
    host.dismiss();
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(false);

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
