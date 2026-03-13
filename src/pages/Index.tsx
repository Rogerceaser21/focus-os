import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Fuse from 'fuse.js';
import PullToRefresh from '@/components/PullToRefresh';
import { useTheme } from 'next-themes';
import { useNavigate } from 'react-router-dom';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Search, LayoutList, LayoutGrid, GanttChartSquare, Clock, LogOut, FolderKanban, ListChecks, Calendar, Settings, Eye, ChevronDown, Check, Trash2, Mic, ArrowUpDown, Share2 } from 'lucide-react';
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
import Dock from '@/components/Dock';
import { useParticleAnimation } from '@/hooks/useParticleAnimation';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import SettingsDialog from '@/components/SettingsDialog';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { OnboardingTour } from '@/components/OnboardingTour';
import { TaskTour } from '@/components/TaskTour';
import { ProjectTour } from '@/components/ProjectTour';
import { EditTaskDialog } from '@/components/EditTaskDialog';
import { DraggableTaskList } from '@/components/DraggableTaskList';
import { ShareItemDialog } from '@/components/ShareItemDialog';
import { addDays } from 'date-fns';

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
          background: 'conic-gradient(from 0deg, hsl(186 80% 55%), hsl(270 80% 60%), hsl(14 90% 65%), hsl(186 80% 55%))'
        }}
      >
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
          <span className="text-2xl font-bold text-primary">P</span>
        </div>
      </button>
    </motion.div>
  );
};

// Mobile sidebar controller for Projects Tour - must be inside SidebarProvider
const MobileSidebarController = ({ tourStep, isTourActive, currentTourStep }: { tourStep: number | null; isTourActive: boolean; currentTourStep: number }) => {
  const { setOpenMobile, isMobile } = useSidebar();
  
  React.useEffect(() => {
    if (!isTourActive || !isMobile) return;
    
    // Use currentTourStep (the actual displayed step) not tourStep (last processed)
    const activeStep = currentTourStep;
    
    console.log('[MobileSidebarController] activeStep:', activeStep);
    
    // Steps that need sidebar OPEN: 0 (new-project-button) and 2 (demo-project)
    if (activeStep === 0 || activeStep === 2) {
      console.log('[MobileSidebarController] Opening sidebar for step:', activeStep);
      setOpenMobile(true);
    } else {
      // Use consistent 500ms delay to ensure content loads before closing
      const timer = setTimeout(() => {
        console.log('[MobileSidebarController] Closing sidebar for step:', activeStep);
        setOpenMobile(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentTourStep, isTourActive, isMobile, setOpenMobile]);
  
  return null;
};

const Index = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    signOut
  } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Debounce search input → searchQuery (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'gantt' | 'time-tracking'>('grid');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSpecialList, setSelectedSpecialList] = useState<'unassigned' | 'today' | null>(null);
  const [projectRefreshTrigger, setProjectRefreshTrigger] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isBrainDumpRecording, setIsBrainDumpRecording] = useState(false);
  const [isBrainDumpCtaActive, setIsBrainDumpCtaActive] = useState(false);
  const [globalCardView, setGlobalCardView] = useState<'full' | 'compact'>('full');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'all' | 'todo' | 'in-progress' | 'completed'>('all');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  const [tasksLoading, setTasksLoading] = useState(false);
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
  const [mobileDockOpen, setMobileDockOpen] = useState(false);
  const [fullDataLoaded, setFullDataLoaded] = useState(false);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [senderSharedMap, setSenderSharedMap] = useState<Record<string, string>>({});
  const [senderProjectSharedMap, setSenderProjectSharedMap] = useState<Record<string, string>>({});
  const [assignerNameMap, setAssignerNameMap] = useState<Record<string, string>>({});
  const [showProjectsTour, setShowProjectsTour] = useState(false);
  const [projectsTourCurrentStep, setProjectsTourCurrentStep] = useState(0);
  const [projectsTourProjects, setProjectsTourProjects] = useState<{id: string, name: string}[]>([]);
  const [projectsTourTask, setProjectsTourTask] = useState<Task | null>(null);
  const [createProjectDialogOpenForTour, setCreateProjectDialogOpenForTour] = useState(false);
  const [tourCreateDialogOpen, setTourCreateDialogOpen] = useState(false);
  const [lastProcessedTourStep, setLastProcessedTourStep] = useState<number | null>(null);
  
  const { preferences, loading: prefsLoading, updatePreferences, markOnboardingComplete, markTaskTourComplete, markProjectsTourComplete } = useUserPreferences(user?.id);
  const { setTheme } = useTheme();
  const { triggerParticles, containerRef } = useParticleAnimation({
    particleCount: 12,
    colors: ['#4FD1C5', '#3B82F6', '#06B6D4'],
    animationDuration: 0.6
  });
  const isMobile = useIsMobile();
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

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

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
  }), []);

  // Fetch projects (lightweight - just names for sidebar)
  const fetchProjects = useCallback(async () => {
    const { data, error } = await (supabase as any).from('focusos_projects').select('*').order('created_at', {
      ascending: false
    });
    if (error) {
      toast.error('Failed to load projects');
      return;
    }
    setProjects(data.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isShared: p.is_shared ?? false,
      timer: {
        totalSeconds: 0,
        isRunning: false
      }
    })));
  }, []);

  // Phase 1: Fetch only tasks for the initial/default view
  const fetchInitialTasks = useCallback(async (defaultView: string) => {
    setTasksLoading(true);
    try {
      let query = (supabase as any).from('focusos_tasks').select('*').order('created_at', {
        ascending: false
      });
      
      if (defaultView === 'today') {
        const today = new Date();
        query = query.lte('due_date', endOfDay(today).toISOString());
      } else if (defaultView === 'unassigned') {
        query = query.is('project_id', null);
      } else {
        // It's a project ID
        query = query.eq('project_id', defaultView);
      }
      
      const { data, error } = await query;
      if (error) {
        toast.error('Failed to load tasks');
        return;
      }
      
      const transformedTasks = data.map(transformDbTask);
      setTasks(transformedTasks);
    } finally {
      setTasksLoading(false);
    }
  }, [transformDbTask]);

  // Phase 2: Fetch ALL tasks in background
  const fetchAllTasks = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_tasks')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Failed to load all tasks:', error);
        return;
      }
      
      const transformedTasks = data.map(transformDbTask);
      setAllTasks(transformedTasks);
      setTasks(transformedTasks);
    } catch (error) {
      console.error('Error fetching all tasks:', error);
    }
  }, [transformDbTask]);

  // Fetch shared items where current user is sender, to show "Shared with" on task cards and project headers
  const fetchSenderSharedItems = useCallback(async () => {
    if (!user) return;
    try {
      const { data: sharedItems, error } = await (supabase as any)
        .from('focusos_shared_items')
        .select('item_id, item_type, recipient_email, recipient_user_id, status')
        .eq('sender_user_id', user.id)
        .in('item_type', ['task', 'project'])
        .neq('status', 'cancelled');
      
      if (error || !sharedItems) return;

      // Collect unique recipient_user_ids to look up names
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

      // Build maps: task item_id → display name, project item_id → display name
      const taskMap: Record<string, string> = {};
      const projectMap: Record<string, string> = {};
      for (const si of sharedItems) {
        const name = si.recipient_user_id && profilesMap[si.recipient_user_id]
          ? profilesMap[si.recipient_user_id]
          : si.recipient_email;
        if (si.item_type === 'task') {
          taskMap[si.item_id] = name;
        } else if (si.item_type === 'project') {
          projectMap[si.item_id] = name;
        }
      }
      setSenderSharedMap(taskMap);
      setSenderProjectSharedMap(projectMap);
    } catch (err) {
      console.error('Error fetching sender shared items:', err);
    }
  }, [user]);


  const filterTasksFromCache = useCallback(() => {
    if (allTasks.length === 0) return;
    
    let filtered = allTasks;
    
    if (selectedProjectId) {
      filtered = allTasks.filter(t => t.projectId === selectedProjectId);
    } else if (selectedSpecialList === 'unassigned') {
      filtered = allTasks.filter(t => !t.projectId);
    } else if (selectedSpecialList === 'today') {
      const today = new Date();
      const todayEnd = endOfDay(today);
      filtered = allTasks.filter(t => t.dueDate && new Date(t.dueDate) <= todayEnd);
    }
    
    setTasks(filtered);
  }, [allTasks, selectedProjectId, selectedSpecialList]);

  // Legacy fetchTasks for specific use cases (task creation, etc.)
  const fetchTasks = useCallback(async () => {
    if (fullDataLoaded) {
      // Re-fetch all tasks and update cache
      await fetchAllTasks();
    } else {
      // Fetch only current view
      await fetchInitialTasks(
        selectedProjectId || 
        (selectedSpecialList === 'today' ? 'today' : 
         selectedSpecialList === 'unassigned' ? 'unassigned' : 'today')
      );
    }
  }, [fullDataLoaded, fetchAllTasks, fetchInitialTasks, selectedProjectId, selectedSpecialList]);

  // Re-fetch projects whenever projectRefreshTrigger changes (after initial load)
  useEffect(() => {
    if (initialLoadComplete) {
      fetchProjects();
    }
  }, [projectRefreshTrigger, initialLoadComplete, fetchProjects]);

  // Phase 1: Initial fast load - preferences + initial view tasks + all projects
  useEffect(() => {
    const loadInitialData = async () => {
      if (user && preferences && !initialLoadComplete) {
        // User is already authenticated via useAuth - no need to re-check session
        await Promise.all([
          fetchInitialTasks(preferences.default_view),
          fetchProjects()
        ]);
        setInitialLoadComplete(true);
      }
    };
    loadInitialData();
  }, [user, preferences, initialLoadComplete, fetchInitialTasks, fetchProjects]);

  // Phase 2: Background load - all remaining tasks + sender shared items
  useEffect(() => {
    const loadRemainingData = async () => {
      if (initialLoadComplete && user && !fullDataLoaded) {
        await Promise.all([fetchAllTasks(), fetchSenderSharedItems()]);
        setFullDataLoaded(true);
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

  // Re-fetch when view changes (use allTasks if available, otherwise fetch)
  useEffect(() => {
    if (initialLoadComplete && user) {
      if (fullDataLoaded) {
        // Use cached allTasks to filter
        filterTasksFromCache();
      } else {
        // Still loading in background, fetch specific view
        fetchInitialTasks(
          selectedProjectId || 
          (selectedSpecialList === 'today' ? 'today' : 
           selectedSpecialList === 'unassigned' ? 'unassigned' : 'today')
        );
      }
    }
  }, [selectedProjectId, selectedSpecialList, initialLoadComplete, user, fullDataLoaded, filterTasksFromCache, fetchInitialTasks]);

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
          setTasks(prev => {
            if (prev.some(t => t.id === newTask.id)) return prev;
            return [...prev, newTask];
          });
          // Also update allTasks cache if loaded
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
          setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
          // Also update allTasks cache
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
          setTasks(prev => prev.filter(t => t.id !== deletedTaskId));
          // Also update allTasks cache
          setAllTasks(prev => prev.filter(t => t.id !== deletedTaskId));
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Realtime connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Realtime error:', err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, transformDbTask]);

  // Apply user preferences on load
  useEffect(() => {
    if (preferences && !preferencesLoaded && projects.length > 0 && !selectedProjectId && !selectedSpecialList) {
      // Apply default view
      if (preferences.default_view === 'today') {
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
      
      // Apply task card view
      if (preferences.default_task_card_view) {
        setGlobalCardView(preferences.default_task_card_view);
      }
      
      // Apply theme
      if (preferences.theme) {
        setTheme(preferences.theme);
      }
      
      setPreferencesLoaded(true);
    }
  }, [preferences, preferencesLoaded, projects]);

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
    const {
      error
    } = await (supabase as any).from('focusos_tasks').insert({
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
    });
    if (error) {
      toast.error('Failed to create task');
      return;
    }
    toast.success('Task created!');
    fetchTasks();
  };
  const handleUpdateTask = async (updatedTask: Task) => {
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
      sort_order: updatedTask.sortOrder ?? 0
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
        },
      });
      if (error) throw error;

      // Optimistic: clear completedByEmail on sender's task
      const cleared = { ...changesNeededTask, completedByEmail: undefined, changeRequestMessage: undefined };
      setTasks(prev => prev.map(t => t.id === cleared.id ? cleared : t));
      setAllTasks(prev => prev.map(t => t.id === cleared.id ? cleared : t));

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
        return taskDueDate <= today;
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
    sharedWithName: senderSharedMap[t.id] || undefined,
  }));
  
  // Show loading screen while auth, preferences, or initial tasks are loading
  if (authLoading || prefsLoading || (user && !preferences) || (user && !initialLoadComplete)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading your tasks...</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return null;
  }
  const dockItems = [
    {
      icon: (
        <div className="relative w-12 h-12 flex items-center justify-center">
          <svg viewBox="0 0 256 256" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
            <path d="m123.48 66.47c.43 12.92 1.59 125.78.28 133.63-1.18 7.07-5.7 19.84-14.33 21.18s-14.23-5.15-16.82-6-9.75 3.53-15.41-.34-4.42-14-6-15.72-10.34.31-14.54-5.49-.55-12-1.88-13.68-14.27-3.2-16.1-16.75c-2.08-15.55 10.39-18.59 10.32-21.01s-10.34-15.65-5.14-31.91 18.88-18 19.68-19.46-5.46-10.42 2.78-23.34 20.13-9.43 21.82-10.58-.29-6.24 5.44-13.45c5.29-6.66 15.41-8.3 22.72-4.09 6.63 3.86 6.75 14.09 7.18 27.01z" className="fill-foreground" opacity="0.15"/>
            <path d="m132.29 63.82c-.67 13-1.88 126.42-.7 134.33 1.06 7.12 3 15.1 13.59 20.24 8 3.88 15.62-2.43 18.13-3.25s8.51.27 14.32-3.53 8.34-12.3 9.92-13.19 9.23-.12 13.6-5.89.8-11.79 1.3-13.67 11.92-4.1 14.06-16.43c2.64-15.17-9.72-19.26-10.06-21.31s9.28-9.24 6.29-23.55c-3.27-15.63-13.39-17.49-14.16-19.42s5.16-6.87 2.08-15.8-11-8.73-12.16-10.66 1.67-6.79-3.18-12.79c-5.05-6.25-15.3-3.09-17-4s-1.66-7.15-7.53-13.37c-4.6-4.87-14.63-7.39-21.29-1.73-5.91 5-6.5 11.04-7.21 24.02z" className="fill-foreground" opacity="0.15"/>
            <path d="m107.06 229.47c-7.58 0-13.08-3.77-16.23-5.93l-.08-.05-.37.08c-3.87.89-11.08 2.54-17.69-2-5.94-4.06-7.45-10.76-8.16-15.52-4.21-.54-10.23-1.95-14.32-7.6a19.73 19.73 0 0 1-3.53-13.45c-14-6.82-15.38-16.75-15.9-20.62-1.78-13.08 4.22-20.23 8.64-24.05-3-6.52-7.6-18.54-3.18-32.38a35.26 35.26 0 0 1 18.21-21.54c-.93-5.35-1-13.53 5.12-23.13 7-10.91 16.37-13.24 22.25-13.77a28 28 0 0 1 5.49-10.9c7.65-9.62 22.13-12.28 33-6 10.26 5.87 10.69 18.75 11.13 32.39v1.22c.32 9.58 1.72 126 .18 135.21-1.93 11.61-8.59 25.85-21 27.78a23.41 23.41 0 0 1-3.56.26z" className="fill-foreground"/>
            <path d="m150.54 227.64a20 20 0 0 1-8.87-2.06c-15.19-7.4-17.09-20.14-18-26.26-1.36-9.09 0-124.6.62-135.93.64-12.4 1.15-22.19 10-29.72 10-8.48 24.76-5.64 32.29 2.33a32.91 32.91 0 0 1 6.82 10.88c5.06-.13 12.83.44 18.12 7a20.39 20.39 0 0 1 4.76 12.84 21.51 21.51 0 0 1 11.93 13 22.48 22.48 0 0 1-.07 15.47c4.24 3.19 10 9.12 12.41 20.72a32.1 32.1 0 0 1-3.95 23.62c4.37 4.12 10 11.67 7.77 24.26-1.86 10.66-8.76 16.09-13.29 18.88a19.24 19.24 0 0 1-3.58 14.67c-4.63 6.12-11.19 7.64-15.16 8.27-1.88 3.5-5 9.16-10.36 12.67-5.8 3.79-11.56 4.18-15 4.41l-1.24.09-.79.42c-2.73 1.54-8.05 4.44-14.41 4.44z" className="fill-foreground"/>
            <path d="M128 72C105 72 88 90 88 112C88 129 97 143 110 152C113 154 114 157 114 160V168C114 170.2 115.8 172 118 172H138C140.2 172 142 170.2 142 168V160C142 157 143 154 146 152C159 143 168 129 168 112C168 90 151 72 128 72Z" className="fill-primary"/>
            <path d="M112 172H144C147.3 172 150 174.7 150 178V184C150 187.3 147.3 190 144 190H112C108.7 190 106 187.3 106 184V178C106 174.7 108.7 172 112 172Z" className="fill-primary"/>
            <path d="M114 190H142C144.2 190 146 191.8 146 194V198C146 200.2 144.2 202 142 202H114C111.8 202 110 200.2 110 198V194C110 191.8 111.8 190 114 190Z" className="fill-primary"/>
          </svg>
        </div>
      ),
      label: 'Brain Dump',
      permanentLabel: 'Brain Dump',
      isRecording: isBrainDumpRecording,
      isHighlighted: isBrainDumpCtaActive,
      tourStepId: 'brain-dump',
      onClick: (e?: React.MouseEvent<HTMLElement>) => {
        if (e) triggerParticles(e.currentTarget);
        setDialogOpen(true);
      }
    }
  ];

  return <PullToRefresh>
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <MobileSidebarController tourStep={lastProcessedTourStep} isTourActive={showProjectsTour} currentTourStep={projectsTourCurrentStep} />
      <div className="min-h-screen flex w-full relative">
        <div ref={containerRef} className="dock-particle-container" />
        <LightRays raysOrigin="top-center" raysColor="#2b12e2" raysSpeed={0.8} lightSpread={1.2} rayLength={2.5} pulsating={false} fadeDistance={1.2} saturation={1.0} followMouse={true} mouseInfluence={0.15} noiseAmount={0.05} distortion={0.1} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />

        <div className="flex flex-1 relative w-full flex-col">
          <div className="flex flex-1 relative">
            {/* Sidebar */}
            <ProjectSidebar selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onSelectSpecialList={setSelectedSpecialList} selectedSpecialList={selectedSpecialList} projectRefreshTrigger={projectRefreshTrigger} onProjectCreated={() => setProjectRefreshTrigger(prev => prev + 1)} onStartTour={handleHelpClick} onStartTaskTour={handleStartTaskTour} onStartProjectsTour={handleStartProjectsTour} createDialogOpen={showProjectsTour ? tourCreateDialogOpen : undefined} onCreateDialogOpenChange={showProjectsTour ? setTourCreateDialogOpen : undefined} isTourActive={showProjectsTour} userId={user?.id} />

            {/* Main Content */}
            <div className="flex-1 relative z-10 overflow-x-hidden overflow-y-auto">
              <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-2 sm:px-4 pb-32">
                {/* Header */}
                <div className="mb-4 sm:mb-6 lg:mb-8 flex flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <SidebarTrigger className="relative z-10 min-h-[44px] min-w-[44px] hidden md:flex" />
                    <HeroSection onTasksCreated={() => {
                    fetchTasks();
                    setProjectRefreshTrigger(prev => prev + 1);
                  }} dialogOpen={dialogOpen} setDialogOpen={setDialogOpen} onCtaPhaseChange={setIsBrainDumpCtaActive} />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Button variant="outline" onClick={() => setSettingsOpen(true)} className="min-h-[44px] min-w-[44px] p-0 shrink-0">
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" onClick={handleSignOut} className="min-h-[44px] min-w-[44px] p-0 shrink-0">
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

          {/* Actions Bar */}
          <div className="flex flex-row gap-2 sm:gap-3 items-center mb-4 sm:mb-6">
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
                <Button 
                  variant="outline"
                  onClick={() => {
                    setGlobalCardView(prev => prev === 'full' ? 'compact' : 'full');
                    setExpandedTaskIds(new Set());
                  }}
                  className="gap-2 border-2 w-[70px] lg:w-auto h-10"
                >
                  <Eye className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {globalCardView === 'full' ? 'view -' : 'view +'}
                  </span>
                  <span className="sm:hidden">
                    {globalCardView === 'full' ? '-' : '+'}
                  </span>
                </Button>
              )}
              <AddTaskDialog open={addTaskDialogOpen} onOpenChange={handleAddTaskDialogOpen} onAddTask={handleAddTask} selectedProjectId={selectedProjectId} selectedSpecialList={selectedSpecialList} projects={projects} />
            </div>
          </div>

          {/* Main Content */}
          {viewMode === 'list' ? <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
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
                const isSharedProject = currentProject?.isShared ?? false;
                const assignedByEmail = isSharedProject ? tasks.find(t => t.projectId === selectedProjectId)?.assignedToEmail : null;
                return <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 py-2">
                    <div className="flex flex-col gap-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ color: currentProject?.color }}>📁</span>
                        
                        {isEditingProjectName && !isSharedProject ? (
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
                            className={`font-semibold text-base ${!isSharedProject ? 'cursor-pointer hover:opacity-70' : ''} transition-opacity`}
                            style={{ color: currentProject?.color }}
                            onClick={!isSharedProject ? handleStartEditingProject : undefined}
                            data-projects-tour-step="project-name"
                          >
                            {currentProject?.name}
                          </span>
                        )}
                      </div>
                      {isSharedProject && assignedByEmail && (
                        <span className="text-xs text-muted-foreground ml-7">Shared by {assignerNameMap[assignedByEmail] || assignedByEmail}</span>
                      )}
                      {!isSharedProject && selectedProjectId && senderProjectSharedMap[selectedProjectId] && (
                        <span className="text-xs text-muted-foreground ml-7">Shared with {senderProjectSharedMap[selectedProjectId]}</span>
                      )}
                    </div>

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
                    
                    {!isSharedProject && (
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
                          className="gap-1 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10"
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
                        Today's To-Do
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
                        className="gap-1 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10"
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

              {/* Unassigned Tasks Banner */}
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
                        className="gap-1 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10"
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
                  onDismissChangeRequest={handleDismissChangeRequest}
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
                  onDismissChangeRequest={handleDismissChangeRequest}
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
                  onDismissChangeRequest={handleDismissChangeRequest}
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
                  onDismissChangeRequest={handleDismissChangeRequest}
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
                const isSharedProject2 = currentProject2?.isShared ?? false;
                const assignedByEmail2 = isSharedProject2 ? tasks.find(t => t.projectId === selectedProjectId)?.assignedToEmail : null;
                return <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex flex-col gap-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ color: currentProject2?.color }}>📁</span>
                        
                        {isEditingProjectName && !isSharedProject2 ? (
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
                            className={`font-semibold text-base ${!isSharedProject2 ? 'cursor-pointer hover:opacity-70' : ''} transition-opacity`}
                            style={{ color: currentProject2?.color }}
                            onClick={!isSharedProject2 ? handleStartEditingProject : undefined}
                          >
                            {currentProject2?.name}
                          </span>
                        )}
                      </div>
                      {isSharedProject2 && assignedByEmail2 && (
                        <span className="text-xs text-muted-foreground ml-7">Shared by {assignerNameMap[assignedByEmail2] || assignedByEmail2}</span>
                      )}
                    </div>
                    
                    {!isSharedProject2 && (
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
                          className="gap-1 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10"
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
                {sortedTasks.filter(t => t.status !== 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} projects={projects} />)}
              </TabsContent>

              <TabsContent value="todo" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'todo').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} projects={projects} />)}
              </TabsContent>

              <TabsContent value="in-progress" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'in-progress').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} projects={projects} />)}
              </TabsContent>

              <TabsContent value="completed" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} onEditTask={setEditingTask} onAssignTask={handleAssignTask} onRequestChanges={handleRequestChanges} onDismissChangeRequest={handleDismissChangeRequest} projects={projects} />)}
              </TabsContent>
            </Tabs> : viewMode === 'gantt' ? <div className="mt-6">
              <GanttChart 
                tasks={sortedTasks} 
                projectName={
                  selectedProjectId 
                    ? projects.find(p => p.id === selectedProjectId)?.name || 'Project'
                    : selectedSpecialList === 'today'
                    ? 'Today'
                    : selectedSpecialList === 'unassigned'
                    ? 'Unassigned Tasks'
                    : 'All Tasks'
                }
                onTaskClick={handleUpdateTask}
              />
            </div> : <div className="mt-6">
              <TimeTrackingChart tasks={sortedTasks} projects={projects} />
            </div>}
              </div>
            </div>
          </div>
        </div>

        {/* Dock Bar - Hidden when dialogs are open */}
        {!dialogOpen && !settingsOpen && !editingTask && !addTaskDialogOpen && (
          <>
            {/* Desktop: Bottom dock - always visible */}
            {!isMobile && (
              <AnimatePresence>
                <motion.div
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 100, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center pointer-events-none"
                >
                  <Dock items={dockItems} panelHeight={90} baseItemSize={50} />
                </motion.div>
              </AnimatePresence>
            )}

            {/* Mobile: FAB when closed, Dock slides from right to bottom position when open */}
            {isMobile && (
              <>
                {/* Overlay - click to close */}
                <AnimatePresence>
                  {mobileDockOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-[99] bg-black/20"
                      onClick={() => setMobileDockOpen(false)}
                    />
                  )}
                </AnimatePresence>

                {/* Projects FAB button - bottom left, only visible when dock is closed and sidebar is closed */}
                <AnimatePresence>
                  {!mobileDockOpen && !sidebarOpen && <ProjectsFAB />}
                </AnimatePresence>

                {/* FAB button - only visible when dock is closed */}
                <AnimatePresence>
                  {!mobileDockOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, delay: 0.2 }}
                      className="fixed right-6 z-[100]"
                      style={{ bottom: 'calc(44px + env(safe-area-inset-bottom))' }}
                    >
                      <button
                        onClick={() => setMobileDockOpen(true)}
                        className="relative w-[50px] h-[50px] rounded-full p-[3px] shadow-lg"
                        data-tour-step="menu-fab"
                        style={{
                          background: 'conic-gradient(from 0deg, hsl(186 80% 55%), hsl(270 80% 60%), hsl(14 90% 65%), hsl(186 80% 55%))'
                        }}
                      >
                        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
                          <Mic className="w-6 h-6 text-primary" />
                        </div>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Dock - slides from right edge to center */}
                <AnimatePresence>
                  {mobileDockOpen && (
                    <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
                      <motion.div
                        initial={{ x: '100vw' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100vw' }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="pointer-events-auto"
                      >
                        <Dock items={dockItems} panelHeight={90} baseItemSize={50} />
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </>
            )}
          </>
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
        onTasksCreated={() => {
          fetchTasks();
          setProjectRefreshTrigger(prev => prev + 1);
        }}
        onRecordingChange={setIsBrainDumpRecording}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projects={projects}
        preferences={preferences}
        loading={prefsLoading}
        onSave={updatePreferences}
      />

      <OnboardingTour isOpen={showTour} onComplete={handleTourComplete} onOpenMobileDock={() => setMobileDockOpen(true)} />

      {/* Task Tour Edit Dialog */}
      {editingTask && (
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
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {changesNeededLoading ? 'Sending...' : 'Send Changes Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  </PullToRefresh>;
};
export default Index;