/**
 * Pure composition of the OS window title.
 *
 * `project — filename — docdeck` when the active document belongs to a project,
 * `filename — docdeck` when it does not, and exactly `docdeck` when no document
 * is active. Path helpers are shared with the sidebar so the deepest `_ai`
 * segment, Windows separators and Unicode filenames behave identically.
 */

import { fileName, projectName } from "./project";

const SEPARATOR = " \u2014 ";

export function composeWindowTitle(activePath: string | null): string {
  if (activePath === null) return "docdeck";

  const filename = fileName(activePath);
  const project = projectName(activePath);
  return project === null
    ? `${filename}${SEPARATOR}docdeck`
    : `${project}${SEPARATOR}${filename}${SEPARATOR}docdeck`;
}
