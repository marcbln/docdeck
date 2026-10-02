export interface ToggleButtonOptions {
  /** Button element to decorate. */
  element: HTMLButtonElement;
  /** Glyph shown before the label, e.g. "☀". */
  icon: string;
  /** Text after the icon. */
  label: string;
  tooltip: string;
  initialState: boolean;
  onChange: (next: boolean) => void;
  /** Renders the visible text for a given state. */
  formatLabel: (state: boolean) => string;
}

/**
 * A toolbar button with a boolean state.
 *
 * Factored out because three new toggles would otherwise mean three copies of
 * the same click handler, class toggle and `aria-pressed` update — three places
 * to forget the ARIA state when a fourth arrives.
 */
export function createToggleButton(options: ToggleButtonOptions): {
  setState(next: boolean): void;
} {
  const { element, icon, label, tooltip, formatLabel, onChange } = options;

  element.classList.toggle("active", options.initialState);
  element.title = tooltip;
  element.setAttribute("aria-label", tooltip);
  element.setAttribute("aria-pressed", String(options.initialState));

  const paint = (state: boolean): void => {
    element.classList.toggle("active", state);
    element.setAttribute("aria-pressed", String(state));
    element.textContent = `${icon} ${label}: ${formatLabel(state)}`;
  };

  paint(options.initialState);

  element.addEventListener("click", () => {
    const next = element.getAttribute("aria-pressed") !== "true";
    paint(next);
    onChange(next);
  });

  return {
    setState(next: boolean): void {
      paint(next);
    },
  };
}