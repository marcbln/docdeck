import { describe, expect, it, vi } from "vitest";

import { createToggleButton } from "./toolbar";

function makeButton(): HTMLButtonElement {
  document.body.replaceChildren();
  const button = document.createElement("button");
  document.body.appendChild(button);
  return button;
}

describe("createToggleButton", () => {
  it("reflects the initial state in its class and ARIA attribute", () => {
    const button = makeButton();
    createToggleButton({
      element: button,
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle table of contents",
      initialState: true,
      onChange: vi.fn(),
      formatLabel: (state) => (state ? "ON" : "OFF"),
    });

    expect(button.classList.contains("active")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe("☰ Outline: ON");
  });

  it("flips state and reports the new value on click", () => {
    const button = makeButton();
    const onChange = vi.fn();
    createToggleButton({
      element: button,
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle table of contents",
      initialState: false,
      onChange,
      formatLabel: (state) => (state ? "ON" : "OFF"),
    });

    button.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("setState updates the visual state without firing onChange", () => {
    const button = makeButton();
    const onChange = vi.fn();
    const control = createToggleButton({
      element: button,
      icon: "☰",
      label: "Outline",
      tooltip: "Toggle table of contents",
      initialState: false,
      onChange,
      formatLabel: (state) => (state ? "ON" : "OFF"),
    });

    control.setState(true);
    expect(button.classList.contains("active")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});