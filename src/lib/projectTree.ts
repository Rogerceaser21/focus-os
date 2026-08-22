import type { Project } from '@/types/task';

/**
 * One rendered top-level row plus the sub-projects that hang off it.
 * `subs` is empty for an ordinary project with no children.
 */
export interface ProjectTreeNode {
  parent: Project;
  subs: Project[];
}

/**
 * Pure, side-effect free grouping of a FLAT project list into the one-level
 * tree the drawer renders. No state, no fetching, no sorting beyond the input
 * order, so it can be reasoned about (and diffed) on its own.
 *
 * Rules, all of them defensive rather than trusting:
 *  - a project is a SUB only when its parentProjectId names another project
 *    that is present in the SAME list. An orphan (parent archived, deleted,
 *    shared-out, or simply not in this list) is treated as top level, so a row
 *    can never disappear from the drawer just because its parent is missing.
 *  - a project can never be its own parent (self-reference is ignored).
 *  - ONE LEVEL ONLY: if a bad row points at a parent that is itself a sub, the
 *    grandchild is promoted to top level instead of nesting two deep. The app
 *    refuses to create that shape (see the move guard in Index.tsx); this is
 *    the render-side belt for a row that got there some other way.
 *  - input order is preserved, both for the top-level rows and within `subs`.
 */
export function groupProjectTree(projects: Project[]): ProjectTreeNode[] {
  const byId = new Map<string, Project>();
  for (const p of projects) byId.set(p.id, p);

  // Resolve each project's EFFECTIVE parent id (null = top level), applying the
  // self-reference, orphan and one-level rules above in one pass.
  const effectiveParentId = (p: Project): string | null => {
    const parentId = p.parentProjectId;
    if (!parentId || parentId === p.id) return null;
    const parent = byId.get(parentId);
    if (!parent) return null; // orphan -> top level
    // Grandchild guard: the parent itself points at a third project.
    if (parent.parentProjectId && parent.parentProjectId !== parent.id && byId.has(parent.parentProjectId)) {
      return null;
    }
    return parentId;
  };

  const nodes: ProjectTreeNode[] = [];
  const nodeByParentId = new Map<string, ProjectTreeNode>();

  for (const p of projects) {
    if (effectiveParentId(p) === null) {
      const node: ProjectTreeNode = { parent: p, subs: [] };
      nodes.push(node);
      nodeByParentId.set(p.id, node);
    }
  }

  for (const p of projects) {
    const parentId = effectiveParentId(p);
    if (parentId === null) continue;
    // The parent is top level by construction (grandchild guard above), so it
    // always has a node here.
    nodeByParentId.get(parentId)?.subs.push(p);
  }

  return nodes;
}

/**
 * Count of the projects in `projects` that sit directly under `parentId`.
 * Used for the "(N sub-projects)" suffix on an archived parent row and for the
 * move guard's "this project still has sub-projects" test.
 */
export function countSubProjects(projects: Project[], parentId: string): number {
  return projects.filter((p) => p.parentProjectId === parentId).length;
}

/**
 * Ids of the projects in `projects` that sit directly under `parentId`.
 *
 * Pure and defensive in the same way groupProjectTree is: it never walks past
 * one level (a sub can't be a parent), and it only ever reports rows that are
 * PRESENT in the list it was handed — so passing the active-only project list
 * yields the ACTIVE subs, which is exactly the roll-up scope P4 wants (an
 * archived sub must not drag its tasks into its parent's view).
 *
 * `parentId` being itself a sub yields an empty set, so a sub-project's own
 * view always shows exactly its own tasks.
 */
export function subProjectIdsOf(projects: Project[], parentId: string | null | undefined): Set<string> {
  if (!parentId) return new Set<string>();
  const self = projects.find((p) => p.id === parentId);
  if (self?.parentProjectId) return new Set<string>();
  return new Set(projects.filter((p) => p.id !== parentId && p.parentProjectId === parentId).map((p) => p.id));
}
