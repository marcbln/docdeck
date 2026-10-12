import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderModal } from "./folder-modal";

function boxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(".folder-file input")];
}

describe("FolderModal", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("starts hidden and shows on demand", () => {
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(modal.isOpen).toBe(false);
    modal.show();
    expect(modal.isOpen).toBe(true);
  });

  it("pre-checks files that already have open tabs", () => {
    const modal = new FolderModal({
      isOpen: (path) => path === "/ai/plan.md",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    modal.show();
    modal.addRoot("/ai", ["/ai/plan.md", "/ai/report.md"]);

    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
  });

  it("reports checked and known paths on confirm", () => {
    const onConfirm = vi.fn();
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm,
      onCancel: vi.fn(),
    });

    modal.show();
    modal.addRoot("/ai", ["/ai/a.md", "/ai/b.md"]);

    const second = boxes()[1];
    if (!second) throw new Error("expected a second checkbox");
    second.checked = true;
    second.dispatchEvent(new Event("change"));

    document.querySelector<HTMLButtonElement>(".folder-modal-confirm")?.click();

    expect(onConfirm).toHaveBeenCalledWith(
      ["/ai/b.md"],
      ["/ai/a.md", "/ai/b.md"],
    );
  });

  it("cancels via the cancel button and hides", () => {
    const onCancel = vi.fn();
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm: vi.fn(),
      onCancel,
    });

    modal.show();
    document.querySelector<HTMLButtonElement>(".folder-modal-cancel")?.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(modal.isOpen).toBe(false);
  });

  it("shows scan failures inline", () => {
    const modal = new FolderModal({
      isOpen: () => false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });
    modal.show();
    modal.setRootError("/nope", "Could not scan this folder.");
    expect(document.querySelector(".folder-error")?.textContent).toContain(
      "/nope",
    );
  });
});