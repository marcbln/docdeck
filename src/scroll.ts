/** Offset in px used when jumping to a heading, clearing the sticky header. */
export const SCROLL_OFFSET_PX = 12;

/**
 * Scrolls `scrollParent` so the element with `id` sits below the sticky header.
 * Returns false when the target is not in the document.
 */
export function scrollToAnchor(scrollParent: HTMLElement, id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;

  const top =
    target.getBoundingClientRect().top -
    scrollParent.getBoundingClientRect().top +
    scrollParent.scrollTop -
    SCROLL_OFFSET_PX;

  scrollParent.scrollTo({ top, behavior: "smooth" });
  return true;
}
