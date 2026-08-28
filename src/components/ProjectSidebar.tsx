import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchProjects as fetchProjectsShared,
  fetchMemberProjectIds as fetchMemberIdsShared,
  fetchMeetingsList as fetchMeetingsListShared,
  fetchSharedItems as fetchSharedItemsShared,
  fetchProjectInvitations as fetchProjectInvitationsShared,
  appDataKeys,
  mergeByIdDesc,
  isProjectArchived,
  isSubProject,
  type RawProjectRow,
} from '@/lib/appDataFetchers';
import {
  groupProjectTree,
  countSubProjects,
  projectMoveRefusal,
  sortProjectTree,
  splitPinnedTree,
  reorderSiblings,
  nextSiblingSortOrder,
  dropPlaceFor,
  type SiblingOrderUpdate,
} from '@/lib/projectTree';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Folder, ListTodo, Calendar, HelpCircle, Mic, Search, Share2, CheckCircle2, XCircle, FileText, ClipboardList, Users, Clock, EyeOff, X, ArchiveRestore, ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ShareStatusPopover, SharedRecipient } from './ShareStatusPopover';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CreateProjectDialog } from './CreateProjectDialog';
import { TourLoadingOverlay } from './TourLoadingOverlay';
import AnimatedList from './AnimatedList';
import { useSidebar } from '@/components/ui/sidebar';
import Fuse from 'fuse.js';
import { SidebarScrollArea } from './SidebarScrollArea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Module scope on purpose: the RSVP edge sync must dedup across MOUNTS (host-page
// drawer -> /app drawer is two mounts in one journey), which a ref cannot do.
let lastRsvpSyncAt = 0;

// ---- Drag-and-drop project moves (U2): ids, sensor, collision ---------------
// Namespaced ids keep draggables and droppables apart in one flat dnd-kit id
// space, and make every id parseable back to a project id in onDragEnd.
const DRAG_ID_PREFIX = 'proj-';
const DROP_PARENT_PREFIX = 'drop-parent-';
// O8: one droppable per SUB row, so a sub can be aimed at individually for a
// reorder inside its parent. A drop that is NOT a sibling reorder still resolves
// back to the sub's parent block, which is exactly what U2 did when the block
// was the only target.
const DROP_SUB_PREFIX = 'drop-sub-';
const DROP_TOP_ID = 'drop-top';

/**
 * PointerSensor that ignores TOUCH pointers.
 *
 * dnd-kit binds ONE activator per event name and the first to fire wins
 * (core.esm.js: bindActivatorToSensorInstantiator bails once activeRef is set).
 * For a touch, `pointerdown` fires BEFORE `touchstart`, so a stock PointerSensor
 * swallows every touch and the TouchSensor's delay constraint never applies.
 * On the task list that is harmless — its listeners live on a `touch-none` grip,
 * where an 8px activation is exactly the wanted feel. Here the handle IS the
 * row, and the drawer must still SCROLL under a finger that starts on one, so an
 * 8px distance activation would turn the start of every scroll into a drag.
 * Returning false hands the gesture to the touchstart activator instead
 * (TouchSensor, delay 250 / tolerance 8) — which is what makes "tap selects,
 * long-press drags, moving finger scrolls" work.
 */
class MousePointerSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators = [
    {
      eventName: 'onPointerDown',
      handler: ({ nativeEvent: event }, { onActivation }) => {
        if (event.pointerType === 'touch') return false;
        if (!event.isPrimary || event.button !== 0) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/**
 * Nesting is a 2D aim (a row, or the header above the list), not a 1D reorder,
 * so the task list's closestCenter is wrong here: it always names SOME target,
 * which would nest a project the user meant to drop in empty space. pointerWithin
 * only fires when the pointer is genuinely inside a target's box; rectIntersection
 * is the fallback for the keyboard/programmatic path, where there is no pointer.
 * Neither ever invents a target out of an empty drop.
 */
const rectArea = (rects: Map<UniqueIdentifier, ClientRect>, id: UniqueIdentifier): number => {
  const rect = rects.get(id);
  return rect ? rect.width * rect.height : Number.MAX_SAFE_INTEGER;
};

const projectDropCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  // O8: a sub row sits INSIDE its parent's block, so a pointer over it is inside
  // two targets at once. Smallest box wins, deterministically, instead of relying
  // on pointerWithin's centre-distance tie-break: over a sub row that is the sub,
  // over the parent row (which no sub covers) it is still the block.
  if (pointerCollisions.length > 0) {
    return [...pointerCollisions].sort(
      (a: Collision, b: Collision) => rectArea(args.droppableRects, a.id) - rectArea(args.droppableRects, b.id),
    );
  }
  return rectIntersection(args);
};

/**
 * What a drop would do: U2's "nest under this project" (targetParentId null =
 * back to top level), or O8's "land in this seam between two siblings".
 */
type ResolvedDrop =
  | { kind: 'nest'; targetParentId: string | null }
  | { kind: 'reorder'; targetId: string; place: 'before' | 'after'; groupParentId: string | null };

interface DraggableProjectRowProps {
  project: Project;
  selected: boolean;
  /** The block this row heads is the CURRENT, LEGAL drop target. */
  dropTarget: boolean;
  className: string;
  onSelect: () => void;
}

/**
 * One own, ACTIVE project row — top level or sub. The whole row is the drag
 * handle (no grip, no mode). Shared and archived rows deliberately do NOT use
 * this component: neither is a legal mover or a legal target.
 */
const DraggableProjectRow = ({ project, selected, dropTarget, className, onSelect }: DraggableProjectRowProps) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${DRAG_ID_PREFIX}${project.id}`,
  });
  return (
    <Button
      ref={setNodeRef}
      // The drop-target highlight IS the selected-row look — the same
      // variant="secondary" the drawer already uses, not a new visual system.
      variant={selected || dropTarget ? 'secondary' : 'ghost'}
      className={className}
      data-testid={`select-project-${project.id}`}
      // touchAction MANIPULATION, never `none`: the drawer must keep scrolling
      // under a finger that starts on a row. Opacity while dragging is a static
      // value with no transition and no keyframe, so no compositing layer is
      // animated into or out of existence (iOS Safari white-flash law).
      style={{ touchAction: 'manipulation', opacity: isDragging ? 0.4 : undefined }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
    >
      <Folder className="h-4 w-4 shrink-0" style={{ color: project.color }} />
      <span className="truncate">{project.name}</span>
    </Button>
  );
};

/**
 * The 2px bar that shows where a reordered row will land (O8). Absolutely
 * positioned inside its already-laid-out wrapper, so it costs ZERO layout while
 * dragging, and it is a plain static div: no transition, no keyframe, so no
 * compositing layer is animated into existence (iOS Safari white-flash law).
 * Pixel radius, never a percentage.
 */
const DropInsertLine = ({ where, testId }: { where: 'before' | 'after'; testId: string }) => (
  <div
    data-testid={testId}
    aria-hidden="true"
    className="pointer-events-none absolute left-2 right-2 h-[2px] rounded-[1px] bg-primary"
    style={where === 'before' ? { top: -3 } : { bottom: -3 }}
  />
);

interface ProjectDropBlockProps {
  parentId: string;
  canAccept: boolean;
  dataAttrs: Record<string, string>;
  /** Reorder seam currently aimed at, or null when this block is not the target. */
  insertLine: 'before' | 'after' | null;
  children: (dropTarget: boolean) => ReactNode;
}

/**
 * A top-level project's WHOLE block (its row plus any expanded subs) is the drop
 * target for "nest under this project", so a drop anywhere on the group lands
 * where the user is looking. Render-prop so the row inside can wear the
 * highlight without the block having to know how a row is drawn.
 */
const ProjectDropBlock = ({ parentId, canAccept, dataAttrs, insertLine, children }: ProjectDropBlockProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: `${DROP_PARENT_PREFIX}${parentId}` });
  return (
    /* `relative` only anchors the insert line: with no offsets it changes no
       geometry and creates no stacking context, so the block lays out exactly
       as it did before O8. */
    <div ref={setNodeRef} className="w-full relative" data-testid={`project-block-${parentId}`} {...dataAttrs}>
      {insertLine && <DropInsertLine where={insertLine} testId={`drop-line-${insertLine}-${parentId}`} />}
      {children(isOver && canAccept)}
    </div>
  );
};

interface SubDropRowProps {
  subId: string;
  insertLine: 'before' | 'after' | null;
  children: ReactNode;
}

/**
 * One sub row's own droppable (O8). It wraps the SAME `pl-10` box P3 already
 * rendered, so the tree's geometry is untouched; the only additions are the
 * droppable ref and the insert line's anchor.
 */
const SubDropRow = ({ subId, insertLine, children }: SubDropRowProps) => {
  const { setNodeRef } = useDroppable({ id: `${DROP_SUB_PREFIX}${subId}` });
  return (
    <div ref={setNodeRef} className="w-full pl-10 relative" data-testid={`tree-sub-${subId}`}>
      {insertLine && <DropInsertLine where={insertLine} testId={`drop-line-${insertLine}-${subId}`} />}
      {children}
    </div>
  );
};

/**
 * The "My Projects" heading doubles as the "move to top level" drop target — the
 * un-nest half of the gesture. Geometry is untouched (same px-4 mb-2 box); only
 * a background is added while it is the live target, with a PIXEL radius.
 */
const ProjectsHeaderDrop = ({ count, canAccept }: { count: number; canAccept: boolean }) => {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_TOP_ID });
  const dropTarget = isOver && canAccept;
  return (
    <div
      ref={setNodeRef}
      data-testid="projects-drop-top"
      className={`px-4 mb-2 rounded-lg${dropTarget ? ' bg-secondary' : ''}`}
    >
      <h3 className="text-sm font-medium text-muted-foreground">My Projects ({count})</h3>
    </div>
  );
};

interface ProjectSidebarProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectSpecialList: (list: 'unassigned' | 'today' | 'past-due' | null) => void;
  selectedSpecialList: 'unassigned' | 'today' | 'past-due' | null;
  projectRefreshTrigger?: number;
  onProjectCreated?: () => void;
  onStartTour?: () => void;
  onStartTaskTour?: () => void;
  onStartProjectsTour?: () => void;
  createDialogOpen?: boolean;
  onCreateDialogOpenChange?: (open: boolean) => void;
  /**
   * Parent project preselected in the Create Project dialog when it is opened
   * by whoever controls `createDialogOpen` (the onebar's "New sub-project"
   * row). Ignored when the dialog is opened from the drawer's own
   * "New Project" button, which always starts at "None (top level)".
   */
  createParentProjectId?: string | null;
  isTourActive?: boolean;
  userId?: string;
  senderProjectSharedMap?: Record<string, SharedRecipient[]>;
  /**
   * OVERLAY MODE (host pages: /home, /meetings, /meetings/:id — see
   * ProjectsDrawerHost.tsx). The drawer opens OVER whatever page the user is
   * on: the portalled overlay+panel branch renders at EVERY width (desktop
   * included), open/close comes from the `open` / `onOpenChange` pair instead
   * of the SidebarProvider context (host pages have no provider — useSidebar
   * falls back to a no-op there), and the component's own data layer stays
   * asleep until the drawer is first opened.
   *
   * Default (prop omitted) = /app behaviour, unchanged: mobile portal branch,
   * desktop in-flow panel, context-driven, fetch on mount.
   */
  overlayMode?: boolean;
  /** Overlay mode only: the host's open state. */
  open?: boolean;
  /** Overlay mode only: the host's setter. */
  onOpenChange?: (open: boolean) => void;
  /**
   * O7 (2026-08-26): bump this after a share/cancel/accept/decline event on
   * the host page so the drawer's OWN Shared Items section (sharedItems
   * state, fed by fetchSharedItems) refetches without a full reload. Mirrors
   * `projectRefreshTrigger`: a plain counter, not the fetch mechanism itself.
   */
  sharedItemsRefreshTrigger?: number;
  /**
   * O7: called after THIS drawer's own accept/decline/cancel actions mutate
   * `focusos_shared_items` server-side, so the host page's sender-side pill
   * data (senderSharedItems / senderSharedMap, a query key this component
   * never observes) can refresh too. The drawer's own fetchSharedItems refetch
   * already keeps this section correct; this callback is purely outbound.
   */
  onSenderSharedItemsChanged?: () => void;
}

export const ProjectSidebar = ({
  selectedProjectId,
  onSelectProject,
  onSelectSpecialList,
  selectedSpecialList,
  projectRefreshTrigger,
  onProjectCreated,
  onStartTour,
  onStartTaskTour,
  onStartProjectsTour,
  createDialogOpen,
  onCreateDialogOpenChange,
  createParentProjectId = null,
  isTourActive,
  userId,
  senderProjectSharedMap = {},
  overlayMode,
  open: overlayOpen,
  onOpenChange: overlayOnOpenChange,
  sharedItemsRefreshTrigger,
  onSenderSharedItemsChanged,
}: ProjectSidebarProps) => {
  const isOverlay = !!overlayMode;
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
  // Owned projects with archived_at set — rendered in the Archived section at
  // the bottom of the drawer (Restore only, no rename/delete there).
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  // Quiet by default: the section starts collapsed so an account with several
  // archived projects doesn't push "My Projects" further down the drawer.
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);
  const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null);
  // Per-parent expand state for the sub-project tree, keyed by parent id. This
  // session's toggles only; the persisted map is read from localStorage DURING
  // RENDER (treeOpen below) and the two are merged, so nothing here is corrected
  // by a post-paint effect.
  const [treeOpenOverride, setTreeOpenOverride] = useState<Record<string, boolean>>({});
  const [meetings, setMeetings] = useState<{ id: string; title: string }[]>([]);
  const [sharedItems, setSharedItems] = useState<any[]>([]);
  const [projectInvitations, setProjectInvitations] = useState<any[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);
  const [decliningInviteId, setDecliningInviteId] = useState<string | null>(null);
  const [isCreateOpenInternal, setIsCreateOpenInternal] = useState(false);
  const [sidebarSearchInput, setSidebarSearchInput] = useState('');
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Timestamp of the last successful projects load — used to skip the redundant
  // TOKEN_REFRESHED refire (see the auth-state effect below).
  const lastFetchAtRef = useRef(0);
  // Once-per-load latch for the heavy Google-RSVP edge sync (see syncRsvpThenRefresh).
  const rsvpSyncedRef = useRef(false);
  // Full set of this user's shared projects (id/name/color, pre active-filter). Kept so the
  // realtime task handler can (a) test whether a changed task belongs to a shared project
  // and (b) re-run the active-filter without a full fetchProjects. Includes projects hidden
  // by the filter, so a task reopening in a hidden project can bring it back.
  const sharedProjectsAllRef = useRef<{ id: string; name: string; color: string }[]>([]);
  // Debounce timer + latest-closure ref for the targeted shared-visibility recompute.
  const sharedVisibilityDebounceRef = useRef<number | null>(null);
  const recomputeSharedVisibilityRef = useRef<() => void>(() => {});

  // Debounce sidebar search
  useEffect(() => {
    const timer = setTimeout(() => setSidebarSearchQuery(sidebarSearchInput), 300);
    return () => clearTimeout(timer);
  }, [sidebarSearchInput]);
  
  // Use controlled state if provided, otherwise use internal state
  const isCreateOpen = createDialogOpen !== undefined ? createDialogOpen : isCreateOpenInternal;
  const setIsCreateOpen = onCreateDialogOpenChange || setIsCreateOpenInternal;

  // PERF, overlay mode only: the host pages mount this drawer PERMANENTLY but
  // closed (white-flash law), so none of its own cost may land on their page
  // load — no projects/meetings/shared-items/invitations reads, no realtime
  // channels, no RSVP edge sync — until the drawer is first opened. Latched on
  // at that first open and never off again (reopening must not refetch from
  // scratch). The latch is STATE, adjusted during render, not a ref: a ref
  // mutation survives a discarded router transition while the queued state
  // update dies, and the replay would then skip the arming (render-phase law).
  // /app (isOverlay false) starts armed, so its fetch-on-mount is untouched.
  const [dataArmed, setDataArmed] = useState(!overlayMode);
  if (isOverlay && overlayOpen && !dataArmed) setDataArmed(true);
  // The single gate every data effect keys off: undefined => that effect is a
  // no-op and holds no subscription.
  const dataUserId = dataArmed ? userId : undefined;

  useEffect(() => {
    if (!dataUserId) return;
    fetchProjects();
    fetchMeetings();
    fetchSharedItems();
    fetchProjectInvitations();
  }, [projectRefreshTrigger, dataUserId]);

  // O7 (2026-08-26): the host page bumps sharedItemsRefreshTrigger after a
  // share/assign event elsewhere (Edit Task sheet, project bar), so THIS
  // drawer's own Shared Items section (a local sharedItems useState mirror
  // of the shared React Query cache, not a live observer of it) refetches
  // without a full reload.
  //
  // LAST-HANDLED-TRIGGER guard (skeptic fix, 2026-08-26). The first cut was a
  // skip-first-run boolean, and the skeptic refuted it live: an overlay
  // drawer starts UNARMED (dataArmed above), a share that happens while it
  // is closed bumps the trigger, the unarmed run returns early WITHOUT
  // consuming the guard, and at arming the guard swallows exactly that
  // missed bump while the arming mount fetch (non-fresh) serves the
  // 5-minute stale cache warmed by an earlier /app visit. Net effect: the
  // session's first share never reached the /home drawer without a reload,
  // Igor's literal repro. Tracking the last trigger VALUE this instance
  // fetched for fixes the class: a mount (or arming) that sees a trigger it
  // has never handled and that is not the pristine 0 means a bump happened
  // while we could not fetch, so fetch fresh; a mount at 0 stays covered by
  // the mount effect above (no double-fetch).
  const sharedItemsLastTriggerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!dataUserId) return;
    const trigger = sharedItemsRefreshTrigger ?? 0;
    if (sharedItemsLastTriggerRef.current === null && trigger === 0) {
      // Pristine mount, nothing missed: the mount effect owns this fetch.
      sharedItemsLastTriggerRef.current = 0;
      return;
    }
    if (sharedItemsLastTriggerRef.current === trigger) return;
    sharedItemsLastTriggerRef.current = trigger;
    fetchSharedItems({ fresh: true });
  }, [sharedItemsRefreshTrigger, dataUserId]);

  // Deferred RSVP sync: 3s pushes the 2.5-11s edge call past the login critical path
  // (first task card paints ~2.8s). Once per load via rsvpSyncedRef.
  useEffect(() => {
    if (!dataUserId) return;
    const t = window.setTimeout(syncRsvpThenRefresh, 3000);
    return () => window.clearTimeout(t);
  }, [dataUserId]);

  // React to Supabase auth events after mount.
  useEffect(() => {
    if (!dataUserId) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        // A real sign-in must always (re)load, even right after a load. New session ->
        // allow one fresh RSVP sync too (still deferred off the sign-in interaction).
        fetchProjects({ fresh: true });
        fetchMeetings({ fresh: true });
        fetchSharedItems({ fresh: true });
        fetchProjectInvitations({ fresh: true });
        rsvpSyncedRef.current = false;
        window.setTimeout(syncRsvpThenRefresh, 3000);
      } else if (event === 'TOKEN_REFRESHED') {
        // TOKEN_REFRESHED fires ~2s into almost every cold start and used to refire
        // the whole fetch set — a duplicate-request storm. The initial mount load,
        // now backed by the shared fetcher's empty-success retry, already recovers a
        // latched-empty sidebar (task ed4851e3), so skip this refire when a load
        // completed recently.
        if (Date.now() - lastFetchAtRef.current < 60_000) return;
        fetchProjects({ fresh: true });
        fetchMeetings({ fresh: true });
        fetchSharedItems({ fresh: true });
        fetchProjectInvitations({ fresh: true });
      }
    });
    return () => subscription.unsubscribe();
  }, [dataUserId]);

  // Supabase Realtime: live shared items for current user (as recipient)
  useEffect(() => {
    if (!dataUserId) return;

    const channel = supabase
      .channel('shared-items-realtime')
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'focusos_shared_items',
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload: any) => {
          const newItem = payload.new;
          const senderDisplay = newItem.sender_name || newItem.sender_email;
          toast.info(`📬 New item shared with you`, {
            description: `"${newItem.item_title}" from ${senderDisplay}`,
          });
          fetchSharedItems({ fresh: true });
        }
      )
      // Listen for updates too (when status changes to 'accepted' — notify sender)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'focusos_shared_items',
          filter: `sender_user_id=eq.${userId}`,
        },
        (payload: any) => {
          const updated = payload.new;
          const old = payload.old;
          // Notify sender when their shared item is accepted — queued via fetchSharedItems
          if (updated.status === 'accepted' && old?.status === 'pending') {
            // Don't show toast here — we'll show queued notifications from state
          }
          // Notify sender when recipient completes the shared item — queued via fetchSharedItems
          if (updated.completed_at && !old?.completed_at) {
            // Don't show toast here — queued from state
          }
          fetchSharedItems({ fresh: true });
        }
      )
      // O7 (2026-08-26): a share THIS user sends (as sender) is now also
      // caught live too, belt-and-braces coverage for a share made from another
      // device or the MCP, which the sharedItemsRefreshTrigger prop plumbing
      // (this same page's own share dialogs) cannot see. The deterministic
      // fix is the trigger prop above; this spec must not depend on this
      // realtime block firing.
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'focusos_shared_items',
          filter: `sender_user_id=eq.${userId}`,
        },
        () => {
          fetchSharedItems({ fresh: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dataUserId]);

  // Realtime: keep shared-project visibility live when this user's tasks change (status /
  // change-request updates). No full fetchProjects / fetchSharedItems fan-out per event —
  // the sidebar needs task data only for the shared-project active-filter. Recompute that
  // filter (one slim task read) debounced ~2s, and only when the changed task belongs to a
  // shared project. (DELETE's default replica identity omits project_id, so a delete can't
  // be targeted; an emptied shared project stays visible under the no-tasks rule and the
  // next fetchProjects self-heals, so this is acceptable.)
  useEffect(() => {
    if (!dataUserId) return;

    const taskChannel = supabase
      .channel('sidebar-tasks-realtime')
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'focusos_tasks',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const projectId = payload.new?.project_id ?? payload.old?.project_id;
          if (!projectId) return;
          if (!sharedProjectsAllRef.current.some((p) => p.id === projectId)) return;
          if (sharedVisibilityDebounceRef.current !== null) {
            window.clearTimeout(sharedVisibilityDebounceRef.current);
          }
          sharedVisibilityDebounceRef.current = window.setTimeout(() => {
            sharedVisibilityDebounceRef.current = null;
            recomputeSharedVisibilityRef.current();
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(taskChannel);
      if (sharedVisibilityDebounceRef.current !== null) {
        window.clearTimeout(sharedVisibilityDebounceRef.current);
        sharedVisibilityDebounceRef.current = null;
      }
    };
  }, [dataUserId]);

  // Helper: resolve a user's display name from profilesMap, falling back to email
  const resolveDisplayName = (userId: string | null, email: string) => {
    if (userId && profilesMap[userId]) return profilesMap[userId];
    return email;
  };

  // Fetch profiles for all unique user_ids in sharedItems
  useEffect(() => {
    if (sharedItems.length === 0) return;
    const userIds = new Set<string>();
    for (const item of sharedItems) {
      if (item.sender_user_id) userIds.add(item.sender_user_id);
      if (item.recipient_user_id) userIds.add(item.recipient_user_id);
    }
    if (userIds.size === 0) return;

    (async () => {
      const { data: profiles } = await (supabase as any)
        .from('focusos_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', Array.from(userIds));
      
      if (profiles) {
        const map: Record<string, string> = {};
        for (const p of profiles) {
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
          if (name) map[p.user_id] = name;
        }
        setProfilesMap(map);
      }
    })();
  }, [sharedItems]);

  // Queued notification: show one unacknowledged accepted item at a time for the sender
  useEffect(() => {
    if (!userId) return;
    const unacknowledged = sharedItems.filter(
      (item) => item.sender_user_id === userId && item.status === 'accepted' && !item.sender_acknowledged
    );
    if (unacknowledged.length > 0) {
      const first = unacknowledged[0];
      const recipientName = resolveDisplayName(first.recipient_user_id, first.recipient_email);
      // Use a stable toast ID so we don't stack duplicates
      toast.success(`✅ "${first.item_title}" was accepted`, {
        id: `accept-notify-${first.id}`,
        description: `${recipientName} accepted your shared ${first.item_type}`,
        duration: Infinity,
        action: {
          label: '✓ Dismiss',
          onClick: () => handleAcknowledgeSharedItem(first.id),
        },
      });
    }
  }, [sharedItems, userId]);

  // Queued completion notification: show one unacknowledged completed item at a time for the sender
  useEffect(() => {
    if (!userId) return;
    const completed = sharedItems.filter(
      (item) => item.sender_user_id === userId && item.completed_at && !item.completion_acknowledged
    );
    if (completed.length > 0) {
      const first = completed[0];
      const recipientName = resolveDisplayName(
        first.recipient_user_id,
        first.completed_by || first.recipient_email
      );
      const when = (() => {
        try {
          const d = new Date(first.completed_at);
          const diffMs = Date.now() - d.getTime();
          const mins = Math.floor(diffMs / 60000);
          if (mins < 1) return 'just now';
          if (mins < 60) return `${mins} min ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return d.toLocaleString();
        } catch {
          return '';
        }
      })();
      toast.success(`✅ "${first.item_title}" completed`, {
        id: `complete-notify-${first.id}`,
        description: `${recipientName} completed your shared ${first.item_type}${when ? ` · ${when}` : ''}`,
        duration: Infinity,
        action: {
          label: '✓ Dismiss',
          onClick: () => handleAcknowledgeCompletion(first.id),
        },
      });
    }
  }, [sharedItems, userId]);

  // Route projects through the shared single-flight fetcher so this sidebar and Index's
  // list share ONE request (same key), with the own/shared merge + empty-success retry
  // living in one place. `fresh` forces a network refetch for event-driven callers
  // (create / accept invite / realtime) that must not read the stale snapshot; the mount
  // load omits it so an in-flight Index/prefetch load is reused. The is_shared split and
  // the shared-task visibility filter below are unchanged.
  const fetchProjects = async (opts?: { fresh?: boolean }) => {
    if (!userId) return;
    let data: any[];
    try {
      if (opts?.fresh) {
        // Refresh memberships first so a just-accepted invite's shared project is included.
        await fetchMemberIdsShared(queryClient, userId, { fresh: true });
      }
      data = await fetchProjectsShared(queryClient, userId, { fresh: opts?.fresh });
    } catch (error) {
      console.error('[ProjectSidebar] fetchProjects failed after retries:', error);
      toast.error('Failed to load projects');
      return;
    }
    lastFetchAtRef.current = Date.now();

    // Split into own projects and shared projects
    const ownProjects = data.filter((p: any) => !p.is_shared);
    const shared = data.filter((p: any) => p.is_shared);
    // "My Projects" stays active-only; archived owned projects move to their own
    // section below instead — loadProjects itself still returns every row.
    const activeOwn = ownProjects.filter((p: RawProjectRow) => !isProjectArchived(p));
    const archivedOwn = ownProjects.filter((p: RawProjectRow) => isProjectArchived(p));
    setProjects(activeOwn.map((p: RawProjectRow) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      parentProjectId: isSubProject(p) ? p.parent_project_id : null,
      // O8: manual order + pin state ride along on every mapped row. loadProjects
      // selects '*', so both arrive without touching the fetcher's projection.
      sortOrder: p.sort_order ?? null,
      pinnedAt: p.pinned_at ?? null,
      timer: { totalSeconds: 0, isRunning: false }
    })));
    setArchivedProjects(archivedOwn.map((p: RawProjectRow) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      archivedAt: p.archived_at,
      parentProjectId: isSubProject(p) ? p.parent_project_id : null,
      // Carried through the archive too: nothing clears sort_order, so a restored
      // project comes back into the slot it was dragged to.
      sortOrder: p.sort_order ?? null,
      pinnedAt: p.pinned_at ?? null,
      timer: { totalSeconds: 0, isRunning: false }
    })));

    // Stash the full shared set for the realtime targeted recompute, then apply the
    // active-visibility filter (shared task read + hide-when-all-done) via the shared path.
    sharedProjectsAllRef.current = shared.map((p: any) => ({ id: p.id, name: p.name, color: p.color }));
    await recomputeSharedVisibility();
  };

  // Light shared-project active-visibility filter: for the current shared set, read the
  // slim task rows and show a project only if it has no tasks yet or at least one task that
  // is not completed and has no pending change request. Extracted from fetchProjects so the
  // realtime task handler can re-run just this (one small query) instead of a full refetch.
  const recomputeSharedVisibility = async () => {
    const shared = sharedProjectsAllRef.current;
    if (shared.length === 0) {
      setSharedProjects([]);
      return;
    }
    const sharedIds = shared.map((p) => p.id);
    const { data: sharedTasks } = await (supabase as any)
      .from('focusos_tasks')
      .select('id, project_id, status, change_request_message')
      .in('project_id', sharedIds);

    const activeShared = shared.filter((p) => {
      const projectTasks = (sharedTasks || []).filter((t: any) => t.project_id === p.id);
      const visibleActiveTasks = projectTasks.filter((t: any) => t.status !== 'completed' && !t.change_request_message);
      return projectTasks.length === 0 || visibleActiveTasks.length > 0;
    });

    // Deliberately NO parentProjectId here: a shared project is always rendered
    // FLAT in a member's drawer, whatever parent it may sit under in the owner's
    // own tree (P3 rule — membership is per project, the hierarchy is the
    // owner's private organisation).
    setSharedProjects(activeShared.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      timer: { totalSeconds: 0, isRunning: false }
    })));
  };
  // Keep the realtime handler (subscribed once, deps [userId]) pointed at the latest closure.
  useEffect(() => { recomputeSharedVisibilityRef.current = recomputeSharedVisibility; });

  // Meetings / shared-items / invitations route through the shared single-flight keys so
  // a mount (cross-route remount included) reads cache within staleTime instead of the
  // network. Event-driven callers (SIGNED_IN, TOKEN_REFRESHED, realtime, accept/decline/
  // create/acknowledge/cancel) pass { fresh: true } to bypass the stale snapshot.
  const fetchMeetings = async (opts?: { fresh?: boolean }) => {
    if (!userId) return;
    try {
      const data = await fetchMeetingsListShared(queryClient, userId, { fresh: opts?.fresh });
      setMeetings(data);
    } catch (error) {
      console.error('[ProjectSidebar] fetchMeetings failed after retries:', error);
    }
  };

  // Google-RSVP edge sync: 2.5-11s live-measured, so it must never run inline on a
  // read path. Deferred + once per load (see the scheduling effect); on completion the
  // shared-items read re-runs to reconcile whatever the sync changed.
  const syncRsvpThenRefresh = async () => {
    if (rsvpSyncedRef.current) return;
    // Cross-MOUNT dedup: the drawer now also lives on the host pages, so opening it on
    // /home and then picking a project fires this once per mount — twice for one
    // journey. Same 60s window the TOKEN_REFRESHED guard above uses.
    if (Date.now() - lastRsvpSyncAt < 60_000) return;
    rsvpSyncedRef.current = true;
    lastRsvpSyncAt = Date.now();
    try {
      await (supabase as any).functions.invoke('focusos-sync-shared-rsvp');
    } catch (e) {
      return; // sync failed; the table read already painted whatever exists
    }
    fetchSharedItems({ fresh: true });
  };

  const fetchSharedItems = async (opts?: { fresh?: boolean }) => {
    if (!userId) return;
    try {
      const data = await fetchSharedItemsShared(queryClient, userId, { fresh: opts?.fresh });
      setSharedItems(data);
    } catch (error) {
      console.error('[ProjectSidebar] fetchSharedItems failed after retries:', error);
    }
  };

  const fetchProjectInvitations = async (opts?: { fresh?: boolean }) => {
    if (!userId) return;
    let data: any[];
    try {
      data = await fetchProjectInvitationsShared(queryClient, userId, { fresh: opts?.fresh });
    } catch (error) {
      console.error('[ProjectSidebar] fetchProjectInvitations failed after retries:', error);
      return;
    }
    if (data && data.length > 0) {
      // Fetch project names
      const projectIds = data.map((i: any) => i.project_id);
      const { data: projectsData } = await (supabase as any)
        .from('focusos_projects')
        .select('id, name, color')
        .in('id', projectIds);

      // Fetch inviter names
      const inviterIds = data.map((i: any) => i.invited_by);
      const { data: inviterProfiles } = await (supabase as any)
        .from('focusos_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', inviterIds);

      const projectMap: Record<string, { name: string; color: string }> = {};
      if (projectsData) {
        for (const p of projectsData) {
          projectMap[p.id] = { name: p.name, color: p.color };
        }
      }
      const inviterMap: Record<string, string> = {};
      if (inviterProfiles) {
        for (const p of inviterProfiles) {
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
          if (name) inviterMap[p.user_id] = name;
        }
      }

      setProjectInvitations(data.map((i: any) => ({
        ...i,
        projectName: projectMap[i.project_id]?.name || 'Unknown Project',
        projectColor: projectMap[i.project_id]?.color || '#3b82f6',
        inviterName: inviterMap[i.invited_by] || i.invited_email,
      })));
    } else {
      setProjectInvitations([]);
    }
  };

  // Realtime for project invitations
  useEffect(() => {
    if (!dataUserId) return;
    const channel = supabase
      .channel('project-invitations-realtime')
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'focusos_project_members',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (payload.new?.status === 'pending') {
            toast.info('📬 New project invitation!', {
              description: `You've been invited to collaborate on a project`,
            });
          }
          fetchProjectInvitations({ fresh: true });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [dataUserId]);

  const handleAcceptProjectInvite = async (memberId: string) => {
    setAcceptingInviteId(memberId);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-accept-project-invite', {
        body: { memberId, action: 'accept' },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Project invitation accepted!');
      fetchProjectInvitations({ fresh: true });
      fetchProjects({ fresh: true });
      // Trigger parent to refetch tasks so the shared project's tasks are loaded
      onProjectCreated?.();
    } catch (err) {
      console.error('Accept invite error:', err);
      toast.error('Failed to accept invitation');
    } finally {
      setAcceptingInviteId(null);
    }
  };

  const handleDeclineProjectInvite = async (memberId: string) => {
    setDecliningInviteId(memberId);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-accept-project-invite', {
        body: { memberId, action: 'decline' },
      });
      if (error) throw error;
      toast.success('Invitation declined');
      fetchProjectInvitations({ fresh: true });
    } catch (err) {
      console.error('Decline invite error:', err);
      toast.error('Failed to decline invitation');
    } finally {
      setDecliningInviteId(null);
    }
  };

  const handleAcceptSharedItem = async (sharedItemId: string) => {
    setAcceptingId(sharedItemId);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-accept-shared-item', {
        body: { sharedItemId },
      });
      if (error) throw error;
      
      // Find the shared item to get its project_name and type
      const acceptedItem = sharedItems.find(i => i.id === sharedItemId);
      const isChangeRequest = acceptedItem?.item_type === 'change_request';
      
      toast.success(isChangeRequest ? 'Changes accepted — task is back in your project!' : 'Item accepted and added to your data!', { duration: 1500 });
      
      // Refresh data
      await fetchProjects({ fresh: true });
      await fetchSharedItems({ fresh: true });
      await fetchMeetings({ fresh: true });
      // O7: accepting also flips this row's status server-side, which the
      // sender's own senderSharedItems dataset (the pill) reads too.
      onSenderSharedItemsChanged?.();

      // Navigate to the accepted item
      if (acceptedItem?.item_type === 'meeting' && data?.recipientTaskId) {
        // Navigate to the cloned meeting
        setTimeout(() => {
          navigate(`/meetings/${data.recipientTaskId}`);
          if (isMobile) setOpenMobile(false);
        }, 800);
      } else if (acceptedItem?.project_name) {
        setTimeout(async () => {
          const { data: matchedProject } = await (supabase as any)
            .from('focusos_projects')
            .select('id')
            .eq('name', acceptedItem.project_name)
            .limit(1)
            .single();
          
          if (matchedProject) {
            onSelectProject(matchedProject.id);
            onSelectSpecialList(null);
            if (isMobile) setOpenMobile(false);
          }
        }, 1200);
      }
    } catch (err) {
      console.error('Accept error:', err);
      toast.error('Failed to accept shared item');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDeclineSharedItem = async (sharedItemId: string) => {
    setDecliningId(sharedItemId);
    try {
      const { error } = await supabase.functions.invoke('focusos-decline-shared-item', {
        body: { sharedItemId },
      });
      if (error) throw error;
      toast.success('Item declined');
      fetchSharedItems({ fresh: true });
      // O7: declining flips this row's status server-side too, refresh the
      // sender's pill dataset the same way accept does.
      onSenderSharedItemsChanged?.();
    } catch (err) {
      console.error('Decline error:', err);
      toast.error('Failed to decline shared item');
    } finally {
      setDecliningId(null);
    }
  };
  const handleAcknowledgeSharedItem = async (sharedItemId: string) => {
    try {
      // Dismiss the matching toast immediately to keep card and toast congruent
      toast.dismiss(`accept-notify-${sharedItemId}`);
      await (supabase as any)
        .from('focusos_shared_items')
        .update({ sender_acknowledged: true })
        .eq('id', sharedItemId);
      fetchSharedItems({ fresh: true });
    } catch (err) {
      console.error('Acknowledge error:', err);
    }
  };

  const handleAcknowledgeCompletion = async (sharedItemId: string) => {
    try {
      toast.dismiss(`complete-notify-${sharedItemId}`);
      await (supabase as any)
        .from('focusos_shared_items')
        .update({ completion_acknowledged: true })
        .eq('id', sharedItemId);
      fetchSharedItems({ fresh: true });
    } catch (err) {
      console.error('Acknowledge completion error:', err);
    }
  };

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const handleCancelSharedItem = async (sharedItemId: string) => {
    setCancellingId(sharedItemId);
    try {
      await (supabase as any)
        .from('focusos_shared_items')
        .update({ status: 'cancelled' })
        .eq('id', sharedItemId);
      toast.success('Shared item cancelled');
      fetchSharedItems({ fresh: true });
      // O7 (2026-08-26) fix: cancelling only ever refreshed this drawer's own
      // sharedItems state; the purple pill (Index/Home senderSharedItems)
      // never heard about it, so it stayed on the task until reload.
      onSenderSharedItemsChanged?.();
    } catch (err) {
      console.error('Cancel error:', err);
      toast.error('Failed to cancel shared item');
    } finally {
      setCancellingId(null);
    }
  };


  const projectFuse = useMemo(() => new Fuse(projects, {
    keys: ['name'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [projects]);

  const meetingFuse = useMemo(() => new Fuse(meetings, {
    keys: ['title'],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [meetings]);

  // ---- Sub-project tree (P3) ------------------------------------------------
  // Everything below is DERIVED DURING RENDER from state that already exists —
  // no effects, no post-paint corrections.

  // The one-level tree "My Projects" renders: top-level rows, each carrying its
  // active subs. Pure function, so the grouping rules live in one testable place.
  // O8 puts the manual order on top of that grouping, still during render and
  // still pure: sortProjectTree orders the top-level rows against each other and
  // each parent's subs against each other, both by sort_order with the unordered
  // rows keeping their incoming position at the end.
  const projectTree = useMemo(() => sortProjectTree(groupProjectTree(projects)), [projects]);

  // The Pinned group (O8), derived from the same tree: a pinned top-level project
  // floats up as its WHOLE block (subs travel with it, nothing is torn out of the
  // tree), a pinned sub gets a flat shortcut row up top and still renders under
  // its parent below. Unpinning drops the row straight back into its sort_order
  // slot, because nothing about the order was changed by pinning.
  const { pinned: pinnedEntries, rest: unpinnedTree } = useMemo(
    () => splitPinnedTree(projectTree),
    [projectTree],
  );

  // Only reserve the chevron column once this account actually HAS a parent with
  // sub-projects. An account that never uses the feature renders its rows at
  // exactly the geometry it had before P3; an account that does gets every
  // top-level row aligned with the ones that carry a chevron, instead of a
  // ragged mix of inset and flush rows.
  const treeGutter = useMemo(() => projectTree.some((n) => n.subs.length > 0), [projectTree]);

  // Persisted expand state, read straight from localStorage during render and
  // overlaid with this session's toggles (treeOpenOverride). Reading here rather
  // than seeding state in an effect keeps the first paint correct.
  const storedTreeOpen = useMemo<Record<string, boolean>>(() => {
    if (!userId) return {};
    try {
      const raw = window.localStorage.getItem(`focusos-tree-open-${userId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }, [userId]);

  const treeOpen = useMemo(
    () => ({ ...storedTreeOpen, ...treeOpenOverride }),
    [storedTreeOpen, treeOpenOverride],
  );

  const setTreeOpenFor = (parentId: string, open: boolean) => {
    const next = { ...treeOpen, [parentId]: open };
    setTreeOpenOverride(next);
    if (userId) {
      try {
        window.localStorage.setItem(`focusos-tree-open-${userId}`, JSON.stringify(next));
      } catch { /* private mode / quota — the in-memory state still works */ }
    }
  };

  const toggleTreeOpen = (parentId: string) => setTreeOpenFor(parentId, !(treeOpen[parentId] ?? true));

  // Archived section rows. An archived sub whose PARENT is archived too (the
  // cascade case) is folded into the parent's row as a count suffix instead of
  // getting its own row — restoring the parent brings it back with it. An
  // archived sub whose parent is still active keeps its own row and its own
  // Restore.
  const archivedRows = useMemo(() => {
    const archivedIds = new Set(archivedProjects.map((p) => p.id));
    return archivedProjects
      .filter((p) => !(p.parentProjectId && archivedIds.has(p.parentProjectId)))
      .map((p) => ({ project: p, cascadedSubCount: countSubProjects(archivedProjects, p.id) }));
  }, [archivedProjects]);

  const isSearching = sidebarSearchQuery.trim().length > 0;
  const matchedProjects = isSearching ? projectFuse.search(sidebarSearchQuery.trim()).map(r => r.item) : [];
  const matchedMeetings = isSearching ? meetingFuse.search(sidebarSearchQuery.trim()).map(r => r.item) : [];

  const handleCreateProject = async (name: string, color: string, parentProjectId: string | null = null) => {
    if (!userId) return;

    // One level only: the dialog offers TOP-LEVEL projects as parents, but guard
    // here too so no caller can create a grandchild. A parent that is itself a
    // sub is silently promoted to top level rather than nesting two deep.
    const parentIsSub = parentProjectId
      ? projects.some((p) => p.id === parentProjectId && !!p.parentProjectId)
      : false;
    const effectiveParentId = parentIsSub ? null : parentProjectId;

    // `.select()` so overlay mode can open the project it just created AND seed the
    // row into the shared cache (the same insert+select pattern as brainDumpSave.ts /
    // Index's demo projects). /app ignores the returned row and behaves as before.
    // O8: a group that has ALREADY been ordered by hand gets the new row stamped
    // at the end, so "new projects append" is literal there. A group nobody has
    // reordered keeps sort_order null, which is what makes an account that never
    // uses the feature render exactly as it did before O8.
    const siblings = effectiveParentId
      ? projects.filter((p) => p.parentProjectId === effectiveParentId)
      : projects.filter((p) => !p.parentProjectId);
    const sortOrder = nextSiblingSortOrder(siblings);

    const { data: created, error } = await (supabase as any)
      .from('focusos_projects')
      .insert({
        name,
        color,
        user_id: userId,
        parent_project_id: effectiveParentId,
        ...(sortOrder === null ? {} : { sort_order: sortOrder }),
      })
      .select()
      .maybeSingle();

    if (error) {
      toast.error('Failed to create project');
      return;
    }

    toast.success('Project created!');
    // A new sub lands inside a parent row that may be collapsed — open it, or the
    // create looks like it did nothing.
    if (effectiveParentId) setTreeOpenFor(effectiveParentId, true);
    fetchProjects({ fresh: true });
    setIsCreateOpen(false);
    onProjectCreated?.();

    // Overlay mode: creating from a host page (/home, /meetings) lands the user
    // in the new project, the same route a pick in the list takes. Nothing
    // happens without an id — the refreshed list above still shows it.
    if (isOverlay && created?.id) {
      // The new row must be visible to /app BEFORE we navigate. fetchProjects above
      // is deliberately unawaited, and /app never waits for it: Index seeds DURING
      // RENDER from this cache (warm start), and even its cold branch's non-fresh
      // fetchQuery short-circuits to the same entry inside APP_DATA_STALE_TIME. So
      // without this patch the deep-linked id is missing from the list on arrival and
      // Index's deleted-project fallback bounces the user to Today. Same patch
      // brainDumpSave.ts makes for its new projects: only patch a cache that already
      // holds data (fabricating one would mark it fresh and starve the real fetch),
      // mergeByIdDesc dedupes by id and keeps the created_at desc order loadProjects
      // produces.
      queryClient.setQueryData(appDataKeys.projects(userId), (prev: any[] | undefined) =>
        prev ? mergeByIdDesc([created, ...prev]) : prev,
      );
      handleSelectProject(created.id);
      setOpenMobile(false);
    }
  };

  // Restore needs no confirm (Archive already gates the destructive-feeling half
  // with the AlertDialog in Index.tsx). Same fetchProjects({fresh:true}) +
  // onProjectCreated() shape handleCreateProject uses above, so Index's own
  // project state (and TimeTrackingChart's report-facing copy) picks the
  // restored project back up too.
  const handleRestoreProject = async (projectId: string) => {
    setRestoringProjectId(projectId);
    try {
      // CASCADE: restoring a parent restores the sub-projects that were archived
      // with it (the archive action archives them together, so they come back
      // together). `.or()` keeps the same single RLS-scoped statement the
      // `.eq('id', …)` form used — a sub-project row belongs to the same owner.
      const { error } = await (supabase as any)
        .from('focusos_projects')
        .update({ archived_at: null })
        .or(`id.eq.${projectId},parent_project_id.eq.${projectId}`);
      if (error) throw error;
      toast.success('Project restored');
      await fetchProjects({ fresh: true });
      onProjectCreated?.();
    } catch (error) {
      console.error('[ProjectSidebar] Failed to restore project:', error);
      toast.error('Failed to restore project');
    } finally {
      setRestoringProjectId(null);
    }
  };

  const handleSelectProject = (projectId: string) => {
    onSelectProject(projectId);
    onSelectSpecialList(null);
  };

  const handleSelectSpecial = (list: 'unassigned' | 'today' | 'past-due') => {
    onSelectSpecialList(list);
    onSelectProject(null);
  };

  // Single source of truth for mobile detection: read isMobile from the
  // SidebarProvider context (which itself calls useIsMobile()) instead of
  // calling useIsMobile() a second time here. Two independent hook instances
  // both start at `false` and flip to `true` in their own effect after mount;
  // relying on only one keeps this component's branch (plain div vs Sheet)
  // always in lockstep with the provider's `open`/`sidebarOpen` state, so
  // there's no window where the desktop-styled div and the mobile Sheet can
  // both exist/mount back-to-back for the same view.
  const {
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    openMobile: ctxOpenMobile,
    setOpenMobile: ctxSetOpenMobile,
    isMobile: ctxIsMobile,
  } = useSidebar();

  const setOverlayOpen = useCallback(
    (next: boolean) => {
      // Move focus OUT of the panel before it closes. Two reasons, both device-class
      // problems rather than cosmetics: Chrome refuses to apply aria-hidden to a
      // subtree that retains focus ('retained focus' — the drawer would stay in the
      // a11y tree), and `inert` on a subtree holding the caret strands the keyboard.
      // Only ever fires on a close, only when focus really is inside (dragPanelRef is
      // read at call time, long after it is assigned).
      if (!next) {
        const panel = dragPanelRef.current;
        const active = document.activeElement as HTMLElement | null;
        if (panel && active && panel.contains(active)) active.blur();
      }
      overlayOnOpenChange?.(next);
    },
    [overlayOnOpenChange],
  );

  // Overlay mode runs on the host's open state, not the provider's (host pages
  // have no SidebarProvider — useSidebar returns its no-op fallback there), and
  // it renders the portalled drawer at EVERY width. So `isMobile` — which in
  // this component means "the drawer is the portalled overlay panel", gating
  // close-after-pick, Escape-to-close and the grab-and-throw gesture — is
  // aliased to true. Non-overlay reads stay exactly as before.
  const isMobile = isOverlay ? true : ctxIsMobile;
  const openMobile = isOverlay ? !!overlayOpen : ctxOpenMobile;
  const setOpenMobile = isOverlay ? setOverlayOpen : ctxSetOpenMobile;

  // A closed, off-screen drawer must be unreachable by KEYBOARD too, not just by
  // pointer: aria-hidden hides it from the a11y tree but leaves every control in the
  // tab order, and the CSS pointer-events:none only stops the mouse — so Tab on a host
  // page used to walk straight into the closed panel. `inert` closes both holes.
  // Attribute only: no style, no layout, no compositing change, so the permanently
  // mounted layers are untouched (white-flash law). React 18 does not know `inert`, so
  // it is passed as an empty-string attribute (the HTML boolean-attribute form).
  // Overlay mode only, so /app's drawer stays byte-identical.
  const closedInert = (isOverlay && !openMobile ? { inert: '' } : {}) as Record<string, string>;

  // Ghost-click latch for the mobile drawer overlay. The overlay closes the
  // drawer only when ONE gesture both starts (pointerdown) and ends (click) on
  // it. A ghost click — the trailing synthesized click of the SAME tap that
  // navigated Home -> /app and opened the drawer — arrives on the freshly
  // mounted overlay with NO matching pointerdown, so it must not close the
  // just-opened drawer. (Igor video 2026-07-18.)
  const overlayPointerDownRef = useRef(false);

  // ---- Drag-and-drop project moves (U2) --------------------------------------
  // Igor's ask: "move projects just like I can move the tasks... the Move to...
  // sheet is cumbersome". The task list (src/components/DraggableTaskList.tsx) is
  // the precedent and is copied where it applies: dnd-kit, the same TouchSensor
  // delay, a DragOverlay PORTALLED TO <body>, and no new motion of any kind. Two
  // deliberate differences, both because a project row is not a task card:
  //   - no reorder mode and no grip — the row itself is the handle, because the
  //     extra steps are exactly what Igor called cumbersome;
  //   - the pointer sensor ignores TOUCH (see MousePointerSensor above), so a
  //     finger that starts on a row still scrolls the drawer.
  // The "Move to..." sheet in Index.tsx stays, unchanged, as the fallback — which
  // is also why no KeyboardSensor is wired here: the row is a real <button> whose
  // Enter/Space must keep SELECTING the project.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // O8: which seam the current drag is aiming at, or null while it is aiming at
  // a row (U2's nest). STATE, not a ref, because the insert line is read DURING
  // RENDER (render-phase law: a ref latch survives a discarded router transition
  // while the queued setState dies with it).
  const [dropIntent, setDropIntent] = useState<{ targetId: string; place: 'before' | 'after' } | null>(null);

  // Serialises reorder writes so two quick drops can never land out of order.
  const reorderChainRef = useRef<Promise<void>>(Promise.resolve());

  // Event-handler guards only. Refs are correct here (the render-phase laws ban
  // refs for latches READ DURING RENDER — activeDragId above is state for exactly
  // that reason; these two are read from pointer/click handlers only).
  const dragActiveRef = useRef(false);
  const justDraggedRef = useRef(false);

  const dragSensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  // Active + archived owned rows in one list: the one-level rule counts an
  // ARCHIVED sub as a sub (same scope Index's handleMoveProject passes).
  const allOwnProjects = useMemo(
    () => [...projects, ...archivedProjects],
    [projects, archivedProjects],
  );

  // Everything the drop-target highlight needs is DERIVED during render from
  // activeDragId. Nothing here is corrected by an effect after paint.
  const activeMover = useMemo(() => {
    if (!activeDragId) return null;
    const id = activeDragId.startsWith(DRAG_ID_PREFIX)
      ? activeDragId.slice(DRAG_ID_PREFIX.length)
      : activeDragId;
    return projects.find((p) => p.id === id) ?? null;
  }, [activeDragId, projects]);

  const activeMoverHasSubs = useMemo(
    () => (activeMover ? allOwnProjects.some((p) => p.parentProjectId === activeMover.id) : false),
    [activeMover, allOwnProjects],
  );

  // "Top level" accepts the mover only when it is not already there.
  const canDropAtTopLevel = !!activeMover && !!activeMover.parentProjectId;

  // A parent block accepts the mover when it is not the mover's own block, the
  // mover has no sub-projects of its own (one-level rule) and the mover does not
  // already live there. The rule's other half — the target must itself be top
  // level — holds by construction: every projectTree parent IS top level.
  // The last clause closes the orphan hole the skeptic found: a sub whose
  // parent is archived renders in the top-level list (P3 rule) but is still a
  // sub in the data, so it must never light up as a target (the guard would
  // refuse it anyway, with the wrong wording). Same scope the Move to... sheet
  // already applies by never offering such a row.
  const canDropUnder = (parentId: string) =>
    !!activeMover &&
    parentId !== activeMover.id &&
    !activeMoverHasSubs &&
    (activeMover.parentProjectId ?? null) !== parentId &&
    !projects.find((p) => p.id === parentId)?.parentProjectId;

  const stripDragPrefix = (id: string) =>
    id.startsWith(DRAG_ID_PREFIX) ? id.slice(DRAG_ID_PREFIX.length) : id;

  /**
   * What the CURRENT drag would do if it were released now: nest the mover under
   * a project (U2, unchanged) or drop it into a seam between two siblings (O8).
   *
   * Pure with respect to React: it reads the event's own measured rectangles and
   * the projects list, nothing else, and is called from dnd-kit's move/end
   * handlers only. The vertical reference is the dragged GHOST's centre, which is
   * what the user actually sees following their finger, and it lives in the same
   * coordinate system dnd-kit measures the drop targets in.
   */
  const resolveProjectDrop = (event: DragMoveEvent | DragEndEvent): ResolvedDrop | null => {
    const { active, over } = event;
    if (!over) return null;
    const movingId = stripDragPrefix(String(active.id));
    const moving = projects.find((p) => p.id === movingId);
    if (!moving) return null;
    const movingParentId = moving.parentProjectId ?? null;
    const translated = active.rect.current.translated;
    const centreY = translated ? translated.top + translated.height / 2 : null;
    const overId = String(over.id);

    if (overId === DROP_TOP_ID) return { kind: 'nest', targetParentId: null };

    if (overId.startsWith(DROP_SUB_PREFIX)) {
      const subId = overId.slice(DROP_SUB_PREFIX.length);
      const sub = projects.find((p) => p.id === subId);
      const subParentId = sub?.parentProjectId ?? null;
      // Siblings under the same parent: the row splits in half, because nesting
      // under a sub is illegal anyway (one level only).
      if (sub && subParentId && subParentId === movingParentId && subId !== movingId && centreY !== null) {
        const place = dropPlaceFor(centreY, over.rect, { allowNest: false });
        if (place !== 'nest') return { kind: 'reorder', targetId: subId, place, groupParentId: subParentId };
      }
      // Anything else keeps U2's behaviour exactly: before O8 the whole block was
      // the only target, so a drop on one of its subs meant "nest under the parent".
      return { kind: 'nest', targetParentId: subParentId };
    }

    if (overId.startsWith(DROP_PARENT_PREFIX)) {
      const parentId = overId.slice(DROP_PARENT_PREFIX.length);
      // Only a TOP-LEVEL mover reorders against a top-level block, and never
      // against its own block. Everything else falls through to nesting, so U2's
      // drop-anywhere-on-the-group is untouched for those gestures.
      if (movingParentId === null && parentId !== movingId && centreY !== null) {
        const place = dropPlaceFor(centreY, over.rect, { allowNest: true });
        if (place !== 'nest') return { kind: 'reorder', targetId: parentId, place, groupParentId: null };
      }
      return { kind: 'nest', targetParentId: parentId };
    }

    return null;
  };

  /**
   * Persist a renormalised sibling group (O8). Optimistic first so the row lands
   * under the finger with no round trip, then ONE PATCH per row whose position
   * actually changed, serialised through reorderChainRef. A failure restores the
   * truth with a fresh refetch rather than leaving the optimistic order standing.
   */
  const handleReorderProjects = (updates: SiblingOrderUpdate[]) => {
    if (updates.length === 0) return; // no-op drop: nothing written, nothing said
    const currentById = new Map(projects.map((p) => [p.id, p]));
    const changed = updates.filter((u) => (currentById.get(u.id)?.sortOrder ?? null) !== u.sortOrder);
    if (changed.length === 0) return;
    const orderById = new Map(updates.map((u) => [u.id, u.sortOrder]));

    setProjects((prev) =>
      prev.map((p) => (orderById.has(p.id) ? { ...p, sortOrder: orderById.get(p.id)! } : p)),
    );
    // Patch the SHARED cache too (never fabricate one that was never fetched), so
    // the host-page drawer and Index read the same order before any refetch.
    if (userId) {
      queryClient.setQueryData(appDataKeys.projects(userId), (prev: any[] | undefined) =>
        prev
          ? prev.map((row: any) => (orderById.has(row.id) ? { ...row, sort_order: orderById.get(row.id) } : row))
          : prev,
      );
    }

    reorderChainRef.current = reorderChainRef.current.then(async () => {
      try {
        const results = await Promise.all(
          changed.map((u) =>
            (supabase as any).from('focusos_projects').update({ sort_order: u.sortOrder }).eq('id', u.id),
          ),
        );
        const failed = results.find((r: any) => r?.error);
        if (failed) throw failed.error;
        onProjectCreated?.();
      } catch (error) {
        console.error('[ProjectSidebar] Failed to reorder projects:', error);
        toast.error('Failed to save the new order');
        await fetchProjects({ fresh: true });
      }
    });
  };

  // The write. Same shape as handleRestoreProject above (drawer-owned supabase
  // update -> toast -> fresh refetch -> onProjectCreated, which bumps Index's
  // projectRefreshTrigger so its own project list and the report copy follow),
  // and the same two toasts handleMoveProject uses, so a drag and the sheet are
  // indistinguishable once the write lands.
  const handleDragMoveProject = async (movingId: string, targetParentId: string | null) => {
    const target = targetParentId ? projects.find((p) => p.id === targetParentId) ?? null : null;
    try {
      const { error } = await (supabase as any)
        .from('focusos_projects')
        .update({ parent_project_id: targetParentId })
        .eq('id', movingId);
      if (error) throw error;
      // A sub dropped into a COLLAPSED parent would vanish into a closed row and
      // read as a failed move — same reason handleCreateProject opens it.
      if (targetParentId) setTreeOpenFor(targetParentId, true);
      toast.success(target ? `Moved under ${target.name}` : 'Moved to top level');
      await fetchProjects({ fresh: true });
      onProjectCreated?.();
    } catch (error) {
      console.error('[ProjectSidebar] Failed to move project:', error);
      toast.error('Failed to move project');
    }
  };

  const handleProjectDragStart = (event: DragStartEvent) => {
    dragActiveRef.current = true;
    setActiveDragId(String(event.active.id));
  };

  const handleProjectDragMove = (event: DragMoveEvent) => {
    const resolved = resolveProjectDrop(event);
    const next = resolved && resolved.kind === 'reorder'
      ? { targetId: resolved.targetId, place: resolved.place }
      : null;
    setDropIntent((prev) => {
      if (!prev && !next) return prev;
      if (prev && next && prev.targetId === next.targetId && prev.place === next.place) return prev;
      return next;
    });
  };

  const endProjectDrag = () => {
    dragActiveRef.current = false;
    setActiveDragId(null);
    setDropIntent(null);
    // dnd-kit already stops the trailing click at document capture (it adds a
    // capture-phase click blocker on activation and drops it ~50ms after the
    // drop). This latch is the belt for that seam, cleared on the next tick so
    // the very next REAL click still selects.
    justDraggedRef.current = true;
    window.setTimeout(() => { justDraggedRef.current = false; }, 0);
  };

  const handleProjectDragEnd = (event: DragEndEvent) => {
    const { active, over, delta } = event;
    // Resolved BEFORE the state teardown: it reads the event's own rectangles, so
    // clearing activeDragId first would not change the answer, but keeping the
    // order explicit keeps the two independent.
    const resolved = resolveProjectDrop(event);
    endProjectDrag();

    const activeIdStr = String(active.id);
    const movingId = activeIdStr.startsWith(DRAG_ID_PREFIX)
      ? activeIdStr.slice(DRAG_ID_PREFIX.length)
      : activeIdStr;

    // A press that never MOVED is a tap the 250ms long-press timer happened to
    // arm — a leisurely finger on a row, which must still open the project.
    // The row's own onClick cannot do it (dnd-kit swallows the trailing click at
    // document capture once a drag activates), so the select is issued here.
    // Touch only in practice: the mouse sensor needs 8px before it activates at
    // all, so a still mouse press never reaches this handler.
    if (Math.abs(delta.x) < 5 && Math.abs(delta.y) < 5) {
      if (projects.some((p) => p.id === movingId)) {
        handleSelectProject(movingId);
        if (isMobile) setOpenMobile(false);
      }
      return;
    }

    if (!over || !resolved) return; // released outside every drop target: nothing is written

    const moving = projects.find((p) => p.id === movingId);
    if (!moving) return;

    // O8, a seam between two siblings: renormalise that ONE group and write it.
    // The group is taken from the rendered tree, so "before"/"after" mean exactly
    // what the insert line showed.
    if (resolved.kind === 'reorder') {
      const group =
        resolved.groupParentId === null
          ? projectTree.map((n) => n.parent)
          : projectTree.find((n) => n.parent.id === resolved.groupParentId)?.subs ?? [];
      handleReorderProjects(reorderSiblings(group, movingId, resolved.targetId, resolved.place));
      return;
    }

    const targetParentId = resolved.targetParentId;

    // SILENT no-ops: nothing changed, so nothing is written and nothing is said.
    // Covers a row dropped on its own block, a sub dropped back on its current
    // parent, and a top-level project dropped on the "My Projects" header.
    if (targetParentId === movingId) return;
    if ((moving.parentProjectId ?? null) === targetParentId) return;

    const refusal = projectMoveRefusal(movingId, targetParentId, allOwnProjects);
    if (refusal) {
      toast.error(refusal);
      return;
    }
    void handleDragMoveProject(movingId, targetParentId);
  };

  // The row click, shared by every own active row (top level and sub). A drag
  // must never also select: while one is running activeDragId is set, and the
  // drop's trailing click is caught by the latch.
  const handleProjectRowClick = (projectId: string) => {
    if (activeDragId || justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    handleSelectProject(projectId);
    if (isMobile) setOpenMobile(false);
  };

  // Rows rendered under the "My Projects" heading: every top-level node plus its
  // subs. Identical to projects.length while nothing is pinned, because each
  // project appears in the tree exactly once.
  const myProjectsRowCount = unpinnedTree.reduce((n, node) => n + 1 + node.subs.length, 0);

  // The reorder seam this row is currently wearing, DERIVED during render from
  // dropIntent. Nothing is corrected after paint.
  const insertLineFor = (id: string): 'before' | 'after' | null =>
    dropIntent && dropIntent.targetId === id ? dropIntent.place : null;

  /**
   * One top-level block: the row itself, its chevron, its share pill and its
   * expanded subs. A plain render helper rather than a component, so the Pinned
   * group and "My Projects" render the SAME markup from the same place (a pinned
   * parent keeps its tree when it floats up).
   */
  const renderProjectBlock = (node: { parent: Project; subs: Project[] }) => {
    const project = node.parent;
    const subs = node.subs;
    const dataAttrs =
      selectedProjectId === project.id && project.name.startsWith('Demo Project')
        ? { 'data-projects-tour-step': 'demo-project' as const }
        : {};
    // Default OPEN: a parent's subs are visible unless the user has explicitly
    // collapsed that parent (the collapse is what gets persisted). Anything else
    // makes a just-created or just-moved sub vanish into a closed row and read as
    // a bug.
    const isOpen = treeOpen[project.id] ?? true;
    return (
      <ProjectDropBlock
        key={project.id}
        parentId={project.id}
        canAccept={canDropUnder(project.id)}
        dataAttrs={dataAttrs}
        insertLine={insertLineFor(project.id)}
      >
        {(dropTarget) => (
          <>
            <div className="w-full flex items-center gap-1">
              {/* Chevron expand — SAME control the Archived section uses (plain
                  button, ChevronDown/ChevronRight, aria-expanded), only rendered
                  for a parent that actually has sub-projects. Sibling of the row
                  button, never nested inside it. No animation: the subs are a
                  plain conditional render, so no compositing layer is created
                  while anything moves (iOS Safari law). */}
              {subs.length === 0 && treeGutter && (
                <span className="shrink-0 w-[22px]" aria-hidden="true" />
              )}
              {subs.length > 0 && (
                <button
                  type="button"
                  data-testid={`tree-toggle-${project.id}`}
                  aria-expanded={isOpen}
                  /* NOTE: the accessible name must NOT contain the word
                     "projects" — the drawer itself is aria-label="Projects" and
                     the BottomNav has a "Projects" button, so any substring match
                     would become ambiguous. */
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${project.name}`}
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleTreeOpen(project.id)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                </button>
              )}
              <DraggableProjectRow
                project={project}
                selected={selectedProjectId === project.id}
                dropTarget={dropTarget}
                className="flex-1 justify-start gap-2 min-w-0"
                onSelect={() => handleProjectRowClick(project.id)}
              />
            </div>
            {senderProjectSharedMap[project.id] && (
              <div className="ml-8 mt-0.5 mb-1">
                <ShareStatusPopover recipients={senderProjectSharedMap[project.id]} itemType="Project" />
              </div>
            )}
            {subs.length > 0 && isOpen && (
              <div className="mt-1 space-y-1" data-testid={`tree-subs-${project.id}`}>
                {subs.map((sub) => (
                  <SubDropRow key={sub.id} subId={sub.id} insertLine={insertLineFor(sub.id)}>
                    <DraggableProjectRow
                      project={sub}
                      selected={selectedProjectId === sub.id}
                      dropTarget={false}
                      className="w-full justify-start gap-2 min-w-0"
                      onSelect={() => handleProjectRowClick(sub.id)}
                    />
                    {senderProjectSharedMap[sub.id] && (
                      <div className="ml-8 mt-0.5 mb-1">
                        <ShareStatusPopover recipients={senderProjectSharedMap[sub.id]} itemType="Project" />
                      </div>
                    )}
                  </SubDropRow>
                ))}
              </div>
            )}
          </>
        )}
      </ProjectDropBlock>
    );
  };

  // The ghost that follows the finger. A plain copy of the row (folder mark in
  // the project's colour + its name) — no springs, no transitions, no keyframes;
  // dnd-kit's own transform is the only thing that moves.
  const projectDragOverlay = (
    <DragOverlay>
      {activeMover ? (
        <div
          data-testid="project-drag-overlay"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium opacity-90 shadow-xl"
        >
          <Folder className="h-4 w-4 shrink-0" style={{ color: activeMover.color }} />
          <span className="truncate">{activeMover.name}</span>
        </div>
      ) : null}
    </DragOverlay>
  );

  // Grab-and-throw: drag the open drawer left to close it, Apple-style
  // (1:1 tracking, rubber-band past the resting point, velocity release).
  // Gesture tracking is imperative by design — direct transform writes on
  // the persistent panel layer at pointer speed; React state is touched
  // only for the final open/close decision. The panel layer already exists
  // (white-flash law), so dragging animates an already-rastered layer.
  const dragPanelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    tracking: boolean;
    claimed: boolean;
    startX: number;
    startY: number;
    shift: number;
    history: { x: number; t: number }[];
  }>({ tracking: false, claimed: false, startX: 0, startY: 0, shift: 0, history: [] });

  const DRAWER_W = 280;

  const endDrag = (panel: HTMLDivElement, close: boolean) => {
    const d = dragRef.current;
    d.tracking = false;
    if (!d.claimed) return;
    d.claimed = false;
    // Swallow the trailing synthesized click so a drag can never "tap" a
    // project row it happened to end on (same family as the overlay's
    // ghost-click latch).
    const swallow = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
    panel.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => panel.removeEventListener('click', swallow, { capture: true } as EventListenerOptions), 400);
    if (close) setOpenMobile(false);
    // Release on the next frame: the data-state rule becomes the transform
    // target again, and its transition animates from the finger's last
    // position (transitions retarget from the current computed value).
    requestAnimationFrame(() => {
      panel.style.transform = '';
      panel.removeAttribute('data-dragging');
    });
  };

  const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!openMobile || e.pointerType === 'mouse') return;
    // A project drag owns the gesture (U2). Without this the same finger would
    // also grab-and-throw the panel: dnd-kit's TouchSensor consumes touchmove,
    // but pointermove keeps firing here.
    if (dragActiveRef.current) return;
    const d = dragRef.current;
    d.tracking = true;
    d.claimed = false;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.shift = 0;
    d.history = [{ x: e.clientX, t: e.timeStamp }];
  };

  const onPanelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const panel = dragPanelRef.current;
    if (!d.tracking || !panel) return;
    // A project drag started under this same finger (the 250ms hold fires after
    // pointerdown already latched tracking) — drop the panel gesture entirely.
    if (dragActiveRef.current) { d.tracking = false; return; }
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.claimed) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { d.tracking = false; return; } // it's a scroll
      if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy)) return; // undecided
      d.claimed = true;
      panel.setPointerCapture(e.pointerId);
      panel.setAttribute('data-dragging', '');
    }
    // Leftward follows 1:1; rightward rubber-bands (there is nothing there).
    const shift = dx < 0 ? dx : (dx * DRAWER_W * 0.55) / (DRAWER_W + 0.55 * dx);
    d.shift = shift;
    panel.style.transform = `translateX(${shift}px)`;
    d.history.push({ x: e.clientX, t: e.timeStamp });
    if (d.history.length > 6) d.history.shift();
  };

  const onPanelPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const panel = dragPanelRef.current;
    if (!panel || !d.tracking) return;
    if (!d.claimed) { d.tracking = false; return; }
    const first = d.history[0];
    const last = d.history[d.history.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt; // px/ms, negative = leftward
    const close = vx < -0.5 || (d.shift < -DRAWER_W * 0.35 && vx < 0.05);
    endDrag(panel, close);
  };

  const [launchingTourLabel, setLaunchingTourLabel] = useState<string | null>(null);

  // Dismiss the loading overlay as soon as the tour signals it has painted
  // its first spotlight (event dispatched from TaskTour / ProjectTour).
  useEffect(() => {
    if (!launchingTourLabel) return;
    const handleReady = () => setLaunchingTourLabel(null);
    window.addEventListener('focusos:tour-ready', handleReady as EventListener);
    // Safety net: if the tour never reports ready (e.g. target missing),
    // hide the overlay after 15s so the user is never stuck. Must be long
    // enough that the ready event wins under any normal conditions.
    const safety = window.setTimeout(() => setLaunchingTourLabel(null), 15000);
    return () => {
      window.removeEventListener('focusos:tour-ready', handleReady as EventListener);
      clearTimeout(safety);
    };
  }, [launchingTourLabel]);

  const handleHelpMenuClick = (tourType: 'tasks' | 'projects') => {
    const labelMap = {
      'tasks': 'Tasks Tour',
      'projects': 'Projects Tour',
    } as const;

    setLaunchingTourLabel(labelMap[tourType]);

    if (isMobile) {
      setOpenMobile(false);
    } else {
      try { setSidebarOpen?.(false); } catch { /* no-op if context unavailable */ }
    }

    const startDelay = 280;
    setTimeout(() => {
      if (tourType === 'tasks' && onStartTaskTour) {
        onStartTaskTour();
      } else if (tourType === 'projects' && onStartProjectsTour) {
        onStartProjectsTour();
      } else {
        toast.info('Coming soon!', { description: 'This tour is under development.' });
        setLaunchingTourLabel(null);
      }
    }, startDelay);
  };

  // Hygiene: whenever the drawer is (re)closed, clear the overlay gesture latch
  // so a stale pointerdown can never authorise a later ghost click. Pairs with
  // the ghost-click guard on the overlay onClick below (Igor video 2026-07-18).
  useEffect(() => {
    if (!openMobile) overlayPointerDownRef.current = false;
  }, [openMobile]);

  // Escape-to-close for the mobile drawer. Gated on openMobile so the listener
  // only exists while the drawer is open. Radix Dialog gave this for free before
  // the normal-mobile branch dropped Radix (see the portal comment below).
  useEffect(() => {
    if (!isMobile || !openMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMobile(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isMobile, openMobile, setOpenMobile]);

  const sidebarContent = (
    <>
      <div className="border-b p-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Projects</h2>
          {!isMobile && (
            <button
              type="button"
              aria-label="Close sidebar"
              className="lg-iconbtn h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                size="sm" 
                className="gap-2 bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <HelpCircle className="h-4 w-4" />
                Help
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 bg-popover">
              <DropdownMenuItem onClick={() => {
                // Close first, exactly like the Meetings Tour item below: tapped from
                // /home the drawer would otherwise sit open over the running tour.
                if (isMobile) setOpenMobile(false);
                navigate('/home?tour=home');
              }}>
                Home Tour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                if (isMobile) setOpenMobile(false);
                navigate('/meetings?tour=meetings');
              }}>
                Meetings Tour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleHelpMenuClick('tasks')}>
                Tasks Tour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleHelpMenuClick('projects')}>
                Projects Tour
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            onClick={() => setIsCreateOpen(true)} 
            size="sm" 
            className="flex-1 gap-2"
            data-projects-tour-step="new-project-button"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        </div>
        <Button 
          variant="outline"
          size="sm" 
          className="w-full gap-2 mt-2 border-primary/50 text-primary hover:bg-primary/10 hover:border-primary"
          onClick={() => {
            navigate('/meetings');
            if (isMobile) setOpenMobile(false);
          }}
        >
          <Mic className="h-4 w-4" />
          Meetings
        </Button>
        {/* Search bar */}
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input 
            placeholder="Search projects & meetings..." 
            value={sidebarSearchInput} 
            onChange={e => setSidebarSearchInput(e.target.value)} 
            className="pl-8 h-8 text-sm bg-card/80 backdrop-blur-sm border"
          />
        </div>
      </div>

      <SidebarScrollArea
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }}
      >
        {isSearching ? (
          /* Search results */
          <div className="p-2 space-y-3 flex-1 min-h-0 overflow-y-auto">
            {matchedProjects.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground px-2 mb-1">Projects</h3>
                <div className="space-y-1">
                  {matchedProjects.map(project => (
                    <Button
                      key={project.id}
                      variant="ghost"
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        handleSelectProject(project.id);
                        setSidebarSearchInput('');
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <Folder className="h-4 w-4" style={{ color: project.color }} />
                      <span className="truncate">{project.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {matchedMeetings.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground px-2 mb-1">Meetings</h3>
                <div className="space-y-1">
                  {matchedMeetings.map(meeting => (
                    <Button
                      key={meeting.id}
                      variant="ghost"
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        navigate(`/meetings/${meeting.id}`);
                        setSidebarSearchInput('');
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <Mic className="h-4 w-4 text-primary" />
                      <span className="truncate">{meeting.title}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {matchedProjects.length === 0 && matchedMeetings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No results found</p>
            )}
          </div>
        ) : (
          /* Normal sidebar content */
          <>
            <div className="p-2 space-y-1">
              {/* Special Lists */}
              <Button
                variant={selectedSpecialList === 'today' ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2"
                onClick={() => {
                  handleSelectSpecial('today');
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <Calendar className="h-4 w-4" />
                Today
              </Button>

              <Button
                variant={selectedSpecialList === 'past-due' ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2 text-orange-400/80 hover:text-orange-400"
                onClick={() => {
                  handleSelectSpecial('past-due');
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <Calendar className="h-4 w-4" />
                Past Due
              </Button>
              
              <Button
                variant={selectedSpecialList === 'unassigned' ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2"
                onClick={() => {
                  handleSelectSpecial('unassigned');
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <ListTodo className="h-4 w-4" />
                Unassigned
              </Button>
            </div>

            {/* Project Invitations Section */}
            {projectInvitations.length > 0 && (
              <div className="mt-3 px-2">
                <div className="px-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Project Invitations ({projectInvitations.length})
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {projectInvitations.map((invite) => (
                    <div key={invite.id} className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-1.5">
                      <div className="flex items-start gap-2">
                        <Folder className="h-3.5 w-3.5 mt-0.5" style={{ color: invite.projectColor }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{invite.projectName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            From: {invite.inviterName}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">
                            Role: {invite.role}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-xs gap-1 border-success/30 text-success hover:bg-success/10"
                          onClick={() => handleAcceptProjectInvite(invite.id)}
                          disabled={acceptingInviteId === invite.id}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {acceptingInviteId === invite.id ? '...' : 'Accept'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeclineProjectInvite(invite.id)}
                          disabled={decliningInviteId === invite.id}
                        >
                          <XCircle className="h-3 w-3" />
                          {decliningInviteId === invite.id ? '...' : 'Decline'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Shared Items Section */}
            {(() => {
              // Filter: hide accepted items for recipients, and sender's acknowledged items
              const visibleItems = sharedItems.filter((item) => {
                const isSender = item.sender_user_id === userId;
                const isRecipient = item.recipient_user_id === userId;
                // Hide accepted items from recipient's view (task is now in Shared Projects)
                if (isRecipient && item.status === 'accepted') return false;
                // Hide sender's accepted+acknowledged items
                if (isSender && item.status === 'accepted' && item.sender_acknowledged) return false;
                // Hide sender's pending items that have been dismissed (acknowledged)
                if (isSender && item.status === 'pending' && item.sender_acknowledged) return false;
                return true;
              });
              // Show only the first (oldest) notification at a time
              const queuedItem = visibleItems.length > 0 ? [visibleItems[visibleItems.length - 1]] : [];
              return queuedItem.length > 0 ? (
              <div className="mt-3 px-2">
                <div className="px-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5" />
                    Shared Items {visibleItems.length > 1 ? `(${visibleItems.length})` : ''}
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {queuedItem.map((item) => {
                    const isPending = item.status === 'pending';
                    const isAccepted = item.status === 'accepted';
                    const isSender = item.sender_user_id === userId;
                    const isChangeRequest = item.item_type === 'change_request';
                    const typeIcon = (item.item_type === 'task' || isChangeRequest)
                      ? <ClipboardList className="h-3.5 w-3.5 text-primary" />
                      : item.item_type === 'project' 
                      ? <Folder className="h-3.5 w-3.5 text-primary" />
                      : <Mic className="h-3.5 w-3.5 text-primary" />;
                    
                    // For change_request items, sender_name holds the change message
                    const changeMessage = isChangeRequest ? item.sender_name : null;
                    
                    return (
                      <div key={item.id} className={`rounded-lg border p-2.5 space-y-1.5 ${isChangeRequest ? 'border-orange-500/40 bg-orange-500/5' : 'border-border/50 bg-card/50'}`}>
                        {isChangeRequest && (
                          <div className="flex items-center gap-1.5 text-orange-400">
                            <span className="text-xs font-semibold">⚠️ Changes Requested</span>
                          </div>
                        )}
                        <div className="flex items-start gap-2">
                          {typeIcon}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.item_title}</p>
                            {item.project_name && (
                              <p className="text-xs text-muted-foreground truncate">
                                <Folder className="h-3 w-3 inline mr-1" />
                                {item.project_name}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground truncate">
                              {isChangeRequest
                                ? `From: ${resolveDisplayName(item.sender_user_id, item.sender_email)}`
                                : isSender 
                                  ? `To: ${resolveDisplayName(item.recipient_user_id, item.recipient_email)}` 
                                  : `From: ${resolveDisplayName(item.sender_user_id, item.sender_email)}`
                              }
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {isChangeRequest ? 'task' : item.item_type}
                          </Badge>
                        </div>
                        {/* Show change request message */}
                        {isChangeRequest && changeMessage && (
                          <p className="text-xs text-orange-300/80 italic px-1">"{changeMessage}"</p>
                        )}
                        {isPending && !isSender && (
                          <TooltipProvider delayDuration={200}>
                            <div className="flex items-center gap-1 w-full">
                              <Badge variant="outline" className="flex-1 min-w-0 inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="truncate">Awaiting your response</span>
                              </Badge>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label="Accept"
                                    className="h-6 w-6 p-0 shrink-0 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                                    onClick={() => handleAcceptSharedItem(item.id)}
                                    disabled={acceptingId === item.id}
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Accept</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label="Reject"
                                    className="h-6 w-6 p-0 shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                                    onClick={() => handleDeclineSharedItem(item.id)}
                                    disabled={decliningId === item.id}
                                  >
                                    <XCircle className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reject</TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        )}
                        {isPending && isSender && (
                          <TooltipProvider delayDuration={200}>
                            <div className="flex items-center gap-1 w-full">
                              <Badge variant="outline" className="flex-1 min-w-0 inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="truncate">Pending acceptance</span>
                              </Badge>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label="Dismiss"
                                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground border-muted-foreground/30 hover:bg-muted/50"
                                    onClick={() => handleAcknowledgeSharedItem(item.id)}
                                  >
                                    <EyeOff className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Dismiss</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    aria-label="Cancel"
                                    className="h-6 w-6 p-0 shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                                    onClick={() => handleCancelSharedItem(item.id)}
                                    disabled={cancellingId === item.id}
                                  >
                                    <XCircle className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Cancel</TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        )}
                        {isAccepted && (
                          <TooltipProvider delayDuration={200}>
                            <div className="flex items-center gap-1 w-full">
                              <Badge variant="outline" className="flex-1 min-w-0 inline-flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                                <CheckCircle2 className="h-3 w-3 shrink-0" />
                                <span className="truncate">Accepted</span>
                              </Badge>
                              {isSender && !item.sender_acknowledged && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      aria-label="Dismiss"
                                      className="h-6 w-6 p-0 shrink-0 text-muted-foreground border-muted-foreground/30 hover:bg-muted/50"
                                      onClick={() => handleAcknowledgeSharedItem(item.id)}
                                    >
                                      <EyeOff className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Dismiss</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TooltipProvider>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              ) : null;
            })()}

            {/* Shared Projects */}
            {sharedProjects.length > 0 && (
              <div className="mt-3 px-2">
                <div className="px-2 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5" />
                    Shared Projects ({sharedProjects.length})
                  </h3>
                </div>
                <div className="space-y-1">
                  {sharedProjects.map((project) => (
                    <Button
                      key={project.id}
                      variant={selectedProjectId === project.id ? 'secondary' : 'ghost'}
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        handleSelectProject(project.id);
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <Folder className="h-4 w-4" style={{ color: project.color }} />
                      <span className="truncate">{project.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Projects with AnimatedList */}
            {projects.length > 0 && (
              /* U2 — drag a project row onto another project's block to nest it,
                 or onto the "My Projects" heading to bring it back to top level.
                 O8 adds the seam: aim at the thin band at a block's top or bottom
                 edge (or either half of a sub row) and the row lands BETWEEN its
                 siblings instead, which is what persists sort_order.
                 The DndContext wraps the Pinned group AND "My Projects": shared
                 projects and the archived section are neither movers nor targets. */
              <DndContext
                sensors={dragSensors}
                collisionDetection={projectDropCollision}
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                /* dnd-kit's default screen-reader instructions promise a
                   keyboard pick-up with Space; this context has no
                   KeyboardSensor on purpose (Space selects the row), so the
                   instructions say what is actually true. */
                accessibility={{
                  screenReaderInstructions: {
                    draggable:
                      'Press and hold, then drag this project onto another project to make it a sub-project, onto the gap between two projects to reorder them, or onto the My Projects heading to move it to the top level. Keyboard users can use Move to... in the project actions instead.',
                  },
                }}
                onDragStart={handleProjectDragStart}
                onDragMove={handleProjectDragMove}
                onDragEnd={handleProjectDragEnd}
                onDragCancel={endProjectDrag}
              >
              {/* Pinned (O8): the same heading shape the Shared Projects section
                  uses, nothing new invented. A pinned top-level project brings its
                  whole block up here; a pinned sub gets a flat shortcut row and
                  still renders under its parent below. */}
              {pinnedEntries.length > 0 && (
                <div className="mt-3 px-2" data-testid="pinned-projects">
                  <div className="px-2 mb-2">
                    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                      <Pin className="h-3.5 w-3.5" />
                      Pinned ({pinnedEntries.length})
                    </h3>
                  </div>
                  <div className="space-y-1" data-testid="pinned-projects-list">
                    {pinnedEntries.map((entry) =>
                      entry.kind === 'block' ? (
                        renderProjectBlock(entry.node)
                      ) : (
                        <Button
                          key={`pinned-${entry.project.id}`}
                          variant={selectedProjectId === entry.project.id ? 'secondary' : 'ghost'}
                          className="w-full justify-start gap-2"
                          data-testid={`pinned-row-${entry.project.id}`}
                          onClick={() => {
                            handleSelectProject(entry.project.id);
                            if (isMobile) setOpenMobile(false);
                          }}
                        >
                          <Folder className="h-4 w-4" style={{ color: entry.project.color }} />
                          <span className="truncate">{entry.project.name}</span>
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              )}
              <div className="mt-4">
                <ProjectsHeaderDrop count={myProjectsRowCount} canAccept={canDropAtTopLevel} />
                <div className="px-2 space-y-1" data-testid="my-projects-list">
                  {unpinnedTree.map((node) => renderProjectBlock(node))}
                </div>
              </div>
              {/* The ghost MUST be portalled to <body>: DragOverlay is
                  position:fixed, and `.lg-side` (this drawer) carries
                  backdrop-filter, which makes it the containing block for fixed
                  descendants. Left in place the ghost would lay out from the
                  panel's origin instead of the viewport AND feed dnd-kit a
                  collision rect offset by the same amount, so the drop would
                  land on the wrong row — the exact bug the task list's overlay
                  comment records (DraggableTaskList.tsx). */}
              {typeof document !== 'undefined'
                ? createPortal(projectDragOverlay, document.body)
                : projectDragOverlay}
              </DndContext>
            )}

            {/* Archived section — BOTTOM of the drawer, collapsed/quiet by
                default. Restore only; rename/delete stay owner actions on the
                active project view and don't apply here. */}
            {archivedProjects.length > 0 && (
              <div className="mt-4 mb-2">
                <button
                  type="button"
                  data-testid="archived-projects-toggle"
                  className="w-full flex items-center gap-1.5 px-4 mb-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setArchivedSectionOpen((o) => !o)}
                  aria-expanded={archivedSectionOpen}
                >
                  {archivedSectionOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {/* Counts RENDERED rows, not raw archived projects: a sub
                      archived by the cascade is folded into its parent's row
                      (with its own "(N sub-projects)" suffix there), so counting
                      raw rows would advertise more entries than the list shows. */}
                  <span>Archived ({archivedRows.length})</span>
                </button>
                {archivedSectionOpen && (
                  <div className="px-2 space-y-1" data-testid="archived-projects-list">
                    {archivedRows.map(({ project, cascadedSubCount }) => (
                      <div
                        key={project.id}
                        className="w-full flex items-center gap-1"
                      >
                        {/* Tapping the row (not Restore) selects the project via
                            the SAME path an active row uses — handleSelectProject
                            + close the drawer on mobile — so an archived project's
                            tasks/report stay reachable without restoring first. A
                            sibling Button (not nested) avoids an invalid
                            button-inside-button; the Restore button stays a
                            separate hit target next to it. */}
                        <Button
                          variant={selectedProjectId === project.id ? 'secondary' : 'ghost'}
                          className="flex-1 justify-start gap-2 min-w-0 text-muted-foreground"
                          data-testid={`select-archived-project-${project.id}`}
                          /* Explicit accessible name when the row carries the
                             cascaded-sub suffix: the visible "(2 sub-projects)"
                             text would otherwise land in the accessible name,
                             where the substring "projects" collides with the
                             drawer's own aria-label="Projects". */
                          aria-label={cascadedSubCount > 0 ? `${project.name}, ${cascadedSubCount} archived with it` : undefined}
                          onClick={() => {
                            handleSelectProject(project.id);
                            if (isMobile) setOpenMobile(false);
                          }}
                        >
                          <Folder className="h-4 w-4 shrink-0" style={{ color: project.color }} />
                          <span className="truncate">{project.name}</span>
                          {/* Sub-projects archived BY THE CASCADE are folded into
                              their parent's row rather than listed separately —
                              Restore here brings the whole set back. A sub
                              archived on its own (parent still active) keeps its
                              own row and is not counted here. */}
                          {cascadedSubCount > 0 && (
                            <span
                              className="text-xs shrink-0 opacity-70"
                              data-testid={`archived-sub-count-${project.id}`}
                            >
                              ({cascadedSubCount} sub-project{cascadedSubCount === 1 ? '' : 's'})
                            </span>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 gap-1 shrink-0"
                          data-testid={`restore-project-${project.id}`}
                          disabled={restoringProjectId === project.id}
                          onClick={() => handleRestoreProject(project.id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          <span className="text-xs">Restore</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </SidebarScrollArea>
    </>
  );

  // Dialog rendered separately so it works even when Sheet is closed on mobile
  const createDialog = (
    <CreateProjectDialog 
      open={isCreateOpen}
      onOpenChange={setIsCreateOpen}
      onCreate={handleCreateProject}
      /* Eligible parents: this user's OWN active TOP-LEVEL projects. Sub-projects
         are excluded so nothing two levels deep can be created (shared projects
         never reach this list — `projects` is the own-only state). */
      parentOptions={projectTree.map((node) => node.parent)}
      defaultParentId={createParentProjectId}
    />
  );

  // On mobile, use Sheet overlay - dialog is OUTSIDE the Sheet
  // BUT when tour is active, use a simple fixed div to avoid Radix focus/event trapping
  // Overlay mode aliases isMobile to true (see the useSidebar block), so a host
  // page gets this same portalled drawer at every width — desktop included.
  if (isMobile) {
    if (isTourActive) {
      // Tour mode: Bypass Sheet entirely, use simple fixed positioning
      return (
        <>
          {/* No backdrop during tour — the tour's spotlight overlay handles dimming
              and cuts a hole around the highlighted target. A second backdrop here
              would dim the spotlighted element too. */}
          {/* Sidebar content */}
          <div 
            className={`
              fixed inset-y-0 left-0 z-50 w-[280px] lg-side
              transform transition-transform duration-300 ease-in-out flex flex-col
              ${openMobile ? 'translate-x-0' : '-translate-x-full'}
            `}
            style={{ zIndex: 51 }}
          >
            {sidebarContent}
          </div>
          {createDialog}
          <TourLoadingOverlay label={launchingTourLabel} />
        </>
      );
    }
    
    // Normal mode: plain-div portal (NOT a Radix Sheet).
    //
    // Why not Radix: the drawer is opened by a PLAIN button (BottomNav's Projects
    // tab -> toggleSidebar), not a SheetTrigger. A forceMounted Radix Sheet keeps
    // its DismissableLayer mounted and listening while closed, and on TOUCH it
    // defers its outside-dismiss to a one-shot document click listener. React's
    // root onClick (toggle -> open) runs first, the document listener (onDismiss
    // -> onOpenChange(false)) runs second, so every open/reopen tap is cancelled.
    // A forceMounted Radix layer cannot be BOTH permanently mounted AND quiet
    // while closed. Device-diagnosed 2026-07-11. The tour branch above already
    // proved a plain fixed div works; this mirrors it.
    //
    // Why a portal to document.body: ancestor elements carry backdrop-filter,
    // which makes them the containing block for position:fixed — a fixed child
    // would otherwise be trapped inside the filtered ancestor's box. Portalling
    // to <body> escapes that so the panel/overlay pin to the viewport.
    //
    // WHITE-FLASH LAW: the overlay and panel are PERMANENTLY rendered (never
    // conditionally mounted, never visibility:hidden), so their compositing
    // layers are born once and never torn down. Open/close is driven ONLY by the
    // .lg-side / .lg-side-overlay [data-state] CSS transforms in index.css —
    // animating an already-rastered layer, which the 2026-07-09 device bisect
    // proved is the only Safari-safe path (a layer animated across its
    // birth/death paints blank white for a frame).
    return (
      <>
        {createPortal(
          <>
            <div
              data-state={openMobile ? 'open' : 'closed'}
              {...closedInert}
              className="fixed inset-0 z-50 lg-side-overlay"
              // Tap-outside-to-close, but ONLY when the gesture both started and
              // ended on this overlay. onPointerDown latches the start; onClick
              // closes only if that latch is set, then resets it. A ghost click
              // (the navigating tap's trailing synthesized click, whose
              // pointerdown fired on the previous page before this overlay
              // existed) has no latch, so it can never self-close the drawer.
              // (Igor video 2026-07-18.)
              onPointerDown={() => { overlayPointerDownRef.current = true; }}
              onClick={() => {
                if (!overlayPointerDownRef.current) return;
                overlayPointerDownRef.current = false;
                setOpenMobile(false);
              }}
            />
            <div
              ref={dragPanelRef}
              role="dialog"
              aria-label="Projects"
              // Overlay mode only (so /app's drawer is untouched): the host
              // pages keep this panel mounted permanently, and a closed, off-
              // screen drawer must not sit in the a11y tree of the page behind
              // it — nor answer to getByRole('dialog') alongside that page's own
              // dialogs. Attribute only: no style, so the compositing layer is
              // never touched (white-flash law).
              aria-hidden={isOverlay && !openMobile ? true : undefined}
              {...closedInert}
              data-state={openMobile ? 'open' : 'closed'}
              className="fixed inset-y-0 left-0 h-full z-50 w-[280px] p-0 lg-side flex flex-col gap-4"
              onPointerDown={onPanelPointerDown}
              onPointerMove={onPanelPointerMove}
              onPointerUp={onPanelPointerUp}
              onPointerCancel={onPanelPointerUp}
            >
              {sidebarContent}
            </div>
          </>,
          document.body,
        )}
        {createDialog}
        <TourLoadingOverlay label={launchingTourLabel} />
      </>
    );
  }

  // On desktop, use conditional width and opacity with smooth transitions
  return (
    <div 
      className={`
        border-r bg-background flex flex-col h-screen lg-side
        transition-all duration-300 ease-in-out relative z-20
        ${sidebarOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0 overflow-hidden'}
      `}
    >
      {sidebarContent}
      {createDialog}
      <TourLoadingOverlay label={launchingTourLabel} />
    </div>
  );
};