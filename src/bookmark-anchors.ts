/**
 * Capture and resolve section anchors against the active document's outline.
 *
 * Pure and DOM-free. The resolver never guesses: exact text wins, context only
 * disambiguates or repairs an edited text, and occurrence is a last resort
 * limited to duplicate text with no context evidence at all.
 */

import {
  normalizeHeadingText,
  type BookmarkDepth,
  type SectionAnchor,
} from "./bookmarks-model";
import type { Heading } from "./toc";

export const CONTEXT_WINDOW = 2;

export interface ResolvedHeading {
  kind: "resolved";
  /** Index in the current outline. */
  index: number;
  /** Current DOM id used for scrolling. */
  slug: string;
  /** Current heading text after edits. */
  text: string;
  depth: number;
  via: "text" | "context" | "occurrence" | "picker";
}

export interface StaleHeading {
  kind: "stale";
  reason: "missing" | "ambiguous";
}

export type HeadingResolution = ResolvedHeading | StaleHeading;

function beforeTexts(headings: readonly Heading[], index: number): string[] {
  const start = Math.max(0, index - CONTEXT_WINDOW);
  return headings
    .slice(start, index)
    .map((heading) => heading.text)
    .reverse();
}

function afterTexts(headings: readonly Heading[], index: number): string[] {
  return headings
    .slice(index + 1, index + 1 + CONTEXT_WINDOW)
    .map((heading) => heading.text);
}

/**
 * Captures the anchor for `headings[index]`.
 *
 * Context arrays are nearest-first and capped at two entries; ordinal counts
 * earlier headings with the same normalized text.
 */
export function captureAnchor(
  headings: readonly Heading[],
  index: number,
): SectionAnchor {
  const heading = headings[index];
  if (heading === undefined) {
    throw new RangeError(`No heading at index ${index}`);
  }

  const normalized = normalizeHeadingText(heading.text);
  let ordinal = 0;
  for (let previous = 0; previous < index; previous += 1) {
    if (normalizeHeadingText(headings[previous].text) === normalized) {
      ordinal += 1;
    }
  }

  return {
    text: heading.text,
    depth: Math.min(4, Math.max(1, heading.depth)) as BookmarkDepth,
    before: beforeTexts(headings, index),
    after: afterTexts(headings, index),
    ordinal,
    order: index,
  };
}

function sideScore(
  anchorSide: readonly string[],
  candidateSide: readonly string[],
): number {
  let score = 0;
  const length = Math.min(
    anchorSide.length,
    candidateSide.length,
    CONTEXT_WINDOW,
  );
  for (let index = 0; index < length; index += 1) {
    if (
      normalizeHeadingText(candidateSide[index]) ===
      normalizeHeadingText(anchorSide[index])
    ) {
      score += index === 0 ? 2 : 1;
    }
  }
  // "Nothing on this side" is evidence too.
  if (anchorSide.length === 0 && candidateSide.length === 0) score += 2;
  return score;
}

function scoreCandidate(
  anchor: SectionAnchor,
  headings: readonly Heading[],
  index: number,
): number {
  const heading = headings[index];
  return (
    sideScore(anchor.before, beforeTexts(headings, index)) +
    sideScore(anchor.after, afterTexts(headings, index)) +
    (heading.depth === anchor.depth ? 1 : 0)
  );
}

function resolved(
  headings: readonly Heading[],
  index: number,
  via: ResolvedHeading["via"],
): ResolvedHeading {
  const heading = headings[index];
  return {
    kind: "resolved",
    index,
    slug: heading.slug,
    text: heading.text,
    depth: heading.depth,
    via,
  };
}

/**
 * Finds the heading an anchor points at in the current outline.
 *
 * Never throws and never returns an arbitrary candidate: ties are stale, and a
 * stale resolution carries no slug, so it cannot scroll somewhere else.
 */
export function resolveHeading(
  anchor: SectionAnchor,
  headings: readonly Heading[],
): HeadingResolution {
  const normalizedText = normalizeHeadingText(anchor.text);
  const textCandidates: number[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    if (normalizeHeadingText(headings[index].text) === normalizedText) {
      textCandidates.push(index);
    }
  }

  if (textCandidates.length === 1) {
    return resolved(headings, textCandidates[0], "text");
  }

  if (textCandidates.length > 1) {
    const scored = textCandidates.map((index) => ({
      index,
      score: scoreCandidate(anchor, headings, index),
    }));
    const best = Math.max(...scored.map((candidate) => candidate.score));
    const tied = scored.filter((candidate) => candidate.score === best);

    if (tied.length === 1) return resolved(headings, tied[0].index, "text");
    if (best === 0 && anchor.ordinal < textCandidates.length) {
      return resolved(headings, textCandidates[anchor.ordinal], "occurrence");
    }
    return { kind: "stale", reason: "ambiguous" };
  }

  // No exact text: the heading text was edited. Context can repair it, but the
  // depth must still match and *both* sides of the window must be consistent.
  // Requiring both sides prevents a deleted heading from handing its context to
  // an unrelated neighbour (the silent-jump case the spec forbids).
  const contextCandidates: number[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index].depth !== anchor.depth) continue;
    const beforeEvidence = sideScore(anchor.before, beforeTexts(headings, index));
    const afterEvidence = sideScore(anchor.after, afterTexts(headings, index));
    if (beforeEvidence > 0 && afterEvidence > 0) contextCandidates.push(index);
  }

  if (contextCandidates.length === 0) {
    return { kind: "stale", reason: "missing" };
  }

  const scored = contextCandidates.map((index) => ({
    index,
    score: scoreCandidate(anchor, headings, index),
  }));
  const best = Math.max(...scored.map((candidate) => candidate.score));
  const tied = scored.filter((candidate) => candidate.score === best);
  if (tied.length === 1) return resolved(headings, tied[0].index, "context");
  return { kind: "stale", reason: "ambiguous" };
}

/** Narrows a resolution to the resolved branch. */
export function isResolved(
  resolution: HeadingResolution | undefined,
): resolution is ResolvedHeading {
  return resolution?.kind === "resolved";
}
