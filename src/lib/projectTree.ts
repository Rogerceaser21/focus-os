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

/**
 * The one message BOTH halves of the one-level rule refuse with. Kept as a
 * constant so the drawer's drag-and-drop path and the "Move to..." sheet can
 * never drift apart on wording.
 */
export const MOVE_SUBS_FIRST = 'Move its sub-projects first';

/**
 * Pure guard for "may `movingId` become a sub of `targetParentId`?".
 *
 * Returns the refusal MESSAGE when the move breaks the one-level rule, or
 * `null` when it is allowed. Both halves of the rule live here:
 *   - the mover must not already have sub-projects of its own (active OR
 *     archived — pass both lists in `allProjects`), because a sub with subs
 *     would nest two deep;
 *   - the target must exist and must itself be top level.
 *
 * `targetParentId === null` ("top level") is ALWAYS allowed, sub-projects and
 * all. Self-parent and "already sits there" are deliberately NOT handled here:
 * they are silent no-ops for the caller, not refusals the user should see a
 * toast for.
 */
export function projectMoveRefusal(
  movingId: string,
  targetParentId: string | null,
  allProjects: Pick<Project, 'id' | 'parentProjectId'>[],
): string | null {
  if (!targetParentId) return null;
  if (allProjects.some((p) => p.parentProjectId === movingId)) return MOVE_SUBS_FIRST;
  const target = allProjects.find((p) => p.id === targetParentId);
  if (!target || target.parentProjectId) return MOVE_SUBS_FIRST;
  return null;
}

// ---- Manual order + pinning (O8) --------------------------------------------
// Two additive columns carry both: `sort_order` (position inside ONE sibling
// group) and `pinned_at` (the drawer's Pinned group). Everything below is a pure
// function over already-fetched rows, so every surface that lists projects
// derives the SAME order during render instead of correcting it after paint.

/** Hard cap on pinned rows, top-level projects and sub-projects combined. */
export const PIN_LIMIT = 5;

/** The one refusal the cap speaks with, so every surface says the same thing. */
export const PIN_LIMIT_MESSAGE = `You can pin up to ${PIN_LIMIT} projects`;

/**
 * A row that has never been dragged sorts AFTER every hand-ordered sibling, and
 * keeps its incoming position among the other unordered rows (the loader hands
 * them over newest first). That is deliberate: an account that never reorders
 * renders in exactly the order it always did, and a project created after a
 * reorder lands at the end of the group rather than jumping into the middle.
 */
const orderKey = (p: Pick<Project, 'sortOrder'>): number =>
  typeof p.sortOrder === 'number' ? p.sortOrder : Number.MAX_SAFE_INTEGER;

/** Comparator for ONE sibling group. Ties keep input order (Array#sort is stable). */
export function compareSiblingOrder(a: Pick<Project, 'sortOrder'>, b: Pick<Project, 'sortOrder'>): number {
  return orderKey(a) - orderKey(b);
}

export function isPinnedProject(p: Pick<Project, 'pinnedAt'>): boolean {
  return !!p.pinnedAt;
}

/** How many of these rows are pinned. The cap counts projects and subs together. */
export function countPinned(projects: Pick<Project, 'pinnedAt'>[]): number {
  return projects.filter(isPinnedProject).length;
}

/** Pinned rows sit in the order they were pinned, oldest pin first. */
function comparePinnedAt(a: Pick<Project, 'pinnedAt'>, b: Pick<Project, 'pinnedAt'>): number {
  const ka = a.pinnedAt ?? '';
  const kb = b.pinnedAt ?? '';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Apply the manual order to an already-grouped tree: top-level rows against each
 * other, and each parent's subs against each other. Grouping itself is left to
 * groupProjectTree, so the orphan / one-level / self-parent rules stay in one place.
 */
export function sortProjectTree(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  return [...nodes]
    .sort((a, b) => compareSiblingOrder(a.parent, b.parent))
    .map((n) => ({ parent: n.parent, subs: [...n.subs].sort(compareSiblingOrder) }));
}

/**
 * One entry of the drawer's Pinned group. A pinned TOP-LEVEL project floats up as
 * its whole block (its subs travel with it, so the tree is never torn apart); a
 * pinned SUB whose parent is not itself pinned gets a flat shortcut row and ALSO
 * keeps its place in its parent's tree below.
 */
export type PinnedEntry =
  | { kind: 'block'; node: ProjectTreeNode }
  | { kind: 'sub'; project: Project };

const entryProject = (e: PinnedEntry): Project => (e.kind === 'block' ? e.node.parent : e.project);

/**
 * Split a sorted tree into the Pinned group and what is left for "My Projects".
 * A pinned parent leaves the My Projects list entirely (it is rendered above);
 * a pinned sub is only ever ADDED to the pinned group, never removed from its
 * parent's tree.
 *
 * DEFENCE IN DEPTH (O11): the cap is normally enforced before a write ever
 * happens (Index's pin handler refuses a 6th pin), but a row can still arrive
 * here already over the cap — e.g. the MCP archive_project cascade used to
 * leave pinned_at set on an archived row, and restoring it later then let a
 * 6th pin back onto the board. Whatever the cause, this function must never
 * RENDER more than PIN_LIMIT pinned rows: past the cap, keep the PIN_LIMIT
 * OLDEST pins (ties broken by id, so every surface agrees byte for byte) and
 * fall the rest back to unpinned, exactly as if they had never been pinned.
 * Pure derive-during-render — no write-back to the database happens here.
 */
export function splitPinnedTree(nodes: ProjectTreeNode[]): { pinned: PinnedEntry[]; rest: ProjectTreeNode[] } {
  const candidates: PinnedEntry[] = [];
  for (const node of nodes) {
    if (isPinnedProject(node.parent)) {
      // The whole block is the pinned entry; its subs ride inside it, so a
      // pinned sub under a pinned parent must NOT also become a shortcut row
      // (it would render twice and inflate the heading count). Matches the
      // PinnedEntry docstring: a sub gets a shortcut only when its parent is
      // not itself pinned. Corner: if this block is clamped out below
      // (breached cap), its pinned subs get no shortcut either - fail-safe,
      // the sub still renders nested in the block back in My Projects.
      candidates.push({ kind: 'block', node });
      continue;
    }
    for (const sub of node.subs) {
      if (isPinnedProject(sub)) candidates.push({ kind: 'sub', project: sub });
    }
  }
  const byPinnedAtThenId = (a: PinnedEntry, b: PinnedEntry): number =>
    comparePinnedAt(entryProject(a), entryProject(b)) || entryProject(a).id.localeCompare(entryProject(b).id);

  const pinned = [...candidates].sort(byPinnedAtThenId).slice(0, PIN_LIMIT);
  const keptBlockIds = new Set(
    pinned.filter((e): e is Extract<PinnedEntry, { kind: 'block' }> => e.kind === 'block').map((e) => e.node.parent.id),
  );

  const rest: ProjectTreeNode[] = [];
  for (const node of nodes) {
    // A block stays out of "rest" only while it is actually within the kept
    // set; an overflow block (pinned in the data, clamped out here) falls
    // straight back into My Projects at its normal tree position.
    if (isPinnedProject(node.parent) && keptBlockIds.has(node.parent.id)) continue;
    rest.push(node);
  }
  return { pinned, rest };
}

/**
 * The flat list every NON-drawer surface renders (the Move to... targets, the
 * task dialog's project picker): pinned first in pin order, then the manual
 * order, parents immediately followed by their own subs. Deduped by id, so a
 * pinned sub appears once, at its pinned position.
 */
export function sortProjectsForDisplay(projects: Project[]): Project[] {
  const nodes = sortProjectTree(groupProjectTree(projects));
  const { pinned, rest } = splitPinnedTree(nodes);
  const out: Project[] = [];
  const pushNode = (n: ProjectTreeNode) => { out.push(n.parent, ...n.subs); };
  for (const entry of pinned) {
    if (entry.kind === 'block') pushNode(entry.node);
    else out.push(entry.project);
  }
  for (const node of rest) pushNode(node);
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** One row's new position, as written to focusos_projects.sort_order. */
export interface SiblingOrderUpdate {
  id: string;
  sortOrder: number;
}

/**
 * Move `movingId` before or after `targetId` inside ONE sibling group and
 * RENORMALISE the whole group to 0..n-1, so a group can never run out of room
 * between two neighbours and a half-ordered group (some rows still null) becomes
 * fully ordered the first time it is touched.
 *
 * `group` must arrive in the order it is RENDERED. Returns an empty list for
 * every no-op (unknown ids, dropping a row on itself, an order that did not
 * actually change), so the caller writes nothing and says nothing.
 */
export function reorderSiblings(
  group: Project[],
  movingId: string,
  targetId: string,
  place: 'before' | 'after',
): SiblingOrderUpdate[] {
  if (movingId === targetId) return [];
  const moving = group.find((p) => p.id === movingId);
  const targetIndex = group.findIndex((p) => p.id === targetId);
  if (!moving || targetIndex < 0) return [];

  const without = group.filter((p) => p.id !== movingId);
  const anchor = without.findIndex((p) => p.id === targetId);
  if (anchor < 0) return [];
  const at = place === 'before' ? anchor : anchor + 1;
  const next = [...without.slice(0, at), moving, ...without.slice(at)];

  if (next.every((p, i) => p.id === group[i].id)) return [];
  return next.map((p, i) => ({ id: p.id, sortOrder: i }));
}

/**
 * The sort_order a NEW project should be created with inside `siblings`.
 * `null` when that group has never been ordered by hand: leaving the column null
 * keeps such an account's drawer byte-identical to what it rendered before O8.
 */
export function nextSiblingSortOrder(siblings: Pick<Project, 'sortOrder'>[]): number | null {
  const used = siblings
    .map((p) => p.sortOrder)
    .filter((n): n is number => typeof n === 'number');
  if (used.length === 0) return null;
  return Math.max(...used) + 1;
}

/** Where a drop lands relative to the row under it. */
export type DropPlace = 'before' | 'after' | 'nest';

/**
 * Pure geometry for "did the user aim at the seam between two rows, or at the
 * row itself?". `centreY` is the dragged ghost's vertical centre and `rect` the
 * target's measured box, both in viewport coordinates.
 *
 * With nesting allowed (a top-level block) only a thin band at each edge
 * reorders, so U2's drop-anywhere-to-nest still owns the body of the block. On a
 * sub row nesting is illegal (one level only), so the row splits in half.
 */
export function dropPlaceFor(
  centreY: number,
  rect: { top: number; height: number },
  opts: { allowNest: boolean },
): DropPlace {
  const { top, height } = rect;
  if (!opts.allowNest) return centreY < top + height / 2 ? 'before' : 'after';
  const band = Math.min(14, height * 0.3);
  if (centreY < top + band) return 'before';
  if (centreY > top + height - band) return 'after';
  return 'nest';
}
