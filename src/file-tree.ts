/** A Markdown document row in the folder picker. */
export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
}

/** A collapsible directory row in the folder picker. */
export interface TreeDirectory {
  kind: "directory";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDirectory;

/**
 * Builds a nested tree from absolute file paths beneath `root`.
 *
 * The scanner returns a flat, sorted list; the picker wants folders. Keeping
 * the transform pure makes the awkward cases — a file directly under the root,
 * a path outside it — unit-testable without a DOM. Files outside the root are
 * ignored: the scanner cannot produce them, and guessing a home for them would
 * corrupt the tree's paths.
 */
export function buildTree(root: string, files: string[]): TreeDirectory {
  const rootNode: TreeDirectory = {
    kind: "directory",
    name: root,
    path: root,
    children: [],
  };

  for (const file of files) {
    if (!file.startsWith(`${root}/`)) continue;

    const relative = file.slice(root.length + 1);
    const segments = relative.split("/");
    let directory = rootNode;

    for (const segment of segments.slice(0, -1)) {
      let child = directory.children.find(
        (candidate): candidate is TreeDirectory =>
          candidate.kind === "directory" && candidate.name === segment,
      );
      if (!child) {
        child = {
          kind: "directory",
          name: segment,
          path: `${directory.path}/${segment}`,
          children: [],
        };
        directory.children.push(child);
      }
      directory = child;
    }

    const name = segments[segments.length - 1];
    if (name !== undefined) {
      directory.children.push({ kind: "file", name, path: file });
    }
  }

  sortChildren(rootNode);
  return rootNode;
}

/** Directories first, then files, each alphabetical. */
function sortChildren(node: TreeDirectory): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of node.children) {
    if (child.kind === "directory") sortChildren(child);
  }
}