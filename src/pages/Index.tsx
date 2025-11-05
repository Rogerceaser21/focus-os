import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Task, Project } from '@/types/task';
import { TaskCard } from '@/components/TaskCard';
import { TaskListItem } from '@/components/TaskListItem';
import { GanttChart } from '@/components/GanttChart';
import { TimeTrackingChart } from '@/components/TimeTrackingChart';
import { AddTaskDialog } from '@/components/AddTaskDialog';
import { ProjectSidebar } from '@/components/ProjectSidebar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Search, LayoutList, LayoutGrid, GanttChartSquare, Clock, LogOut, FolderKanban, ListChecks, Calendar, Sparkles, Settings, Eye, ChevronDown, Check } from 'lucide-react';
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
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import Dock from '@/components/Dock';
import { useParticleAnimation } from '@/hooks/useParticleAnimation';
import { BrainDumpDialog } from '@/components/BrainDumpDialog';
import { TaskOnlyBrainDumpDialog } from '@/components/TaskOnlyBrainDumpDialog';
import { TodayBrainDumpDialog } from '@/components/TodayBrainDumpDialog';
import SettingsDialog from '@/components/SettingsDialog';
import { useUserPreferences } from '@/hooks/useUserPreferences';
const Index = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    signOut
  } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'gantt' | 'time-tracking'>('grid');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSpecialList, setSelectedSpecialList] = useState<'unassigned' | 'today' | null>(null);
  const [projectRefreshTrigger, setProjectRefreshTrigger] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [taskOnlyDialogOpen, setTaskOnlyDialogOpen] = useState(false);
  const [todayDialogOpen, setTodayDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalCardView, setGlobalCardView] = useState<'full' | 'compact'>('full');
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'all' | 'todo' | 'in-progress' | 'completed'>('all');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  
  const { preferences, loading: prefsLoading, updatePreferences } = useUserPreferences();
  const { triggerParticles, containerRef } = useParticleAnimation({
    particleCount: 12,
    colors: ['#4FD1C5', '#3B82F6', '#06B6D4'],
    animationDuration: 0.6
  });

  // Handle clicking outside task cards to collapse them
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Check if click is outside all task cards
      const isOutsideTaskCard = !target.closest('[data-task-card]');
      
      if (isOutsideTaskCard && expandedTaskIds.size > 0) {
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
  useEffect(() => {
    if (user) {
      fetchTasks();
      fetchProjects();
    }
  }, [user, selectedProjectId, selectedSpecialList]);

  // Apply user preferences on load
  useEffect(() => {
    if (preferences && !preferencesLoaded && projects.length > 0) {
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
      
      setPreferencesLoaded(true);
    }
  }, [preferences, preferencesLoaded, projects]);
  const fetchTasks = async () => {
    let query = supabase.from('tasks').select('*').order('created_at', {
      ascending: false
    });
    if (selectedProjectId) {
      query = query.eq('project_id', selectedProjectId);
    } else if (selectedSpecialList === 'unassigned') {
      query = query.is('project_id', null);
    } else if (selectedSpecialList === 'today') {
      const today = new Date();
      query = query.lte('due_date', endOfDay(today).toISOString());
    }
    const {
      data,
      error
    } = await query;
    if (error) {
      toast.error('Failed to load tasks');
      return;
    }
    setTasks(data.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: t.priority as any,
      status: t.status as any,
      startDate: t.start_date ? new Date(t.start_date) : undefined,
      endDate: t.end_date ? new Date(t.end_date) : undefined,
      dueDate: t.due_date ? new Date(t.due_date) : undefined,
      imageUrl: t.image_url,
      timer: {
        totalSeconds: t.timer_total_seconds,
        isRunning: t.timer_is_running,
        startTime: t.timer_start_time
      },
      projectId: t.project_id
    })));
  };
  const fetchProjects = async () => {
    const {
      data,
      error
    } = await supabase.from('projects').select('*').order('created_at', {
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
      timer: {
        totalSeconds: 0,
        isRunning: false
      }
    })));
  };
  const handleAddTask = async (newTask: Task) => {
    if (!user) return;
    const {
      error
    } = await supabase.from('tasks').insert({
      user_id: user.id,
      project_id: newTask.projectId || null,
      title: newTask.title,
      description: newTask.description,
      priority: newTask.priority,
      status: newTask.status,
      start_date: newTask.startDate?.toISOString(),
      end_date: newTask.endDate?.toISOString(),
      due_date: newTask.dueDate?.toISOString(),
      image_url: newTask.imageUrl,
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

    // Update database in background
    const {
      error
    } = await supabase.from('tasks').update({
      title: updatedTask.title,
      description: updatedTask.description,
      priority: updatedTask.priority,
      status: updatedTask.status,
      start_date: updatedTask.startDate?.toISOString(),
      end_date: updatedTask.endDate?.toISOString(),
      due_date: updatedTask.dueDate?.toISOString(),
      image_url: updatedTask.imageUrl,
      timer_total_seconds: updatedTask.timer.totalSeconds,
      timer_is_running: updatedTask.timer.isRunning,
      timer_start_time: updatedTask.timer.startTime
    }).eq('id', updatedTask.id);
    if (error) {
      toast.error('Failed to update task');
      // Revert to database state if update fails
      fetchTasks();
      return;
    }
  };
  const handleTaskClick = (taskId: string) => {
    setExpandedTaskIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
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
      const { error } = await supabase
        .from('projects')
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
      const { error: tasksError } = await supabase
        .from('tasks')
        .delete()
        .eq('project_id', selectedProjectId);

      if (tasksError) throw tasksError;

      // Delete the project
      const { error: projectError } = await supabase
        .from('projects')
        .delete()
        .eq('id', selectedProjectId);

      if (projectError) throw projectError;

      // Update local state
      setProjects(projects.filter(p => p.id !== selectedProjectId));
      setTasks(tasks.filter(t => t.projectId !== selectedProjectId));
      
      // Reset selection to "Today" view
      setSelectedProjectId(null);
      setSelectedSpecialList('today');
      
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
  const filteredTasks = tasks.filter(task => {
    // First, filter by search query
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         task.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;
    
    // Then filter by selected project or special list
    if (selectedProjectId) {
      return task.projectId === selectedProjectId;
    } else if (selectedSpecialList === 'unassigned') {
      return !task.projectId;
    } else if (selectedSpecialList === 'today') {
      // Tasks with due date = today or earlier (overdue)
      if (!task.dueDate) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day
      const taskDueDate = new Date(task.dueDate);
      taskDueDate.setHours(0, 0, 0, 0); // Normalize to start of day
      return taskDueDate <= today; // Show tasks due today or earlier
    }
    
    // If nothing is selected, show all tasks
    return true;
  });

  // Priority order for sorting
  const priorityOrder = {
    'urgent': 1,
    'high': 2,
    'medium': 3,
    'low': 4
  };

  // Sort tasks by priority
  const sortTasksByPriority = (tasksToSort: Task[]) => {
    return [...tasksToSort].sort((a, b) => {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  };

  const sortedTasks = sortTasksByPriority(filteredTasks);
  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  if (!user) {
    return null;
  }
  const dockItems = [
    {
      icon: (
        <div className="flex items-center gap-1">
          <FolderKanban className="w-6 h-6" />
          <Sparkles className="w-4 h-4 text-blue-500" />
        </div>
      ),
      label: 'Projects',
      onClick: (e?: React.MouseEvent<HTMLElement>) => {
        if (e) triggerParticles(e.currentTarget);
        setDialogOpen(true);
      }
    },
    {
      icon: (
        <div className="flex items-center gap-1">
          <ListChecks className="w-6 h-6" />
          <Sparkles className="w-4 h-4 text-blue-500" />
        </div>
      ),
      label: 'Tasks',
      onClick: (e?: React.MouseEvent<HTMLElement>) => {
        if (e) triggerParticles(e.currentTarget);
        
        // Validate project selection
        if (!selectedProjectId && !selectedSpecialList) {
          toast.error('Please select a project first', {
            description: 'Choose a project from the sidebar to add tasks to it.'
          });
          return;
        }
        
        setTaskOnlyDialogOpen(true);
      }
    },
    {
      icon: (
        <div className="flex items-center gap-1">
          <Calendar className="w-6 h-6" />
          <Sparkles className="w-4 h-4 text-blue-500" />
        </div>
      ),
      label: 'Today',
      onClick: (e?: React.MouseEvent<HTMLElement>) => {
        if (e) triggerParticles(e.currentTarget);
        setTodayDialogOpen(true);
      }
    },
    {
      icon: <Settings className="w-6 h-6" />,
      label: 'Settings',
      onClick: () => setSettingsOpen(true)
    }
  ];

  return <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen flex w-full relative">
        <div ref={containerRef} className="dock-particle-container" />
        <LightRays raysOrigin="top-center" raysColor="#2b12e2" raysSpeed={0.8} lightSpread={1.2} rayLength={2.5} pulsating={false} fadeDistance={1.2} saturation={1.0} followMouse={true} mouseInfluence={0.15} noiseAmount={0.05} distortion={0.1} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />

        <div className="flex flex-1 relative w-full flex-col">
          <div className="flex flex-1 relative">
            {/* Sidebar */}
            <ProjectSidebar selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onSelectSpecialList={setSelectedSpecialList} selectedSpecialList={selectedSpecialList} projectRefreshTrigger={projectRefreshTrigger} />

            {/* Main Content */}
            <div className="flex-1 relative z-10 overflow-x-hidden overflow-y-auto">
              <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-2 sm:px-4 pb-32">
                {/* Header */}
                <div className="mb-4 sm:mb-6 lg:mb-8 flex flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <SidebarTrigger className="relative z-10 min-h-[44px] min-w-[44px]" />
                    <HeroSection onTasksCreated={() => {
                    fetchTasks();
                    setProjectRefreshTrigger(prev => prev + 1);
                  }} dialogOpen={dialogOpen} setDialogOpen={setDialogOpen} />
                  </div>
                  <Button variant="outline" onClick={handleSignOut} className="gap-2 min-h-[44px] shrink-0">
                    <LogOut className="h-4 w-4" />
                    <span className="hidden sm:inline">Sign Out</span>
                  </Button>
                </div>

          {/* Actions Bar */}
          <div className="flex flex-row gap-2 sm:gap-3 items-center mb-4 sm:mb-6">
            <div className="relative flex-[2] md:flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hidden sm:block" />
              <Input placeholder="Search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-3 sm:pl-9 bg-card/80 backdrop-blur-sm border-2 h-10 md:hidden" />
              <Input placeholder="Search tasks..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-3 sm:pl-9 bg-card/80 backdrop-blur-sm border-2 h-10 hidden md:block" />
            </div>
            <div className="flex gap-2">
              {/* Mobile/Tablet: Display Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-1 border-2 h-10 px-3 flex md:hidden">
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
              <div className="hidden md:flex gap-2">
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
                  className="gap-2 border-2 flex-1 sm:flex-initial h-10 min-w-[60px] sm:min-w-0"
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
              <AddTaskDialog onAddTask={handleAddTask} selectedProjectId={selectedProjectId} />
            </div>
          </div>

          {/* Main Content */}
          {viewMode === 'list' ? <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
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

              {selectedProjectId && projects.find(p => p.id === selectedProjectId) && <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span style={{
                        color: projects.find(p => p.id === selectedProjectId)?.color
                      }}>📁</span>
                      
                      {isEditingProjectName ? (
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
                          style={{ color: projects.find(p => p.id === selectedProjectId)?.color }}
                        />
                      ) : (
                        <span 
                          className="font-semibold text-base cursor-pointer hover:opacity-70 transition-opacity"
                          style={{ color: projects.find(p => p.id === selectedProjectId)?.color }}
                          onClick={handleStartEditingProject}
                        >
                          {projects.find(p => p.id === selectedProjectId)?.name}
                        </span>
                      )}
                    </div>
                    
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
                  </div>
                </div>}

              <TabsContent value="all" className="flex flex-col gap-2 mt-6">
                {sortedTasks.filter(t => t.status !== 'completed').map(task => (
                  <TaskListItem 
                    key={task.id} 
                    task={task} 
                    onUpdate={handleUpdateTask} 
                    globalViewMode={globalCardView}
                    isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                    onTaskClick={() => handleTaskClick(task.id)}
                  />
                ))}
              </TabsContent>

              <TabsContent value="todo" className="flex flex-col gap-2 mt-6">
                {sortedTasks.filter(t => t.status === 'todo').map(task => (
                  <TaskListItem 
                    key={task.id} 
                    task={task} 
                    onUpdate={handleUpdateTask} 
                    globalViewMode={globalCardView}
                    isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                    onTaskClick={() => handleTaskClick(task.id)}
                  />
                ))}
              </TabsContent>

              <TabsContent value="in-progress" className="flex flex-col gap-2 mt-6">
                {sortedTasks.filter(t => t.status === 'in-progress').map(task => (
                  <TaskListItem 
                    key={task.id} 
                    task={task} 
                    onUpdate={handleUpdateTask} 
                    globalViewMode={globalCardView}
                    isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                    onTaskClick={() => handleTaskClick(task.id)}
                  />
                ))}
              </TabsContent>

              <TabsContent value="completed" className="flex flex-col gap-2 mt-6">
                {sortedTasks.filter(t => t.status === 'completed').map(task => (
                  <TaskListItem 
                    key={task.id} 
                    task={task} 
                    onUpdate={handleUpdateTask} 
                    globalViewMode={globalCardView}
                    isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                    onTaskClick={() => handleTaskClick(task.id)}
                  />
                ))}
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

              {selectedProjectId && projects.find(p => p.id === selectedProjectId) && <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span style={{
                        color: projects.find(p => p.id === selectedProjectId)?.color
                      }}>📁</span>
                      
                      {isEditingProjectName ? (
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
                          style={{ color: projects.find(p => p.id === selectedProjectId)?.color }}
                        />
                      ) : (
                        <span 
                          className="font-semibold text-base cursor-pointer hover:opacity-70 transition-opacity"
                          style={{ color: projects.find(p => p.id === selectedProjectId)?.color }}
                          onClick={handleStartEditingProject}
                        >
                          {projects.find(p => p.id === selectedProjectId)?.name}
                        </span>
                      )}
                    </div>
                    
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
                  </div>
                </div>}

              <TabsContent value="all" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status !== 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="todo" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'todo').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="in-progress" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'in-progress').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="completed" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {sortedTasks.filter(t => t.status === 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>
            </Tabs> : viewMode === 'gantt' ? <div className="mt-6">
              <GanttChart tasks={sortedTasks} />
            </div> : <div className="mt-6">
              <TimeTrackingChart tasks={sortedTasks} projects={projects} />
            </div>}
              </div>
            </div>
          </div>
        </div>

        {/* Dock Bar */}
        <div className="fixed bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <Dock items={dockItems} />
        </div>
      </div>
      
      <BrainDumpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onTasksCreated={() => {
          fetchTasks();
          setProjectRefreshTrigger(prev => prev + 1);
        }}
        userId={user?.id || ''}
      />

      <TaskOnlyBrainDumpDialog
        open={taskOnlyDialogOpen}
        onOpenChange={setTaskOnlyDialogOpen}
        onTasksCreated={() => {
          fetchTasks();
          setProjectRefreshTrigger(prev => prev + 1);
        }}
        userId={user?.id || ''}
        selectedProjectId={selectedProjectId}
        selectedProjectName={getSelectedProjectName()}
      />

      <TodayBrainDumpDialog
        open={todayDialogOpen}
        onOpenChange={setTodayDialogOpen}
        onTasksCreated={() => {
          fetchTasks();
          setProjectRefreshTrigger(prev => prev + 1);
        }}
        userId={user?.id || ''}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projects={projects}
        preferences={preferences}
        loading={prefsLoading}
        onSave={updatePreferences}
      />
    </SidebarProvider>;
};
export default Index;