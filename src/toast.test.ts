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

  it("invokes an inline action exactly once and hides the toast", () => {
    const onClick = vi.fn();
    host.show("Bookmark removed", "info", { label: "Undo", onClick });

    const action = document.querySelector<HTMLButtonElement>(".toast-action");
    expect(action?.textContent).toBe("Undo");
    action?.click();
    action?.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector(".toast")?.classList.contains("toast-visible"),
    ).toBe(false);
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("replaces the action callback when a new toast is shown", () => {
    const first = vi.fn();
    const second = vi.fn();
    host.show("First", "info", { label: "Undo", onClick: first });
    host.show("Second", "info", { label: "Undo", onClick: second });

    document.querySelector<HTMLButtonElement>(".toast-action")?.click();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes the action when a plain message follows", () => {
    host.show("First", "info", { label: "Undo", onClick: vi.fn() });
    host.show("Second");

    expect(document.querySelector(".toast-action")).toBeNull();
    expect(document.querySelector(".toast")?.textContent).toBe("Second");
  });

  it("keeps the action node after the timeout but does not fire it hidden", () => {
    const onClick = vi.fn();
    host.show("First", "info", { label: "Undo", onClick });
    vi.advanceTimersByTime(2000);

    const action = document.querySelector<HTMLButtonElement>(".toast-action");
    expect(action).not.toBeNull();
    action?.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
