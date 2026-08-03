import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
} from '@/lib/appDataFetchers';
import { Project } from '@/types/task';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Folder, ListTodo, Calendar, HelpCircle, Mic, Search, Share2, CheckCircle2, XCircle, FileText, ClipboardList, Users, Clock, EyeOff, X } from 'lucide-react';
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
  isTourActive,
  userId,
  senderProjectSharedMap = {},
  overlayMode,
  open: overlayOpen,
  onOpenChange: overlayOnOpenChange,
}: ProjectSidebarProps) => {
  const isOverlay = !!overlayMode;
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
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
    setProjects(ownProjects.map((p: any) => ({
      id: p.id,
      name: p.name,
      color: p.color,
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

  const isSearching = sidebarSearchQuery.trim().length > 0;
  const matchedProjects = isSearching ? projectFuse.search(sidebarSearchQuery.trim()).map(r => r.item) : [];
  const matchedMeetings = isSearching ? meetingFuse.search(sidebarSearchQuery.trim()).map(r => r.item) : [];

  const handleCreateProject = async (name: string, color: string) => {
    if (!userId) return;

    // `.select()` so overlay mode can open the project it just created AND seed the
    // row into the shared cache (the same insert+select pattern as brainDumpSave.ts /
    // Index's demo projects). /app ignores the returned row and behaves as before.
    const { data: created, error } = await (supabase as any)
      .from('focusos_projects')
      .insert({ name, color, user_id: userId })
      .select()
      .maybeSingle();

    if (error) {
      toast.error('Failed to create project');
      return;
    }

    toast.success('Project created!');
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
              <div className="mt-4">
                <div className="px-4 mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">My Projects ({projects.length})</h3>
                </div>
                <div className="px-2 space-y-1">
                  {projects.map((project) => {
                    const dataAttrs =
                      selectedProjectId === project.id && project.name.startsWith('Demo Project')
                        ? { 'data-projects-tour-step': 'demo-project' as const }
                        : {};
                    return (
                      <div key={project.id} className="w-full" {...dataAttrs}>
                        <Button
                          variant={selectedProjectId === project.id ? 'secondary' : 'ghost'}
                          className="w-full justify-start gap-2"
                          onClick={() => {
                            handleSelectProject(project.id);
                            if (isMobile) setOpenMobile(false);
                          }}
                        >
                          <Folder
                            className="h-4 w-4"
                            style={{ color: project.color }}
                          />
                          <span className="truncate">{project.name}</span>
                        </Button>
                        {senderProjectSharedMap[project.id] && (
                          <div className="ml-8 mt-0.5 mb-1">
                            <ShareStatusPopover recipients={senderProjectSharedMap[project.id]} itemType="Project" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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