import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  senderProjectSharedMap = {}
}: ProjectSidebarProps) => {
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

  // Debounce sidebar search
  useEffect(() => {
    const timer = setTimeout(() => setSidebarSearchQuery(sidebarSearchInput), 300);
    return () => clearTimeout(timer);
  }, [sidebarSearchInput]);
  
  // Use controlled state if provided, otherwise use internal state
  const isCreateOpen = createDialogOpen !== undefined ? createDialogOpen : isCreateOpenInternal;
  const setIsCreateOpen = onCreateDialogOpenChange || setIsCreateOpenInternal;

  useEffect(() => {
    if (!userId) return;
    fetchProjects();
    fetchMeetings();
    fetchSharedItems();
    fetchProjectInvitations();
  }, [projectRefreshTrigger, userId]);

  // Recover from cold-start auth races (mobile Safari): refetch projects when
  // Supabase finishes restoring/refreshing the session after initial mount.
  useEffect(() => {
    if (!userId) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        fetchProjects();
        fetchMeetings();
        fetchSharedItems();
        fetchProjectInvitations();
      }
    });
    return () => subscription.unsubscribe();
  }, [userId]);

  // Supabase Realtime: live shared items for current user (as recipient)
  useEffect(() => {
    if (!userId) return;

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
          fetchSharedItems();
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
          fetchSharedItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Realtime: re-fetch shared projects when any of this user's tasks change (status updates)
  useEffect(() => {
    if (!userId) return;

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
          // Re-fetch projects to update shared project visibility
          fetchProjects();
          // Also re-fetch shared items in case a change_request was created
          fetchSharedItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(taskChannel);
    };
  }, [userId]);

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

  const fetchProjects = async () => {
    // Retry with backoff to survive cold-start auth races on mobile Safari
    const delays = [0, 300, 800, 1500];
    let data: any = null;
    let error: any = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      const res = await (supabase as any)
        .from('focusos_projects')
        .select('*')
        .order('created_at', { ascending: false });
      data = res.data;
      error = res.error;
      if (!error) break;
    }

    if (error) {
      console.error('[ProjectSidebar] fetchProjects failed after retries:', error);
      toast.error('Failed to load projects');
      return;
    }

    // Split into own projects and shared projects
    const ownProjects = data.filter((p: any) => !p.is_shared);
    const shared = data.filter((p: any) => p.is_shared);
    setProjects(ownProjects.map((p: any) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      timer: { totalSeconds: 0, isRunning: false }
    })));

    // For shared projects, filter out those where ALL tasks are completed
    if (shared.length > 0) {
      const sharedIds = shared.map((p: any) => p.id);
      const { data: sharedTasks } = await (supabase as any)
        .from('focusos_tasks')
        .select('id, project_id, status, change_request_message')
        .in('project_id', sharedIds);

      const activeShared = shared.filter((p: any) => {
        const projectTasks = (sharedTasks || []).filter((t: any) => t.project_id === p.id);
        // Show if no tasks yet, or if any task is actively visible (not completed AND no pending change request)
        const visibleActiveTasks = projectTasks.filter((t: any) => t.status !== 'completed' && !t.change_request_message);
        return projectTasks.length === 0 || visibleActiveTasks.length > 0;
      });

      setSharedProjects(activeShared.map((p: any) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        timer: { totalSeconds: 0, isRunning: false }
      })));
    } else {
      setSharedProjects([]);
    }
  };

  const fetchMeetings = async () => {
    const { data, error } = await (supabase as any)
      .from('focusos_meetings')
      .select('id, title')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setMeetings(data.map(m => ({ id: m.id, title: m.title })));
    }
  };

  const fetchSharedItems = async () => {
    // Best-effort: sync Google RSVPs into sender's pending shared items
    // before reading. Silent — never blocks UI on failure.
    try {
      await (supabase as any).functions.invoke('focusos-sync-shared-rsvp');
    } catch (e) {
      // ignore; we still render whatever is in the table
    }
    const { data, error } = await (supabase as any)
      .from('focusos_shared_items')
      .select('*')
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    if (!error && data) {
      setSharedItems(data);
    }
  };

  const fetchProjectInvitations = async () => {
    if (!userId) return;
    const { data, error } = await (supabase as any)
      .from('focusos_project_members')
      .select('id, project_id, invited_by, invited_email, role, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
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
    if (!userId) return;
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
          fetchProjectInvitations();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

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
      fetchProjectInvitations();
      fetchProjects();
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
      fetchProjectInvitations();
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
      await fetchProjects();
      await fetchSharedItems();
      await fetchMeetings();
      
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
      fetchSharedItems();
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
      fetchSharedItems();
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
      fetchSharedItems();
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
      fetchSharedItems();
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

    const { error } = await (supabase as any)
      .from('focusos_projects')
      .insert({ name, color, user_id: userId });

    if (error) {
      toast.error('Failed to create project');
      return;
    }

    toast.success('Project created!');
    fetchProjects();
    setIsCreateOpen(false);
    onProjectCreated?.();
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
  const { open: sidebarOpen, setOpen: setSidebarOpen, openMobile, setOpenMobile, isMobile } = useSidebar();

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
              <DropdownMenuItem onClick={() => navigate('/home?tour=home')}>
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
    
    // Normal mode: Use Sheet
    return (
      <>
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            side="left"
            className="w-[280px] p-0 lg-side flex flex-col"
            overlayClassName="lg-side-overlay"
          >
            {sidebarContent}
          </SheetContent>
        </Sheet>
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