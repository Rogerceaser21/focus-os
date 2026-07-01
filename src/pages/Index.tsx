import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Fuse from 'fuse.js';

import { useTheme } from 'next-themes';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { Task, Project, TaskPriority, TaskStatus } from '@/types/task';
import { TaskCard } from '@/components/TaskCard';
import { TaskListItem } from '@/components/TaskListItem';
import { GanttChart } from '@/components/GanttChart';
import { TimeTrackingChart } from '@/components/TimeTrackingChart';
import { AddTaskDialog } from '@/components/AddTaskDialog';
import { ProjectSidebar } from '@/components/ProjectSidebar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Search, LayoutList, LayoutGrid, GanttChartSquare, Clock, LogOut, FolderKanban, ListChecks, Calendar, Settings, Eye, ChevronDown, Check, Trash2, Mic, ArrowUpDown, Share2, Plus, AlertTriangle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from 'sonner';
import LightRays from '@/components/LightRays';
import HeroSection from '@/components/HeroSection';
import { startOfDay, endOfDay } from 'date-fns';
import { SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

import BottomNav from '@/components/BottomNav';
import { useParticleAnimation } from '@/hooks/useParticleAnimation';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import SettingsDialog from '@/components/SettingsDialog';
import { useUserPreferences, type UserPreferences } from '@/hooks/useUserPreferences';
// OnboardingTour removed — replaced by HomeTour on /home
import { TaskTour } from '@/components/TaskTour';
import { ProjectTour } from '@/components/ProjectTour';
import { EditTaskDialog } from '@/components/EditTaskDialog';
import { DraggableTaskList } from '@/components/DraggableTaskList';
import { ShareItemDialog } from '@/components/ShareItemDialog';
import { ShareStatusPopover } from '@/components/ShareStatusPopover';
import { InviteProjectMemberDialog } from '@/components/InviteProjectMemberDialog';
import { ProjectMembersBar } from '@/components/ProjectMembersBar';
import { addDays } from 'date-fns';
import RecordFAB from '@/components/RecordFAB';
// Inline skeleton for the task list area shown while initialLoadComplete is false.
const TaskListSkeleton = () => {
  const dots = [
    { color: '#B8572E', delay: 0 },
    { color: '#81313F', delay: 0.16 },
    { color: '#67883A', delay: 0.32 },
  ];

  return (
    <div className="mt-6 flex items-center justify-center py-20 min-h-[200px]">
      <div className="flex items-center gap-[11px]">
        {dots.map((dot, i) => (
          <motion.span
            key={i}
            className="inline-block rounded-full"
            style={{ width: 14, height: 14, backgroundColor: dot.color }}
            animate={{ y: [0, -14, 0], opacity: [0.45, 1, 0.45] }}
            transition={{
              duration: 1.1,
              ease: 'easeInOut',
              repeat: Infinity,
              delay: dot.delay,
            }}
          />
        ))}
      </div>
    </div>
  );
};

// Projects FAB component for mobile - must be inside SidebarProvider
const ProjectsFAB = () => {
  const { toggleSidebar, openMobile } = useSidebar();
  
  // Hide when mobile sidebar is open
  if (openMobile) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, delay: 0.2 }}
      className="fixed left-6 z-[100]"
      style={{ bottom: 'calc(44px + env(safe-area-inset-bottom))' }}
    >
      <button
        onClick={toggleSidebar}
        className="relative w-[50px] h-[50px] rounded-full p-[3px] shadow-lg"
        style={{
          background: 'conic-gradient(from 0deg, hsl(var(--primary)), hsl(var(--accent)), hsl(var(--warning)), hsl(var(--primary)))'
        }}
      >
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
          <span className="text-2xl font-bold text-primary">P</span>
        </div>
      </button>
    </motion.div>
  );
};

// BottomNav wrapper that provides sidebar toggle - must be inside SidebarProvider
type BottomNavWithSidebarProps = {
  projects: { id: string; name: string; color?: string }[];
  preferences: UserPreferences | null;
  prefsLoading: boolean;
  onSavePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
};

const BottomNavWithSidebar = ({
  projects,
  preferences,
  prefsLoading,
  onSavePreferences,
  settingsOpen,
  onSettingsOpenChange,
}: BottomNavWithSidebarProps) => {
  const { toggleSidebar } = useSidebar();

  return (
    <BottomNav
      projects={projects}
      onToggleSidebar={toggleSidebar}
      preferences={preferences}
      prefsLoading={prefsLoading}
      onSavePreferences={onSavePreferences}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={onSettingsOpenChange}
    />
  );
};

// Mobile sidebar controller - handles both Projects Tour AND openSidebar navigation
const MobileSidebarController = ({ tourStep, isTourActive, currentTourStep, openSidebarRequested, onOpenSidebarHandled }: { tourStep: number | null; isTourActive: boolean; currentTourStep: number; openSidebarRequested: boolean; onOpenSidebarHandled: () => void }) => {
  const { setOpenMobile, isMobile } = useSidebar();
  
  // Handle openSidebar request from navigation (e.g. Home -> Projects)
  React.useEffect(() => {
    if (!openSidebarRequested || !isMobile) return;
    setOpenMobile(true);
    onOpenSidebarHandled();
  }, [openSidebarRequested, isMobile, setOpenMobile, onOpenSidebarHandled]);

  // Handle tour steps
  React.useEffect(() => {
    if (!isTourActive || !isMobile) return;
    
    const activeStep = currentTourStep;
    
    if (activeStep === 0 || activeStep === 2) {
      setOpenMobile(true);
    } else {
      const timer = setTimeout(() => {
        setOpenMobile(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentTourStep, isTourActive, isMobile, setOpenMobile]);
  
  return null;
};

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    loading: authLoading,
    signOut
  } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [authLoading, user, navigate]);

  // Debounce search input → searchQuery (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'gantt' | 'time-tracking'>('grid');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSpecialList, setSelectedSpecialList] = useState<'unassigned' | 'today' | 'past-due' | null>(null);
  const [projectRefreshTrigger, setProjectRefreshTrigger] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isBrainDumpRecording, setIsBrainDumpRecording] = useState(false);
  const [isBrainDumpCtaActive, setIsBrainDumpCtaActive] = useState(false);
  const [globalCardView, setGlobalCardView] = useState<'full' | 'compact' | 'minimal'>('full');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'all' | 'todo' | 'in-progress' | 'completed'>('all');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [openSidebarRequested, setOpenSidebarRequested] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [showTaskTour, setShowTaskTour] = useState(false);
  const [taskTourTask, setTaskTourTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskToShare, setTaskToShare] = useState<Task | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareProjectDialogOpen, setShareProjectDialogOpen] = useState(false);
  const [changesNeededTask, setChangesNeededTask] = useState<Task | null>(null);
  const [changesNeededMessage, setChangesNeededMessage] = useState('');
  const [changesNeededDialogOpen, setChangesNeededDialogOpen] = useState(false);
  const [changesNeededLoading, setChangesNeededLoading] = useState(false);
  const [addTaskDialogOpen, setAddTaskDialogOpen] = useState(false);
  
  const [fabExpanded, setFabExpanded] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [memberRefreshTrigger, setMemberRefreshTrigger] = useState(0);
  const [fullDataLoaded, setFullDataLoaded] = useState(false);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const allTasksRef = useRef<Task[]>([]);
  useEffect(() => { allTasksRef.current = allTasks; }, [allTasks]);
  const [senderSharedMap, setSenderSharedMap] = useState<Record<string, Array<{ email: string; name: string; status: string; sharedItemId?: string }>>>({});
  const [senderProjectSharedMap, setSenderProjectSharedMap] = useState<Record<string, Array<{ email: string; name: string; status: string; sharedItemId?: string }>>>({});
  const [assignerNameMap, setAssignerNameMap] = useState<Record<string, string>>({});
  const [showProjectsTour, setShowProjectsTour] = useState(false);
  const [projectsTourCurrentStep, setProjectsTourCurrentStep] = useState(0);
  const [projectsTourProjects, setProjectsTourProjects] = useState<{id: string, name: string}[]>([]);
  const [projectsTourTask, setProjectsTourTask] = useState<Task | null>(null);
  const [createProjectDialogOpenForTour, setCreateProjectDialogOpenForTour] = useState(false);
  const [tourCreateDialogOpen, setTourCreateDialogOpen] = useState(false);
  const [lastProcessedTourStep, setLastProcessedTourStep] = useState<number | null>(null);
  
  const { preferences, loading: prefsLoading, updatePreferences, markOnboardingComplete, markTaskTourComplete, markProjectsTourComplete } = useUserPreferences(user?.id);
  const { setTheme, theme } = useTheme();
  const isCream = theme === 'cream';
  const { triggerParticles, containerRef } = useParticleAnimation({
    particleCount: 12,
    colors: ['#4FD1C5', '#3B82F6', '#06B6D4'],
    animationDuration: 0.6
  });
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  // Sync sidebar state with screen size changes
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Handle clicking outside task cards to collapse them
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Check if click is outside all task cards
      const isOutsideTaskCard = !target.closest('[data-task-card]');
      
      // Check if click is on the 3rd row elements (priority, date, photo)
      const isThirdRowClick = target.closest('[data-third-row]');
      
      // Check if click is on a dropdown menu (to keep task expanded when selecting priority)
      const isDropdownClick = target.closest('[role="menu"]') || 
                             target.closest('[role="menuitem"]') || 
                             target.closest('[data-radix-popper-content-wrapper]') ||
                             target.closest('[data-radix-dropdown-menu-content]');
      
      if (isOutsideTaskCard && !isThirdRowClick && !isDropdownClick && expandedTaskIds.size > 0) {
        setExpandedTaskIds(new Set());
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedTaskIds]);

  // Auth redirect is now handled in the render gate below

  // Helper function to transform DB task format to app Task format
  const transformDbTask = useCallback((dbTask: any): Task => ({
    id: dbTask.id,
    title: dbTask.title,
    description: dbTask.description,
    priority: dbTask.priority,
    status: dbTask.status,
    startDate: dbTask.start_date ? new Date(dbTask.start_date) : undefined,
    endDate: dbTask.end_date ? new Date(dbTask.end_date) : undefined,
    dueDate: dbTask.due_date ? new Date(dbTask.due_date) : undefined,
    images: dbTask.images ? (dbTask.images as string[]) : [],
    timer: {
      totalSeconds: dbTask.timer_total_seconds,
      isRunning: dbTask.timer_is_running,
      startTime: dbTask.timer_start_time
    },
    projectId: dbTask.project_id,
    sortOrder: dbTask.sort_order ?? 0,
    completedByEmail: dbTask.completed_by_email ?? undefined,
    assignedToEmail: dbTask.assigned_to_email ?? undefined,
    changeRequestMessage: dbTask.change_request_message ?? undefined,
    googleCalendarEventId: dbTask.google_calendar_event_id ?? undefined,
  }), []);

  // Fetch projects (lightweight - just names for sidebar)
  const fetchProjects = useCallback(async () => {
    // Retry with backoff to survive cold-start auth races on mobile Safari
    const delays = [0, 300, 800, 1500];
    let data: any = null;
    let error: any = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      const res = await (supabase as any).from('focusos_projects').select('*').order('created_at', {
        ascending: false
      });
      data = res.data;
      error = res.error;
      if (!error) break;
    }
    if (error) {
      console.error('[Index] fetchProjects failed after retries:', error);
      toast.error('Failed to load projects');
      return;
    }
    setProjects(data.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isShared: p.is_shared ?? false,
      userId: p.user_id,
      timer: {
        totalSeconds: 0,
        isRunning: false
      }
    })));
  }, []);

  // Phase 2: Fetch ALL tasks in background
  const fetchAllTasks = useCallback(async () => {
    try {
      const delays = [0, 300, 800, 1500];
      let data: any = null;
      let error: any = null;
      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
        const res = await (supabase as any)
          .from('focusos_tasks')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1000);
        data = res.data;
        error = res.error;
        if (!error) break;
      }
      if (error) {
        console.warn('[Index] fetchAllTasks failed after retries:', error);
        return;
      }
      const transformedTasks = data.map(transformDbTask);
      if (transformedTasks.length === 0 && allTasksRef.current.length > 0) {
        console.warn('[Index] fetchAllTasks returned 0 rows while tasks exist — ignoring to avoid blanking the list (transient auth/RLS race)');
        return;
      }
      setAllTasks(transformedTasks);
    } catch (error) {
      console.error('Error fetching all tasks:', error);
    }
  }, [transformDbTask]);

  // Build shared item maps from raw data (used by both cache and fetch paths)
  const buildSharedMaps = useCallback(async (sharedItems: any[]) => {
    if (!sharedItems || sharedItems.length === 0) {
      setSenderSharedMap({});
      setSenderProjectSharedMap({});
      return;
    }

    const recipientUserIds = sharedItems
      .map((si: any) => si.recipient_user_id)
      .filter((id: string | null) => id != null);

    let profilesMap: Record<string, string> = {};
    if (recipientUserIds.length > 0) {
      const { data: profiles } = await (supabase as any)
        .from('focusos_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', recipientUserIds);
      if (profiles) {
        for (const p of profiles) {
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
          if (name) profilesMap[p.user_id] = name;
        }
      }
    }

    const taskMap: Record<string, Array<{ email: string; name: string; status: string; sharedItemId?: string }>> = {};
    const projectMap: Record<string, Array<{ email: string; name: string; status: string; sharedItemId?: string }>> = {};
    for (const si of sharedItems) {
      const name = si.recipient_user_id && profilesMap[si.recipient_user_id]
        ? profilesMap[si.recipient_user_id]
        : si.recipient_email;
      const entry = { email: si.recipient_email, name, status: si.status, sharedItemId: si.id };
      if (si.item_type === 'task') {
        if (!taskMap[si.item_id]) taskMap[si.item_id] = [];
        taskMap[si.item_id].push(entry);
      } else if (si.item_type === 'project') {
        if (!projectMap[si.item_id]) projectMap[si.item_id] = [];
        projectMap[si.item_id].push(entry);
      }
    }
    setSenderSharedMap(taskMap);
    setSenderProjectSharedMap(projectMap);
  }, []);

  // Fetch shared items where current user is sender
  const fetchSenderSharedItems = useCallback(async () => {
    if (!user) return;
    try {
      const { data: sharedItems, error } = await (supabase as any)
        .from('focusos_shared_items')
        .select('id, item_id, item_type, recipient_email, recipient_user_id, recipient_task_id, status')
        .eq('sender_user_id', user.id)
        .in('item_type', ['task', 'project'])
        .neq('status', 'cancelled');
      
      if (error || !sharedItems) return;
      await buildSharedMaps(sharedItems);
    } catch (err) {
      console.error('Error fetching sender shared items:', err);
    }
  }, [user, buildSharedMaps]);


  // Legacy fetchTasks for specific use cases (task creation, etc.)
  // Always load the full task set so newly-created tasks for any list/project
  // land in `allTasks`; then re-apply the active view filter.
  const fetchTasks = useCallback(async () => {
    await fetchAllTasks();
  }, [fetchAllTasks]);

  // Re-fetch projects whenever projectRefreshTrigger changes (after initial load)
  useEffect(() => {
    if (initialLoadComplete) {
      fetchProjects();
    }
  }, [projectRefreshTrigger, initialLoadComplete, fetchProjects]);

  // Phase 1: Initial fast load - try warm cache first, then fetch
  useEffect(() => {
    const loadInitialData = async () => {
      if (user && preferences && !initialLoadComplete) {
        try {
          // Check if data was prefetched on the Home screen
          const cachedTasks = queryClient.getQueryData(['focusos-all-tasks', user.id]) as any[] | undefined;
          const cachedProjects = queryClient.getQueryData(['focusos-projects', user.id]) as any[] | undefined;

          if (cachedTasks && cachedTasks.length > 0 && cachedProjects) {
            // Warm cache hit — use prefetched data instantly (no network)
            const transformedTasks = cachedTasks.map(transformDbTask);
            setAllTasks(transformedTasks);
            setFullDataLoaded(true);

            setProjects(cachedProjects.map((p: any) => ({
              id: p.id,
              name: p.name,
              color: p.color,
              isShared: p.is_shared ?? false,
              userId: p.user_id,
              timer: { totalSeconds: 0, isRunning: false }
            })));

            // Also seed shared items from cache
            const cachedShared = queryClient.getQueryData(['focusos-sender-shared-items', user.id]) as any[] | undefined;
            if (cachedShared) {
              buildSharedMaps(cachedShared);
            }
          } else {
            // No cache — fetch projects; Phase 2 will populate tasks.
            await fetchProjects();
          }
        } catch (err) {
          console.error('[Index] Initial data load failed:', err);
        } finally {
          setInitialLoadComplete(true);
        }
      }
    };
    loadInitialData();
  }, [user, preferences, initialLoadComplete, fetchProjects, queryClient, transformDbTask]);

  // Phase 2: Background load - all remaining tasks + sender shared items
  useEffect(() => {
    const loadRemainingData = async () => {
      if (initialLoadComplete && user && !fullDataLoaded) {
        try {
          await Promise.all([fetchAllTasks(), fetchSenderSharedItems()]);
        } catch (err) {
          console.error('[Index] Background data load failed:', err);
        } finally {
          setFullDataLoaded(true);
        }
      }
    };
    loadRemainingData();
  }, [initialLoadComplete, user, fullDataLoaded, fetchAllTasks, fetchSenderSharedItems]);

  // Resolve assigner emails to names for shared project headers
  useEffect(() => {
    if (!allTasks.length || !projects.length) return;
    const sharedProjectIds = new Set(projects.filter(p => p.isShared).map(p => p.id));
    const assignerEmails = new Set<string>();
    for (const t of allTasks) {
      if (t.projectId && sharedProjectIds.has(t.projectId) && t.assignedToEmail) {
        assignerEmails.add(t.assignedToEmail);
      }
    }
    // Remove emails we already resolved
    const newEmails = [...assignerEmails].filter(e => !assignerNameMap[e]);
    if (newEmails.length === 0) return;
    (async () => {
      const { data: profiles } = await (supabase as any)
        .from('focusos_profiles')
        .select('user_email, first_name, last_name')
        .in('user_email', newEmails);
      if (profiles && profiles.length > 0) {
        const map: Record<string, string> = { ...assignerNameMap };
        for (const p of profiles) {
          const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
          if (name && p.user_email) map[p.user_email] = name;
        }
        setAssignerNameMap(map);
      }
    })();
  }, [allTasks, projects]);

  // Change request notifications are now handled via sidebar shared items, not toasts

  // Debounced resync safety net — refetches all tasks then re-applies the active filter.
  // Used to recover from missed realtime events after disconnects (tab backgrounded, network drop, etc.)
  const resyncDebounceRef = useRef<number | null>(null);
  const hasSubscribedOnceRef = useRef<boolean>(false);
  const resyncTasks = useCallback(() => {
    if (!user) return;
    if (!fullDataLoaded) return;
    if (resyncDebounceRef.current !== null) {
      window.clearTimeout(resyncDebounceRef.current);
    }
    resyncDebounceRef.current = window.setTimeout(async () => {
      resyncDebounceRef.current = null;
      await fetchAllTasks();
    }, 1000);
  }, [user, fullDataLoaded, fetchAllTasks]);
  const resyncTasksRef = useRef(resyncTasks);
  useEffect(() => { resyncTasksRef.current = resyncTasks; }, [resyncTasks]);

  // Wire up DOM events that signal a possible missed-event window
  useEffect(() => {
    if (!user) return;

    const onFocus = () => resyncTasks();
    const onOnline = () => resyncTasks();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resyncTasks();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      if (resyncDebounceRef.current !== null) {
        window.clearTimeout(resyncDebounceRef.current);
        resyncDebounceRef.current = null;
      }
    };
  }, [user, resyncTasks]);

  // Realtime subscription for tasks - keeps all sessions in sync
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`tasks-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'focusos_tasks',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const newTask = transformDbTask(payload.new);
          setAllTasks(prev => {
            if (prev.length === 0 || prev.some(t => t.id === newTask.id)) return prev;
            return [...prev, newTask];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'focusos_tasks',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const updatedTask = transformDbTask(payload.new);
          setAllTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
          // Trigger sidebar refresh for shared project visibility
          setProjectRefreshTrigger(prev => prev + 1);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'focusos_tasks',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const deletedTaskId = (payload.old as any).id;
          setAllTasks(prev => prev.filter(t => t.id !== deletedTaskId));
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Realtime connected');
          if (hasSubscribedOnceRef.current) {
            // Reconnect — refetch in case we missed events while disconnected
            resyncTasksRef.current();
          } else {
            hasSubscribedOnceRef.current = true;
          }
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Realtime error:', err);
        }
      });

    // Realtime subscription for shared items status updates (sender sees recipient accept/decline/complete)
    const sharedItemsChannel = supabase
      .channel(`shared-items-sender-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'focusos_shared_items',
          filter: `sender_user_id=eq.${user.id}`
        },
        () => {
          fetchSenderSharedItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(sharedItemsChannel);
    };
  }, [user, transformDbTask, fetchSenderSharedItems]);

  // Apply user preferences on load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');

    if (preferences && !preferencesLoaded && projects.length > 0 && !selectedProjectId && !selectedSpecialList) {
      // If URL has a view param, use it (from Home nav)
      if (viewParam === 'past-due' || viewParam === 'today' || viewParam === 'unassigned') {
        setSelectedSpecialList(viewParam);
        setSelectedProjectId(null);
      } else if (viewParam === 'projects') {
        // Just load default project view
        setSelectedSpecialList(null);
      } else if (viewParam && projects.some(p => p.id === viewParam)) {
        // Direct project id deep-link (e.g. from Convert-to-Project in MeetingDetail)
        setSelectedProjectId(viewParam);
        setSelectedSpecialList(null);
      } else if (preferences.default_view === 'today') {
        setSelectedSpecialList('today');
        setSelectedProjectId(null);
      } else if (preferences.default_view === 'unassigned') {
        setSelectedSpecialList('unassigned');
        setSelectedProjectId(null);
      } else {
        // It's a project ID - check if it still exists
        const projectExists = projects.some(p => p.id === preferences.default_view);
        if (projectExists) {
          setSelectedProjectId(preferences.default_view);
          setSelectedSpecialList(null);
        } else {
          // Fallback to today if project was deleted
          setSelectedSpecialList('today');
          setSelectedProjectId(null);
        }
      }
      
      // Apply display mode
      const modeMap: Record<string, 'list' | 'grid' | 'gantt' | 'time-tracking'> = {
        'list': 'list',
        'grid': 'grid',
        'gantt': 'gantt',
        'time': 'time-tracking'
      };
      setViewMode(modeMap[preferences.default_display_mode] || 'list');
      
      // Apply task filter
      setActiveTab(preferences.default_task_filter);
      
      // Apply theme
      if (preferences.theme) {
        setTheme(preferences.theme);
      }
      
      setPreferencesLoaded(true);
    }
  }, [preferences, preferencesLoaded, projects]);

  useEffect(() => {
    if (!preferences) return;

    setGlobalCardView(
      isMobile
        ? (preferences.default_task_card_view_mobile ?? 'compact')
        : (preferences.default_task_card_view ?? 'compact')
    );
    setExpandedTaskIds(new Set());
  }, [isMobile, preferences?.default_task_card_view, preferences?.default_task_card_view_mobile]);

  // React to URL search param changes (e.g. from BottomNav clicks)
  useEffect(() => {
    if (!preferencesLoaded) return;
    const urlParams = new URLSearchParams(location.search);
    const viewParam = urlParams.get('view');
    if (viewParam === 'past-due' || viewParam === 'today' || viewParam === 'unassigned') {
      setSelectedSpecialList(viewParam);
      setSelectedProjectId(null);
    } else if (viewParam === 'projects') {
      setSelectedSpecialList(null);
    }
  }, [location.search, preferencesLoaded]);

  // Auto-open sidebar when arriving via openSidebar param (mobile + desktop)
  // Apply the user's default_view preference so the right tasks load
  useEffect(() => {
    if (!preferencesLoaded || !preferences) return;
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get('openSidebar') === 'true') {
      // Apply the user's default_view to select the right project/list
      const dv = preferences.default_view;
      if (dv === 'today') {
        setSelectedSpecialList('today');
        setSelectedProjectId(null);
      } else if (dv === 'unassigned') {
        setSelectedSpecialList('unassigned');
        setSelectedProjectId(null);
      } else if (dv && dv !== 'home') {
        // It's a project ID
        const projectExists = projects.some(p => p.id === dv);
        if (projectExists) {
          setSelectedProjectId(dv);
          setSelectedSpecialList(null);
        } else {
          setSelectedSpecialList('today');
          setSelectedProjectId(null);
        }
      }

      // On mobile, signal the child component to call setOpenMobile(true)
      if (isMobile) {
        setOpenSidebarRequested(true);
      }

      // Strip the param from the URL
      urlParams.delete('openSidebar');
      const cleanSearch = urlParams.toString();
      navigate(cleanSearch ? `/app?${cleanSearch}` : '/app', { replace: true });
    }
  }, [location.search, preferencesLoaded, preferences, isMobile, navigate, projects]);

  // Reset reorder mode when switching projects/views
  useEffect(() => {
    setIsReorderMode(false);
  }, [selectedProjectId, selectedSpecialList]);

  // Fallback auto-eject: shared project with no visible active tasks should return to Today's To-Do
  useEffect(() => {
    if (!selectedProjectId || !initialLoadComplete || !fullDataLoaded) return;

    const currentProject = projects.find(p => p.id === selectedProjectId);
    if (!currentProject?.isShared) return;

    const hasVisibleActiveTasks = allTasks.some(
      t => t.projectId === selectedProjectId && t.status !== 'completed' && !t.changeRequestMessage
    );

    if (!hasVisibleActiveTasks) {
      setSelectedSpecialList('today');
      setSelectedProjectId(null);
      setProjectRefreshTrigger(prev => prev + 1);
    }
  }, [selectedProjectId, projects, allTasks, initialLoadComplete, fullDataLoaded]);

  // Auto-show onboarding tour for new users
  useEffect(() => {
    if (preferences && !preferences.has_completed_onboarding && initialLoadComplete) {
      // Small delay to let the UI settle
      const timer = setTimeout(() => setShowTour(true), 500);
      return () => clearTimeout(timer);
    }
  }, [preferences, initialLoadComplete]);

  const handleTourComplete = () => {
    setShowTour(false);
    markOnboardingComplete();
  };

  const handleOpenSidebarHandled = useCallback(() => setOpenSidebarRequested(false), []);

  const handleHelpClick = () => {
    setShowTour(true);
  };

  const handleStartTaskTour = async () => {
    if (!user) return;

    // Calculate dates
    const today = new Date();
    const startDate = addDays(today, 7);
    const endDate = addDays(today, 14);
    const dueDate = addDays(today, 14);

    // Create the sample task
    const sampleTask: Task = {
      id: crypto.randomUUID(),
      title: 'Plan Holidays',
      description: `Choose destination, Find accommodation and book a flight

https://www.booking.com
https://www.skyscanner.com`,
      priority: 'high',
      status: 'todo',
      startDate,
      endDate,
      dueDate,
      images: [],
      timer: {
        totalSeconds: 0,
        isRunning: false
      },
      projectId: undefined // Unassigned
    };

    // Insert into database
    const { data, error } = await (supabase as any).from('focusos_tasks').insert({
      user_id: user.id,
      project_id: null,
      title: sampleTask.title,
      description: sampleTask.description,
      priority: sampleTask.priority,
      status: sampleTask.status,
      start_date: sampleTask.startDate?.toISOString(),
      end_date: sampleTask.endDate?.toISOString(),
      due_date: sampleTask.dueDate?.toISOString(),
      images: [],
      timer_total_seconds: 0,
      timer_is_running: false
    }).select().single();

    if (error) {
      toast.error('Failed to create sample task for tour');
      return;
    }

    // Update task with actual ID from database
    const createdTask: Task = {
      ...sampleTask,
      id: data.id
    };

    setTaskTourTask(createdTask);
    
    // Switch to Unassigned view
    setSelectedProjectId(null);
    setSelectedSpecialList('unassigned');
    
    // Refresh tasks to show the new task
    await fetchTasks();
    
    // Start the tour - Edit dialog will open when user moves to step 2
    setShowTaskTour(true);
  };

  const handleTaskTourStepChange = (step: number) => {
    // Open Edit Task dialog when moving past Step 1 (Add Task button)
    if (step >= 1 && taskTourTask) {
      setEditingTask(taskTourTask);
    } else if (step === 0) {
      // Close dialog when going back to Step 1
      setEditingTask(null);
    }
  };

  const handleTaskTourComplete = async () => {
    setShowTaskTour(false);
    setEditingTask(null);
    
    // Delete the sample "Plan Holidays" task
    if (taskTourTask) {
      try {
        await (supabase as any).from('focusos_tasks').delete().eq('id', taskTourTask.id);
        setTasks(prev => prev.filter(t => t.id !== taskTourTask.id));
      } catch (error) {
        console.error('Failed to delete tour task:', error);
      }
    }
    
    setTaskTourTask(null);
    
    // Mark task tour as complete in preferences
    await markTaskTourComplete();
    
    // Navigate to Today's To-Do list after tour completes
    setSelectedSpecialList('today');
    setSelectedProjectId(null);
    
    toast.success('Tasks Tour completed!');
  };

  // Projects Tour handlers
  const handleStartProjectsTour = async () => {
    if (!user) return;

    // Create 2 demo projects
    const demoProject1 = {
      name: 'Demo Project 1',
      color: '#3b82f6',
      user_id: user.id
    };
    const demoProject2 = {
      name: 'Demo Project 2',
      color: '#10b981',
      user_id: user.id
    };

    const { data: project1Data, error: project1Error } = await (supabase as any)
      .from('focusos_projects')
      .insert(demoProject1)
      .select()
      .single();

    if (project1Error) {
      toast.error('Failed to create demo project 1');
      return;
    }

    const { data: project2Data, error: project2Error } = await (supabase as any)
      .from('focusos_projects')
      .insert(demoProject2)
      .select()
      .single();

    if (project2Error) {
      toast.error('Failed to create demo project 2');
      // Clean up project 1
      await (supabase as any).from('focusos_projects').delete().eq('id', project1Data.id);
      return;
    }

    // Create a demo task in project 1
    const demoTask = {
      user_id: user.id,
      project_id: project1Data.id,
      title: 'Demo Task - Try moving me!',
      description: 'This is a demo task. Try changing which project it belongs to using the Project dropdown.',
      priority: 'medium',
      status: 'todo',
      due_date: new Date().toISOString()
    };

    const { data: taskData, error: taskError } = await (supabase as any)
      .from('focusos_tasks')
      .insert(demoTask)
      .select()
      .single();

    if (taskError) {
      toast.error('Failed to create demo task');
      // Clean up projects
      await (supabase as any).from('focusos_projects').delete().eq('id', project1Data.id);
      await (supabase as any).from('focusos_projects').delete().eq('id', project2Data.id);
      return;
    }

    // Store tour items for cleanup
    setProjectsTourProjects([
      { id: project1Data.id, name: project1Data.name },
      { id: project2Data.id, name: project2Data.name }
    ]);
    setProjectsTourTask({
      id: taskData.id,
      title: taskData.title,
      description: taskData.description,
      priority: taskData.priority as TaskPriority,
      status: taskData.status as TaskStatus,
      dueDate: new Date(taskData.due_date),
      projectId: taskData.project_id,
      images: [],
      timer: { totalSeconds: 0, isRunning: false }
    });

    // Refresh projects list
    await fetchProjects();
    setProjectRefreshTrigger(prev => prev + 1);
    
    // Start the tour
    setLastProcessedTourStep(null);
    setProjectsTourCurrentStep(0);
    setShowProjectsTour(true);
  };

  const handleProjectsTourStepChange = async (step: number, action?: string) => {
    console.log('[Tour] Step change called:', { step, action, lastProcessedTourStep });
    
    // Always update the current displayed step (for sidebar controller)
    if (!action) {
      setProjectsTourCurrentStep(step);
    }
    
    // If action is provided, this is an action-only call - don't update lastProcessedTourStep
    // Only update lastProcessedTourStep for actual step transitions (no action)
    if (!action) {
      // Prevent duplicate processing of the same step
      if (step === lastProcessedTourStep) {
        console.log('[Tour] Skipping duplicate step:', step);
        return;
      }
      setLastProcessedTourStep(step);
      console.log('[Tour] Processing step:', step);
    } else {
      console.log('[Tour] Processing action:', action);
    }

    // Step 1 (index 1) is the color picker step - open the Create Project dialog
    if (step === 1 && !action) {
      setTourCreateDialogOpen(true);
    } else if (step !== 1 && !action) {
      // Close dialog when not on step 1 (but only on step transitions, not actions)
      setTourCreateDialogOpen(false);
    }

    if (action === 'click-project') {
      console.log('[Tour] click-project action, projectsTourProjects:', projectsTourProjects);
      if (projectsTourProjects.length > 0) {
        // Step 2 action: Select the demo project
        setSelectedProjectId(projectsTourProjects[0].id);
        setSelectedSpecialList(null);
        await fetchTasks();
      } else {
        console.error('[Tour] No demo projects available for click-project action');
      }
    } else if (action === 'show-move-task') {
      // Step 5 action: Open the task edit dialog to show project selector
      console.log('[Tour] Opening edit dialog for task');
      
      // Ensure projects are refreshed first
      await fetchProjects();
      
      // Find the task in current tasks or use stored reference
      const taskToEdit = tasks.find(t => t.id === projectsTourTask?.id) || projectsTourTask;
      if (taskToEdit) {
        console.log('[Tour] Setting editing task:', taskToEdit.id);
        setEditingTask(taskToEdit);
      } else {
        console.error('[Tour] Could not find task to edit');
      }
    }
  };

  const handleProjectsTourComplete = async () => {
    setShowProjectsTour(false);
    setEditingTask(null);
    setTourCreateDialogOpen(false);

    // Delete demo task
    if (projectsTourTask) {
      try {
        await (supabase as any).from('focusos_tasks').delete().eq('id', projectsTourTask.id);
      } catch (error) {
        console.error('Failed to delete demo task:', error);
      }
    }

    // Delete demo projects
    for (const project of projectsTourProjects) {
      try {
        await (supabase as any).from('focusos_projects').delete().eq('id', project.id);
      } catch (error) {
        console.error('Failed to delete demo project:', error);
      }
    }

    // Clear tour state
    setProjectsTourTask(null);
    setProjectsTourProjects([]);
    setLastProcessedTourStep(null);
    setProjectsTourCurrentStep(0);

    // Mark tour as complete
    await markProjectsTourComplete();

    // Refresh UI
    await fetchProjects();
    setProjectRefreshTrigger(prev => prev + 1);
    
    // Navigate to Today's view
    setSelectedSpecialList('today');
    setSelectedProjectId(null);

    toast.success('Projects Tour completed!');
  };

  // Handle Add Task dialog open - trigger tour on first click
  const handleAddTaskDialogOpen = (open: boolean) => {
    if (open && preferences && !preferences.has_completed_task_tour) {
      // First time clicking Add Task - start the task tour instead
      handleStartTaskTour();
    } else {
      setAddTaskDialogOpen(open);
    }
  };

  const handleAddTask = async (newTask: Task) => {
    if (!user) return;
    const { data, error } = await (supabase as any).from('focusos_tasks').insert({
      user_id: user.id,
      project_id: newTask.projectId || null,
      title: newTask.title,
      description: newTask.description,
      priority: newTask.priority,
      status: newTask.status,
      start_date: newTask.startDate?.toISOString(),
      end_date: newTask.endDate?.toISOString(),
      due_date: newTask.dueDate?.toISOString(),
      images: newTask.images || [],
      timer_total_seconds: 0,
      timer_is_running: false
    }).select().single();
    if (error) {
      toast.error('Failed to create task');
      return;
    }
    // Optimistic insert as a safety net in case realtime is briefly disconnected.
    // The realtime INSERT handler dedupes by id, so no duplicate row will appear.
    if (data) {
      const inserted = transformDbTask(data);
      setTasks(prev => prev.some(t => t.id === inserted.id) ? prev : [...prev, inserted]);
      setAllTasks(prev => prev.length === 0 || prev.some(t => t.id === inserted.id) ? prev : [...prev, inserted]);
    }
    // Toast is fired by AddTaskDialog; do not duplicate it here.
  };
  const handleUpdateTask = async (updatedTask: Task) => {
    // Collaborative project completion gating:
    // If a collaborator (non-owner) tries to mark a task as 'completed' in a shared project,
    // instead set completedByEmail so the owner can acknowledge via "Move to Done"
    const taskProject = projects.find(p => p.id === updatedTask.projectId);
    const originalTask = tasks.find(t => t.id === updatedTask.id);
    const isCollaboratorCompletion = taskProject?.isShared 
      && taskProject?.userId !== user?.id 
      && updatedTask.status === 'completed' 
      && originalTask?.status !== 'completed';
    
    if (isCollaboratorCompletion) {
      // Collaborator marks complete → set completedByEmail but revert status to previous
      updatedTask = {
        ...updatedTask,
        status: originalTask?.status || 'todo',
        completedByEmail: user?.email || 'unknown',
      };
    }

    // If the task's project changed, recalculate sort_order so it lands at the
    // TOP of its priority group in the destination project (list is sorted asc).
    const originalForMove = originalTask ?? allTasks.find(t => t.id === updatedTask.id);
    const projectChanged = !!updatedTask.projectId
      && updatedTask.projectId !== originalForMove?.projectId;
    let nextSortOrder = updatedTask.sortOrder ?? 0;
    if (projectChanged) {
      const { data: topRow } = await (supabase as any)
        .from('focusos_tasks')
        .select('sort_order')
        .eq('project_id', updatedTask.projectId)
        .eq('priority', updatedTask.priority)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      nextSortOrder = ((topRow?.sort_order ?? 0) as number) - 1;
      updatedTask = { ...updatedTask, sortOrder: nextSortOrder };
    }

    // Optimistic update: Update local state immediately to prevent list jumping
    setTasks(prevTasks => prevTasks.map(task => task.id === updatedTask.id ? updatedTask : task));
    setAllTasks(prevTasks => prevTasks.map(task => task.id === updatedTask.id ? updatedTask : task));

    // Update database in background
    const {
      error
    } = await (supabase as any).from('focusos_tasks').update({
      title: updatedTask.title,
      description: updatedTask.description,
      priority: updatedTask.priority,
      status: updatedTask.status,
      start_date: updatedTask.startDate?.toISOString(),
      end_date: updatedTask.endDate?.toISOString(),
      due_date: updatedTask.dueDate?.toISOString(),
      images: updatedTask.images || [],
      timer_total_seconds: updatedTask.timer.totalSeconds,
      timer_is_running: updatedTask.timer.isRunning,
      timer_start_time: updatedTask.timer.startTime,
      project_id: updatedTask.projectId || null,
      sort_order: nextSortOrder,
      completed_by_email: updatedTask.completedByEmail || null,
    }).eq('id', updatedTask.id);
    if (error) {
      toast.error('Failed to update task');
      fetchTasks();
      return;
    }

    // Bidirectional completion sync for shared tasks
    if (updatedTask.status === 'completed') {
      try {
        // Check if this task is a shared original (sender's task) — sync to recipient's clone
        const { data: asOriginal } = await (supabase as any)
          .from('focusos_shared_items')
          .select('recipient_task_id')
          .eq('item_id', updatedTask.id)
          .eq('item_type', 'task')
          .eq('status', 'accepted')
          .not('recipient_task_id', 'is', null);

        if (asOriginal && asOriginal.length > 0) {
          for (const si of asOriginal) {
            // Use edge function to update recipient's task (bypasses RLS)
            await supabase.functions.invoke('focusos-complete-shared-task', {
              body: {},
            }).catch(() => {});
            // Actually we need a different approach - use the share_token URL
          }
        }

        // Check if this task is a recipient's clone — sync back to sender's original
        const { data: asClone } = await (supabase as any)
          .from('focusos_shared_items')
          .select('item_id, sender_email')
          .eq('recipient_task_id', updatedTask.id)
          .eq('item_type', 'task')
          .eq('status', 'accepted');

        // For cross-user updates we need a service-role function
        // Let's invoke the sync via edge function
        if ((asOriginal && asOriginal.length > 0) || (asClone && asClone.length > 0)) {
          await supabase.functions.invoke('focusos-sync-task-completion', {
            body: {
              taskId: updatedTask.id,
              completedByEmail: user?.email || 'unknown',
            },
          }).catch((err) => console.error('Sync completion error:', err));
        }
      } catch (err) {
        console.error('Completion sync lookup error:', err);
      }

      // Auto-redirect: if the last task in a shared project was just completed, go to Today's To-Do
      if (selectedProjectId && updatedTask.projectId === selectedProjectId) {
        const currentProject = projects.find(p => p.id === selectedProjectId);
        if (currentProject?.isShared) {
          const remainingActive = allTasks.filter(
            t => t.projectId === selectedProjectId && t.id !== updatedTask.id && t.status !== 'completed' && !t.changeRequestMessage
          );
          if (remainingActive.length === 0) {
            setSelectedSpecialList('today');
            setSelectedProjectId(null);
            setProjectRefreshTrigger(prev => prev + 1);
          }
        }
      }
    }
  };

  // Batch update for drag-and-drop reordering
  const handleBatchUpdateTasks = async (updatedTasks: Task[]) => {
    // Optimistic update
    setTasks(prevTasks => {
      const updateMap = new Map(updatedTasks.map(t => [t.id, t]));
      return prevTasks.map(task => updateMap.get(task.id) || task);
    });
    setAllTasks(prevTasks => {
      const updateMap = new Map(updatedTasks.map(t => [t.id, t]));
      return prevTasks.map(task => updateMap.get(task.id) || task);
    });

    // Batch DB updates in parallel
    const results = await Promise.all(
      updatedTasks.map(t =>
        (supabase as any).from('focusos_tasks').update({
          priority: t.priority,
          sort_order: t.sortOrder ?? 0,
        }).eq('id', t.id)
      )
    );

    if (results.some(r => r.error)) {
      toast.error('Failed to reorder tasks');
      fetchTasks();
    }
  };
  const handleTaskClick = (taskId: string) => {
    setExpandedTaskIds(prev => {
      if (prev.has(taskId) && prev.size === 1) {
        return new Set();
      }
      return new Set([taskId]);
    });
  };

  const handleAssignTask = (task: Task) => {
    setTaskToShare(task);
    setShareDialogOpen(true);
  };

  const handleRequestChanges = (task: Task) => {
    setChangesNeededTask(task);
    setChangesNeededMessage('');
    setChangesNeededDialogOpen(true);
  };

  const handleSubmitChangesNeeded = async () => {
    if (!changesNeededTask || !changesNeededMessage.trim()) return;
    setChangesNeededLoading(true);
    try {
      const { error } = await supabase.functions.invoke('focusos-request-changes', {
        body: {
          taskId: changesNeededTask.id,
          message: changesNeededMessage.trim(),
          recipientEmail: changesNeededTask.completedByEmail || undefined,
        },
      });
      if (error) throw error;

      // Optimistic: clear completedByEmail on sender's task and revert shared recipient status
      const recipientEmail = changesNeededTask.completedByEmail;
      const cleared = { ...changesNeededTask, completedByEmail: undefined, changeRequestMessage: undefined };
      setTasks(prev => prev.map(t => t.id === cleared.id ? cleared : t));
      setAllTasks(prev => prev.map(t => t.id === cleared.id ? cleared : t));
      
      // Optimistic: revert the specific recipient's status in senderSharedMap
      if (recipientEmail) {
        setSenderSharedMap(prev => {
          const recipients = prev[changesNeededTask.id];
          if (!recipients) return prev;
          return {
            ...prev,
            [changesNeededTask.id]: recipients.map(r =>
              r.email === recipientEmail ? { ...r, status: 'accepted' } : r
            ),
          };
        });
      }

      toast.success('Changes requested — the recipient has been notified.');
      setChangesNeededDialogOpen(false);
      setChangesNeededTask(null);
      setChangesNeededMessage('');
    } catch (err: any) {
      console.error('Request changes error:', err);
      toast.error('Failed to request changes');
    } finally {
      setChangesNeededLoading(false);
    }
  };

  const handleDismissChangeRequest = async (task: Task) => {
    // Clear the change_request_message on the recipient's task
    const { error } = await (supabase as any).from('focusos_tasks').update({
      change_request_message: null,
    }).eq('id', task.id);
    if (error) {
      toast.error('Failed to dismiss');
      return;
    }
    const updated = { ...task, changeRequestMessage: undefined };
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setAllTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const handleDeleteTask = async (task: Task) => {
    // Recipients cannot delete (they received a shared task clone)
    if (task.assignedToEmail) {
      toast.error("You can't delete a task that was shared with you");
      return;
    }
    // Collaborators on shared projects cannot delete — only the project owner can
    const taskProject = projects.find(p => p.id === task.projectId);
    if (taskProject?.isShared && taskProject?.userId !== user?.id) {
      toast.error('Only the project owner can delete tasks in a collaborative project');
      return;
    }

    // Optimistic removal
    const prevTasks = tasks;
    const prevAllTasks = allTasks;
    setTasks(prev => prev.filter(t => t.id !== task.id));
    setAllTasks(prev => prev.filter(t => t.id !== task.id));

    try {
      // If this task was shared with recipients, delete recipient clones + shared_items rows first
      const { data: sharedRows } = await (supabase as any)
        .from('focusos_shared_items')
        .select('id, recipient_task_id')
        .eq('item_id', task.id)
        .eq('item_type', 'task');

      if (sharedRows && sharedRows.length > 0) {
        const recipientTaskIds = sharedRows
          .map((r: any) => r.recipient_task_id)
          .filter(Boolean);
        if (recipientTaskIds.length > 0) {
          await (supabase as any)
            .from('focusos_tasks')
            .delete()
            .in('id', recipientTaskIds);
        }
        const sharedIds = sharedRows.map((r: any) => r.id);
        // Attempt shared_items cleanup (RLS may not allow DELETE — nulling recipient_task_id is a safe fallback)
        await (supabase as any)
          .from('focusos_shared_items')
          .update({ recipient_task_id: null, status: 'declined' })
          .in('id', sharedIds);
      }

      const { error } = await (supabase as any)
        .from('focusos_tasks')
        .delete()
        .eq('id', task.id);

      if (error) throw error;
      toast.success('Task deleted');
    } catch (err: any) {
      console.error('Delete task error:', err);
      // Roll back optimistic removal
      setTasks(prevTasks);
      setAllTasks(prevAllTasks);
      toast.error('Failed to delete task');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleStartEditingProject = () => {
    const currentProject = projects.find(p => p.id === selectedProjectId);
    if (currentProject) {
      setEditedProjectName(currentProject.name);
      setIsEditingProjectName(true);
    }
  };

  const handleSaveProjectName = async () => {
    if (!selectedProjectId || !editedProjectName.trim()) {
      setIsEditingProjectName(false);
      return;
    }

    try {
      const { error } = await (supabase as any)
        .from('focusos_projects')
        .update({ name: editedProjectName.trim() })
        .eq('id', selectedProjectId);

      if (error) throw error;

    // Update local state
    setProjects(projects.map(p => 
      p.id === selectedProjectId ? { ...p, name: editedProjectName.trim() } : p
    ));
    
    // Trigger sidebar refresh
    setProjectRefreshTrigger(prev => prev + 1);
    
    setIsEditingProjectName(false);
    toast.success('Project name updated');
    } catch (error) {
      console.error('Error updating project name:', error);
      toast.error('Failed to update project name');
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;

    try {
      // Delete all tasks in the project first
      const { error: tasksError } = await (supabase as any)
        .from('focusos_tasks')
        .delete()
        .eq('project_id', selectedProjectId);

      if (tasksError) throw tasksError;

      // Delete the project
      const { error: projectError } = await (supabase as any)
        .from('focusos_projects')
        .delete()
        .eq('id', selectedProjectId);

      if (projectError) throw projectError;

      // Update local state
      setProjects(projects.filter(p => p.id !== selectedProjectId));
      setTasks(tasks.filter(t => t.projectId !== selectedProjectId));
      
      // Reset selection to "Today" view
      setSelectedProjectId(null);
      setSelectedSpecialList('today');
      
      // Trigger sidebar refresh
      setProjectRefreshTrigger(prev => prev + 1);
      
      toast.success('Project and all its tasks deleted');
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error('Failed to delete project');
    }
  };

  const getSelectedProjectName = (): string => {
    if (selectedSpecialList === 'today') return "Today's To-Do";
    if (selectedSpecialList === 'past-due') return "Past Due";
    if (selectedSpecialList === 'unassigned') return "Unassigned";
    if (selectedProjectId) {
      const project = projects.find(p => p.id === selectedProjectId);
      return project?.name || 'Unknown Project';
    }
    return '';
  };
  // Fuse.js instance for fuzzy search across all tasks
  const fuse = useMemo(() => new Fuse(allTasks.length > 0 ? allTasks : tasks, {
    keys: ['title', 'description'],
    threshold: 0.4, // 0 = exact, 1 = match anything
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [allTasks, tasks]);

  const filteredTasks = useMemo(() => {
    // If searching, fuzzy search across ALL tasks (ignore project filter)
    if (searchQuery.trim().length > 0) {
      const results = fuse.search(searchQuery.trim());
      return results.map(r => r.item);
    }

    // No search — filter by selected project or special list
    return tasks.filter(task => {
      // Hide tasks with pending change requests in shared projects (they need to be re-accepted first)
      if (task.changeRequestMessage) return false;
      
      if (selectedProjectId) {
        return task.projectId === selectedProjectId;
      } else if (selectedSpecialList === 'unassigned') {
        return !task.projectId;
      } else if (selectedSpecialList === 'today') {
        if (!task.dueDate) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const taskDueDate = new Date(task.dueDate);
        taskDueDate.setHours(0, 0, 0, 0);
        return taskDueDate.getTime() === today.getTime();
      } else if (selectedSpecialList === 'past-due') {
        if (!task.dueDate) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const taskDueDate = new Date(task.dueDate);
        taskDueDate.setHours(0, 0, 0, 0);
        return taskDueDate.getTime() < today.getTime();
      }
      return true;
    });
  }, [searchQuery, fuse, tasks, selectedProjectId, selectedSpecialList]);

  // Priority order for sorting
  const priorityOrder = {
    'urgent': 1,
    'high': 2,
    'medium': 3,
    'low': 4
  };

  // Sort tasks by priority, then by sort_order within priority
  const sortTasksByPriority = (tasksToSort: Task[]) => {
    return [...tasksToSort].sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  };

  const sortedTasks = sortTasksByPriority(filteredTasks).map(t => ({
    ...t,
    sharedWithName: senderSharedMap[t.id]?.[0]?.name || undefined,
    sharedRecipients: senderSharedMap[t.id] || undefined,
  }));



  
  // Show loading screen while auth is resolving
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }
  
  // Auth resolved but no user — show spinner while useEffect redirects
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  // User exists but preferences still loading — keep full-screen spinner until
  // preferences resolve (default_view drives initial view selection). Once
  // preferences exist, render the shell immediately and skeleton the task area
  // while initialLoadComplete is still false.
  if (prefsLoading || !preferences) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading your tasks...</p>
        </div>
      </div>
    );
  }

  return <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <MobileSidebarController tourStep={lastProcessedTourStep} isTourActive={showProjectsTour} currentTourStep={projectsTourCurrentStep} openSidebarRequested={openSidebarRequested} onOpenSidebarHandled={handleOpenSidebarHandled} />
      <div className="min-h-screen flex w-full relative">
        {!isCream && <div ref={containerRef} className="dock-particle-container" />}
        {!isCream && <LightRays raysOrigin="top-center" raysColor="#2b12e2" raysSpeed={0.8} lightSpread={1.2} rayLength={2.5} pulsating={false} fadeDistance={1.2} saturation={1.0} followMouse={true} mouseInfluence={0.15} noiseAmount={0.05} distortion={0.1} />}
        {!isCream && <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />}

        <div className="flex flex-1 relative w-full flex-col">
          <div className="flex flex-1 relative">
            {/* Sidebar */}
            <ProjectSidebar selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onSelectSpecialList={setSelectedSpecialList} selectedSpecialList={selectedSpecialList} projectRefreshTrigger={projectRefreshTrigger} onProjectCreated={() => { setProjectRefreshTrigger(prev => prev + 1); fetchTasks(); }} onStartTour={handleHelpClick} onStartTaskTour={handleStartTaskTour} onStartProjectsTour={handleStartProjectsTour} createDialogOpen={showProjectsTour ? tourCreateDialogOpen : undefined} onCreateDialogOpenChange={showProjectsTour ? setTourCreateDialogOpen : undefined} isTourActive={showProjectsTour} userId={user?.id} senderProjectSharedMap={senderProjectSharedMap} />

            {/* Main Content */}
            <div className="flex-1 relative z-10 overflow-x-hidden overflow-y-auto">
              <div
                className="container mx-auto py-4 sm:py-6 lg:py-8 px-2 sm:px-4"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 128px)' }}
              >

          {/* Actions Bar */}
          <div className="flex flex-row gap-2 sm:gap-3 items-center mb-4 sm:mb-6">
            <SidebarTrigger className="relative z-10 min-h-[44px] min-w-[44px] hidden md:flex shrink-0" />
            <div className="relative flex-[2] md:flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hidden lg:block" />
              <Input placeholder="Search" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="pl-3 sm:pl-9 bg-card/80 backdrop-blur-sm border-2 h-10 lg:hidden" />
              <Input placeholder="Search tasks..." value={searchInput} onChange={e => setSearchInput(e.target.value)} className="pl-3 sm:pl-9 bg-card/80 backdrop-blur-sm border-2 h-10 hidden lg:block" />
            </div>
            <div className="flex gap-2">
              {/* Mobile/Tablet: Display Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-1 border-2 h-10 px-3 flex lg:hidden">
                <span className="text-sm">Display</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setViewMode('list')}>
                    <LayoutList className="h-4 w-4 mr-2" />
                    List
                    {viewMode === 'list' && <Check className="h-4 w-4 ml-auto" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode('grid')}>
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Grid
                    {viewMode === 'grid' && <Check className="h-4 w-4 ml-auto" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode('gantt')}>
                    <GanttChartSquare className="h-4 w-4 mr-2" />
                    Gantt
                    {viewMode === 'gantt' && <Check className="h-4 w-4 ml-auto" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode('time-tracking')}>
                    <Clock className="h-4 w-4 mr-2" />
                    Time Tracking
                    {viewMode === 'time-tracking' && <Check className="h-4 w-4 ml-auto" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Desktop: Individual Buttons */}
              <div className="hidden lg:flex gap-2">
                <Button variant={viewMode === 'list' ? 'default' : 'outline'} onClick={() => setViewMode('list')} className="gap-2 border-2">
                  <LayoutList className="h-4 w-4" />
                  <span>List</span>
                </Button>
                <Button variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')} className="gap-2 border-2">
                  <LayoutGrid className="h-4 w-4" />
                  <span>Grid</span>
                </Button>
                <Button variant={viewMode === 'gantt' ? 'default' : 'outline'} onClick={() => setViewMode('gantt')} className="gap-2 border-2">
                  <GanttChartSquare className="h-4 w-4" />
                  <span>Gantt</span>
                </Button>
                <Button variant={viewMode === 'time-tracking' ? 'default' : 'outline'} onClick={() => setViewMode('time-tracking')} className="gap-2 border-2">
                  <Clock className="h-4 w-4" />
                  <span>Time</span>
                </Button>
              </div>

              {viewMode === 'list' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="outline"
                      aria-label={`View: ${globalCardView}`}
                      className="gap-2 border-2 h-10 px-2 lg:px-3"
                    >
                      <Eye className="h-4 w-4" />
                      <span className="hidden lg:inline">
                        {globalCardView === 'full' ? 'Full' : globalCardView === 'compact' ? 'Compact' : 'Minimal'}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => { setGlobalCardView('full'); setExpandedTaskIds(new Set()); }}>
                      <Check className={`h-4 w-4 mr-2 ${globalCardView === 'full' ? 'opacity-100' : 'opacity-0'}`} />
                      Full
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setGlobalCardView('compact'); setExpandedTaskIds(new Set()); }}>
                      <Check className={`h-4 w-4 mr-2 ${globalCardView === 'compact' ? 'opacity-100' : 'opacity-0'}`} />
                      Compact
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setGlobalCardView('minimal'); setExpandedTaskIds(new Set()); }}>
                      <Check className={`h-4 w-4 mr-2 ${globalCardView === 'minimal' ? 'opacity-100' : 'opacity-0'}`} />
                      Minimal
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                aria-label="Add task"
                className="gap-2 border-2 shadow-lg shadow-primary/20 px-2 lg:px-3"
                data-task-tour-step="add-task-button"
                onClick={() => handleAddTaskDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden lg:inline">Add Task</span>
              </Button>
            </div>
          </div>

          {/* Main Content */}
          {!initialLoadComplete ? <TaskListSkeleton /> : viewMode === 'list' ? <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
              <TabsList className="w-full hidden lg:grid grid-cols-4 h-auto">
                <TabsTrigger value="all" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">All </span>({sortedTasks.filter(t => t.status !== 'completed').length})
                </TabsTrigger>
                <TabsTrigger value="todo" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">To Do </span>({sortedTasks.filter(t => t.status === 'todo').length})
                </TabsTrigger>
                <TabsTrigger value="in-progress" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Progress </span>({sortedTasks.filter(t => t.status === 'in-progress').length})
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Done </span>({sortedTasks.filter(t => t.status === 'completed').length})
                </TabsTrigger>
              </TabsList>

              {selectedProjectId && projects.find(p => p.id === selectedProjectId) && (() => {
                const currentProject = projects.find(p => p.id === selectedProjectId);
                const isCollaborator = (currentProject?.isShared && currentProject?.userId !== user?.id) ?? false;
                const isSharedProject = currentProject?.isShared ?? false;
                const assignedByEmail = isCollaborator ? tasks.find(t => t.projectId === selectedProjectId)?.assignedToEmail : null;
                return <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center justify-between gap-1 sm:gap-2 px-2 sm:px-3 py-2">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-1 flex-wrap">
                      <span className="hidden sm:inline" style={{ color: currentProject?.color }}>📁</span>
                      
                      {isEditingProjectName && !isCollaborator ? (
                        <Input
                          autoFocus
                          value={editedProjectName}
                          onChange={(e) => setEditedProjectName(e.target.value)}
                          onBlur={handleSaveProjectName}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveProjectName();
                            if (e.key === 'Escape') setIsEditingProjectName(false);
                          }}
                          className="font-semibold text-base h-auto py-1 px-2"
                          style={{ color: currentProject?.color }}
                        />
                      ) : (
                        <span 
                          className={`font-semibold text-base ${!isCollaborator ? 'cursor-pointer hover:opacity-70' : ''} transition-opacity`}
                          style={{ color: currentProject?.color }}
                          onClick={!isCollaborator ? handleStartEditingProject : undefined}
                          data-projects-tour-step="project-name"
                        >
                          {currentProject?.name}
                        </span>
                      )}
                      {isCollaborator && assignedByEmail && (
                        <Badge variant="outline" className="bg-purple-600/15 text-purple-400 border-purple-600/30 text-xs inline-flex items-center gap-1 w-fit">
                          <Share2 className="h-3 w-3 shrink-0" />
                          <span className="break-words">Shared by {assignerNameMap[assignedByEmail] || assignedByEmail}</span>
                        </Badge>
                      )}
                      {!isCollaborator && selectedProjectId && senderProjectSharedMap[selectedProjectId] && (
                        <ShareStatusPopover recipients={senderProjectSharedMap[selectedProjectId]} itemType="Project" />
                      )}
                      {!isCollaborator && selectedProjectId && (
                        <ProjectMembersBar
                          projectId={selectedProjectId}
                          isOwner={!isCollaborator}
                          onInviteClick={() => setInviteDialogOpen(true)}
                          refreshTrigger={memberRefreshTrigger}
                        />
                      )}
                    </div>

                    {/* Status Dropdown for Mobile/Tablet */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="gap-1 border-2 h-9 px-2 sm:px-3 flex lg:hidden">
                          <span className="text-sm hidden sm:inline">Status</span>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setActiveTab('all')}>
                          All ({sortedTasks.filter(t => t.status !== 'completed').length})
                          {activeTab === 'all' && <Check className="h-4 w-4 ml-auto" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setActiveTab('todo')}>
                          To Do ({sortedTasks.filter(t => t.status === 'todo').length})
                          {activeTab === 'todo' && <Check className="h-4 w-4 ml-auto" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setActiveTab('in-progress')}>
                          Progress ({sortedTasks.filter(t => t.status === 'in-progress').length})
                          {activeTab === 'in-progress' && <Check className="h-4 w-4 ml-auto" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setActiveTab('completed')}>
                          Done ({sortedTasks.filter(t => t.status === 'completed').length})
                          {activeTab === 'completed' && <Check className="h-4 w-4 ml-auto" />}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    
                    {!isCollaborator && (
                      <>
                        <Button 
                          variant={isReorderMode ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => setIsReorderMode(!isReorderMode)}
                          className="gap-1 px-1.5 sm:px-3"
                        >
                          <ArrowUpDown className="h-4 w-4" />
                          <span className="hidden lg:inline">{isReorderMode ? 'Done Moving' : 'Move Tasks'}</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-1.5 sm:px-3"
                          onClick={() => navigate(`/meetings?project=${selectedProjectId}`)}
                        >
                          <Mic className="h-4 w-4" />
                          <span className="hidden lg:inline">Meetings</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 px-1.5 sm:px-3 text-primary hover:text-primary/80 hover:bg-primary/10"
                          onClick={() => setShareProjectDialogOpen(true)}
                        >
                          <Share2 className="h-4 w-4" />
                          <span className="hidden lg:inline">Share</span>
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              data-projects-tour-step="delete-button"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="hidden lg:inline ml-1">Delete</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                              <AlertDialogDescription>
                                By selecting Yes, you understand that the project and all the tasks within the Project will be deleted permanently. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={handleDeleteProject}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Yes, Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>;
              })()}

              {/* Today's To-Do Banner */}
              {selectedSpecialList === 'today' && (
                <div className="mt-4 w-full bg-muted p-1 rounded-md border">
                  <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <Calendar className="h-5 w-5 text-primary" />
                      <span className="font-semibold text-base text-primary">
                        Today
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant={isReorderMode ? "default" : "outline"}
                        size="sm"
                        onClick={() => setIsReorderMode(!isReorderMode)}
                        className="gap-1"
                      >
                        <ArrowUpDown className="h-4 w-4" />
                        <span className="hidden lg:inline">{isReorderMode ? 'Done Moving' : 'Move Tasks'}</span>
                        <span className="lg:hidden">{isReorderMode ? 'Done' : 'Move'}</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-primary hover:text-primary/80 hover:bg-primary/10"
                        onClick={() => setShareProjectDialogOpen(true)}
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>

                      {/* Status Dropdown for Mobile/Tablet */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="gap-1 border-2 h-9 px-3 flex lg:hidden">
                            <span className="text-sm">Status</span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setActiveTab('all')}>
                            All ({sortedTasks.filter(t => t.status !== 'completed').length})
                            {activeTab === 'all' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('todo')}>
                            To Do ({sortedTasks.filter(t => t.status === 'todo').length})
                            {activeTab === 'todo' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('in-progress')}>
                            Progress ({sortedTasks.filter(t => t.status === 'in-progress').length})
                            {activeTab === 'in-progress' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('completed')}>
                            Done ({sortedTasks.filter(t => t.status === 'completed').length})
                            {activeTab === 'completed' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )}

              {/* Past Due Banner */}
              {selectedSpecialList === 'past-due' && (
                <div className="mt-4 w-full bg-orange-400/5 p-1 rounded-md border border-orange-400/20">
                  <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <AlertTriangle className="h-5 w-5 text-orange-400/80" />
                      <span className="font-semibold text-base text-orange-400/80">
                        Past Due
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant={isReorderMode ? "default" : "outline"}
                        size="sm"
                        onClick={() => setIsReorderMode(!isReorderMode)}
                        className="gap-1"
                      >
                        <ArrowUpDown className="h-4 w-4" />
                        <span className="hidden lg:inline">{isReorderMode ? 'Done Moving' : 'Move Tasks'}</span>
                        <span className="lg:hidden">{isReorderMode ? 'Done' : 'Move'}</span>
                      </Button>

                      {/* Status Dropdown for Mobile/Tablet */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="gap-1 border-2 h-9 px-3 flex lg:hidden">
                            <span className="text-sm">Status</span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setActiveTab('all')}>
                            All ({sortedTasks.filter(t => t.status !== 'completed').length})
                            {activeTab === 'all' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('todo')}>
                            To Do ({sortedTasks.filter(t => t.status === 'todo').length})
                            {activeTab === 'todo' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('in-progress')}>
                            Progress ({sortedTasks.filter(t => t.status === 'in-progress').length})
                            {activeTab === 'in-progress' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('completed')}>
                            Done ({sortedTasks.filter(t => t.status === 'completed').length})
                            {activeTab === 'completed' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )}

              {selectedSpecialList === 'unassigned' && (
                <div className="mt-4 w-full bg-muted p-1 rounded-md border">
                  <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <ListChecks className="h-5 w-5 text-muted-foreground" />
                      <span className="font-semibold text-base text-muted-foreground">
                        Unassigned Tasks
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant={isReorderMode ? "default" : "outline"}
                        size="sm"
                        onClick={() => setIsReorderMode(!isReorderMode)}
                        className="gap-1"
                      >
                        <ArrowUpDown className="h-4 w-4" />
                        <span className="hidden lg:inline">{isReorderMode ? 'Done Moving' : 'Move Tasks'}</span>
                        <span className="lg:hidden">{isReorderMode ? 'Done' : 'Move'}</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-primary hover:text-primary/80 hover:bg-primary/10"
                        onClick={() => setShareProjectDialogOpen(true)}
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>

                      {/* Status Dropdown for Mobile/Tablet */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="gap-1 border-2 h-9 px-3 flex lg:hidden">
                            <span className="text-sm">Status</span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setActiveTab('all')}>
                            All ({sortedTasks.filter(t => t.status !== 'completed').length})
                            {activeTab === 'all' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('todo')}>
                            To Do ({sortedTasks.filter(t => t.status === 'todo').length})
                            {activeTab === 'todo' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('in-progress')}>
                            Progress ({sortedTasks.filter(t => t.status === 'in-progress').length})
                            {activeTab === 'in-progress' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActiveTab('completed')}>
                            Done ({sortedTasks.filter(t => t.status === 'completed').length})
                            {activeTab === 'completed' && <Check className="h-4 w-4 ml-auto" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )}

              <TabsContent value="all" className="mt-6">
                <DraggableTaskList
                  tasks={sortedTasks.filter(t => t.status !== 'completed')}
                  onUpdate={handleUpdateTask}
                  onBatchUpdate={handleBatchUpdateTasks}
                  onEditTask={setEditingTask}
                  onAssignTask={handleAssignTask}
                  onRequestChanges={handleRequestChanges}
                  onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask}
                  globalViewMode={globalCardView}
                  expandedTaskIds={expandedTaskIds}
                  onTaskClick={handleTaskClick}
                  projects={projects}
                  isReorderMode={isReorderMode}
                />
              </TabsContent>

              <TabsContent value="todo" className="mt-6">
                <DraggableTaskList
                  tasks={sortedTasks.filter(t => t.status === 'todo')}
                  onUpdate={handleUpdateTask}
                  onBatchUpdate={handleBatchUpdateTasks}
                  onEditTask={setEditingTask}
                  onAssignTask={handleAssignTask}
                  onRequestChanges={handleRequestChanges}
                  onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask}
                  globalViewMode={globalCardView}
                  expandedTaskIds={expandedTaskIds}
                  onTaskClick={handleTaskClick}
                  projects={projects}
                  isReorderMode={isReorderMode}
                />
              </TabsContent>

              <TabsContent value="in-progress" className="mt-6">
                <DraggableTaskList
                  tasks={sortedTasks.filter(t => t.status === 'in-progress')}
                  onUpdate={handleUpdateTask}
                  onBatchUpdate={handleBatchUpdateTasks}
                  onEditTask={setEditingTask}
                  onAssignTask={handleAssignTask}
                  onRequestChanges={handleRequestChanges}
                  onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask}
                  globalViewMode={globalCardView}
                  expandedTaskIds={expandedTaskIds}
                  onTaskClick={handleTaskClick}
                  projects={projects}
                  isReorderMode={isReorderMode}
                />
              </TabsContent>

              <TabsContent value="completed" className="mt-6">
                <DraggableTaskList
                  tasks={sortedTasks.filter(t => t.status === 'completed')}
                  onUpdate={handleUpdateTask}
                  onBatchUpdate={handleBatchUpdateTasks}
                  onEditTask={setEditingTask}
                  onAssignTask={handleAssignTask}
                  onRequestChanges={handleRequestChanges}
                  onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask}
                  globalViewMode={globalCardView}
                  expandedTaskIds={expandedTaskIds}
                  onTaskClick={handleTaskClick}
                  projects={projects}
                  isReorderMode={isReorderMode}
                />
              </TabsContent>
            </Tabs> : viewMode === 'grid' ? <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
              <TabsList className="w-full grid grid-cols-4 h-auto">
                <TabsTrigger value="all" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">All </span>({sortedTasks.filter(t => t.status !== 'completed').length})
                </TabsTrigger>
                <TabsTrigger value="todo" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">To Do </span>({sortedTasks.filter(t => t.status === 'todo').length})
                </TabsTrigger>
                <TabsTrigger value="in-progress" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Progress </span>({sortedTasks.filter(t => t.status === 'in-progress').length})
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Done </span>({sortedTasks.filter(t => t.status === 'completed').length})
                </TabsTrigger>
              </TabsList>

              {selectedProjectId && projects.find(p => p.id === selectedProjectId) && (() => {
                const currentProject2 = projects.find(p => p.id === selectedProjectId);
                const isCollaborator2 = (currentProject2?.isShared && currentProject2?.userId !== user?.id) ?? false;
                const isSharedProject2 = currentProject2?.isShared ?? false;
                const assignedByEmail2 = isCollaborator2 ? tasks.find(t => t.projectId === selectedProjectId)?.assignedToEmail : null;
                return <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex flex-col gap-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ color: currentProject2?.color }}>📁</span>
                        
                        {isEditingProjectName && !isCollaborator2 ? (
                          <Input
                            autoFocus
                            value={editedProjectName}
                            onChange={(e) => setEditedProjectName(e.target.value)}
                            onBlur={handleSaveProjectName}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveProjectName();
                              if (e.key === 'Escape') setIsEditingProjectName(false);
                            }}
                            className="font-semibold text-base h-auto py-1 px-2"
                            style={{ color: currentProject2?.color }}
                          />
                        ) : (
                          <span 
                            className={`font-semibold text-base ${!isCollaborator2 ? 'cursor-pointer hover:opacity-70' : ''} transition-opacity`}
                            style={{ color: currentProject2?.color }}
                            onClick={!isCollaborator2 ? handleStartEditingProject : undefined}
                          >
                            {currentProject2?.name}
                          </span>
                        )}
                      </div>
                      {isCollaborator2 && assignedByEmail2 && (
                        <Badge variant="outline" className="bg-purple-600/15 text-purple-400 border-purple-600/30 text-xs inline-flex items-center gap-1 ml-7 mt-1 w-fit">
                          <Share2 className="h-3 w-3 shrink-0" />
                          <span className="break-words">Project shared by {assignerNameMap[assignedByEmail2] || assignedByEmail2}</span>
                        </Badge>
                      )}
                      {!isCollaborator2 && selectedProjectId && senderProjectSharedMap[selectedProjectId] && (
                        <div className="ml-7 mt-1">
                          <ShareStatusPopover recipients={senderProjectSharedMap[selectedProjectId]} itemType="Project" />
                        </div>
                      )}
                    </div>
                    
                    {!isCollaborator2 && (
                      <>
                        <Button 
                          variant={isReorderMode ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => setIsReorderMode(!isReorderMode)}
                          className="gap-1"
                        >
                          <ArrowUpDown className="h-4 w-4" />
                          <span className="hidden lg:inline">{isReorderMode ? 'Done Moving' : 'Move Tasks'}</span>
                          <span className="lg:hidden">{isReorderMode ? 'Done' : 'Move'}</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() => navigate(`/meetings?project=${selectedProjectId}`)}
                        >
                          <Mic className="h-4 w-4" />
                          <span className="hidden lg:inline">Meetings</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-primary hover:text-primary/80 hover:bg-primary/10"
                          onClick={() => setShareProjectDialogOpen(true)}
                        >
                          <Share2 className="h-4 w-4" />
                          <span className="hidden lg:inline">Share</span>
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                              <AlertDialogDescription>
                                By selecting Yes, you understand that the project and all the tasks within the Project will be deleted permanently. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={handleDeleteProject}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Yes, Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>;
              })()}

              <TabsContent value="all" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status !== 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask} projects={projects} />)}
              </TabsContent>

              <TabsContent value="todo" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'todo').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask} projects={projects} />)}
              </TabsContent>

              <TabsContent value="in-progress" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'in-progress').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask} projects={projects} />)}
              </TabsContent>

              <TabsContent value="completed" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} onDeleteTask={handleDeleteTask} projects={projects} />)}
              </TabsContent>
            </Tabs> : viewMode === 'gantt' ? <div className="mt-6">
              <GanttChart 
                tasks={sortedTasks}
                allTasks={sortedTasks}
                projectName={
                  selectedProjectId 
                    ? projects.find(p => p.id === selectedProjectId)?.name || 'Project'
                    : selectedSpecialList === 'today'
                    ? 'Today'
                    : selectedSpecialList === 'unassigned'
                    ? 'Unassigned Tasks'
                    : 'All Tasks'
                }
                projectId={selectedProjectId}
                projects={projects}
                onTaskClick={setEditingTask}
                onAddTask={handleAddTask}
                onOpenAddTask={() => handleAddTaskDialogOpen(true)}
              />
            </div> : <div className="mt-6">
              <TimeTrackingChart tasks={sortedTasks} projects={projects} />
            </div>}
              </div>
            </div>

            {/* Desktop Docked Task Panel (right of main content, no overlay) */}
            {!isMobile && (
              editingTask ? (
                <EditTaskDialog
                  task={editingTask}
                  open={!!editingTask}
                  desktopDocked
                  onOpenChange={(open) => {
                    if (!open && !showTaskTour && !showProjectsTour) {
                      setEditingTask(null);
                    }
                  }}
                  onUpdateTask={async (updatedTask) => {
                    await handleUpdateTask(updatedTask);
                    setEditingTask(null);
                  }}
                  projects={projects}
                  currentUserId={user?.id}
                  onDeleteTask={handleDeleteTask}
                />
              ) : (
                <AddTaskDialog
                  open={addTaskDialogOpen}
                  onOpenChange={handleAddTaskDialogOpen}
                  onAddTask={handleAddTask}
                  selectedProjectId={selectedProjectId}
                  selectedSpecialList={selectedSpecialList}
                  projects={projects}
                  showTrigger={false}
                  desktopDocked
                />
              )
            )}
          </div>
        </div>

        {/* Radial FAB - compact (double-tap to return home) */}
        {!dialogOpen && !settingsOpen && !editingTask && !addTaskDialogOpen && (
          <RecordFAB compact onBrainDump={() => setDialogOpen(true)} />
        )}
      </div>
      
      <BrainDumpLiveDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        userId={user?.id || ''}
        projects={projects.map(p => ({ id: p.id, name: p.name }))}
        onProjectCreated={(newProjectId) => {
          setProjectRefreshTrigger(prev => prev + 1);
          setSelectedProjectId(newProjectId);
          setSelectedSpecialList(null);
        }}
        onTasksCreated={(createdRows) => {
          if (createdRows && createdRows.length) {
            const transformed = createdRows.map(transformDbTask);
            setAllTasks(prev => {
              const seen = new Set(prev.map(t => t.id));
              const merged = [...prev];
              for (const t of transformed) if (!seen.has(t.id)) merged.push(t);
              return merged;
            });
            setTasks(prev => {
              const seen = new Set(prev.map(t => t.id));
              const merged = [...prev];
              for (const t of transformed) if (!seen.has(t.id)) merged.push(t);
              return merged;
            });
          }
          fetchTasks();
          setProjectRefreshTrigger(prev => prev + 1);
        }}
        onRecordingChange={setIsBrainDumpRecording}
      />

      <BottomNavWithSidebar
        projects={projects}
        preferences={preferences}
        prefsLoading={prefsLoading}
        onSavePreferences={updatePreferences}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
      />

      {/* OnboardingTour removed — HomeTour on /home replaces it */}

      {/* Mobile Add Task Dialog */}
      {isMobile && (
        <AddTaskDialog
          open={addTaskDialogOpen}
          onOpenChange={handleAddTaskDialogOpen}
          onAddTask={handleAddTask}
          selectedProjectId={selectedProjectId}
          selectedSpecialList={selectedSpecialList}
          projects={projects}
          showTrigger={false}
        />
      )}

      {/* Mobile Edit Task Dialog */}
      {isMobile && editingTask && (
        <EditTaskDialog
          task={editingTask}
          open={!!editingTask}
          onOpenChange={(open) => {
            if (!open && !showTaskTour && !showProjectsTour) {
              setEditingTask(null);
            }
          }}
          onUpdateTask={async (updatedTask) => {
            await handleUpdateTask(updatedTask);
            setEditingTask(null);
          }}
          projects={projects}
          currentUserId={user?.id}
                  onDeleteTask={handleDeleteTask}
        />
      )}

      <TaskTour isOpen={showTaskTour} onComplete={handleTaskTourComplete} onStepChange={handleTaskTourStepChange} />

      <ProjectTour isOpen={showProjectsTour} onComplete={handleProjectsTourComplete} onStepChange={handleProjectsTourStepChange} />

      <ShareItemDialog
        itemType="task"
        itemId={taskToShare?.id || null}
        itemTitle={taskToShare?.title}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        onShared={() => { fetchTasks(); fetchSenderSharedItems(); }}
      />
      <ShareItemDialog
        itemType="project"
        itemId={selectedProjectId}
        itemTitle={projects.find(p => p.id === selectedProjectId)?.name}
        open={shareProjectDialogOpen}
        onOpenChange={setShareProjectDialogOpen}
      />

      {/* Changes Needed Dialog */}
      <Dialog open={changesNeededDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setChangesNeededDialogOpen(false);
          setChangesNeededTask(null);
          setChangesNeededMessage('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Describe what changes are needed for "{changesNeededTask?.title}". The recipient will be notified and the task will be reassigned to them.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Describe the changes needed..."
            value={changesNeededMessage}
            onChange={(e) => setChangesNeededMessage(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangesNeededDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitChangesNeeded}
              disabled={!changesNeededMessage.trim() || changesNeededLoading}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              {changesNeededLoading ? 'Sending...' : 'Send Changes Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Project Member Dialog */}
      {selectedProjectId && (
        <InviteProjectMemberDialog
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          projectId={selectedProjectId}
          projectName={projects.find(p => p.id === selectedProjectId)?.name || 'Project'}
          onInviteSent={() => setMemberRefreshTrigger(prev => prev + 1)}
        />
      )}
    </SidebarProvider>;
};
export default Index;