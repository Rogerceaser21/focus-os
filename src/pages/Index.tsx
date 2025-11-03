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
import { Search, LayoutList, LayoutGrid, GanttChartSquare, Clock, LogOut, FolderKanban, ListChecks, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import LightRays from '@/components/LightRays';
import HeroSection from '@/components/HeroSection';
import { FloatingAIButton } from '@/components/FloatingAIButton';
import { startOfDay, endOfDay } from 'date-fns';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import Dock from '@/components/Dock';
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
      query = query.gte('due_date', startOfDay(today).toISOString()).lte('due_date', endOfDay(today).toISOString());
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
  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };
  const filteredTasks = tasks.filter(task => task.title.toLowerCase().includes(searchQuery.toLowerCase()) || task.description?.toLowerCase().includes(searchQuery.toLowerCase()));
  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  if (!user) {
    return null;
  }
  const dockItems = [
    {
      icon: <FolderKanban className="w-6 h-6" />,
      label: 'Projects',
      onClick: () => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        sidebar?.dispatchEvent(new Event('click'));
      }
    },
    {
      icon: <ListChecks className="w-6 h-6" />,
      label: 'Tasks',
      onClick: () => setDialogOpen(true)
    },
    {
      icon: <Calendar className="w-6 h-6" />,
      label: 'Today',
      onClick: () => {
        setSelectedProjectId(null);
        setSelectedSpecialList('today');
      }
    },
    {
      icon: <LogOut className="w-6 h-6" />,
      label: 'Sign Out',
      onClick: handleSignOut
    }
  ];

  return <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen flex w-full relative">
        <LightRays raysOrigin="top-center" raysColor="#2b12e2" raysSpeed={0.8} lightSpread={1.2} rayLength={2.5} pulsating={false} fadeDistance={1.2} saturation={1.0} followMouse={true} mouseInfluence={0.15} noiseAmount={0.05} distortion={0.1} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />
        
        {/* Floating AI Button */}
        <FloatingAIButton onClick={() => setDialogOpen(true)} />

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
          <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search tasks..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 bg-card/80 backdrop-blur-sm border-2 h-11 sm:h-10" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant={viewMode === 'list' ? 'default' : 'outline'} onClick={() => setViewMode('list')} className="gap-2 border-2 flex-1 sm:flex-initial min-h-[44px] sm:min-h-0">
                <LayoutList className="h-4 w-4" />
                <span className="hidden sm:inline">List</span>
              </Button>
              <Button variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')} className="gap-2 border-2 flex-1 sm:flex-initial min-h-[44px] sm:min-h-0">
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">Grid</span>
              </Button>
              <Button variant={viewMode === 'gantt' ? 'default' : 'outline'} onClick={() => setViewMode('gantt')} className="gap-2 border-2 flex-1 sm:flex-initial min-h-[44px] sm:min-h-0">
                <GanttChartSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Gantt</span>
              </Button>
              <Button variant={viewMode === 'time-tracking' ? 'default' : 'outline'} onClick={() => setViewMode('time-tracking')} className="gap-2 border-2 flex-1 sm:flex-initial min-h-[44px] sm:min-h-0">
                <Clock className="h-4 w-4" />
                <span className="hidden sm:inline">Time</span>
              </Button>
              <AddTaskDialog onAddTask={handleAddTask} selectedProjectId={selectedProjectId} />
            </div>
          </div>

          {/* Main Content */}
          {viewMode === 'list' ? <Tabs defaultValue="all" className="w-full">
              <TabsList className="w-full grid grid-cols-4 h-auto">
                <TabsTrigger value="all" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">All </span>({filteredTasks.length})
                </TabsTrigger>
                <TabsTrigger value="todo" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">To Do </span>({filteredTasks.filter(t => t.status === 'todo').length})
                </TabsTrigger>
                <TabsTrigger value="in-progress" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Progress </span>({filteredTasks.filter(t => t.status === 'in-progress').length})
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Done </span>({filteredTasks.filter(t => t.status === 'completed').length})
                </TabsTrigger>
              </TabsList>

              {selectedProjectId && projects.find(p => p.id === selectedProjectId) && <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span style={{
                      color: projects.find(p => p.id === selectedProjectId)?.color
                    }}>📁</span>
                    <span className="font-semibold text-base" style={{
                      color: projects.find(p => p.id === selectedProjectId)?.color
                    }}>
                      {projects.find(p => p.id === selectedProjectId)?.name}
                    </span>
                  </div>
                </div>}

              <TabsContent value="all" className="flex flex-col gap-2 mt-6">
                {filteredTasks.map(task => <TaskListItem key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="todo" className="flex flex-col gap-2 mt-6">
                {filteredTasks.filter(t => t.status === 'todo').map(task => <TaskListItem key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="in-progress" className="flex flex-col gap-2 mt-6">
                {filteredTasks.filter(t => t.status === 'in-progress').map(task => <TaskListItem key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="completed" className="flex flex-col gap-2 mt-6">
                {filteredTasks.filter(t => t.status === 'completed').map(task => <TaskListItem key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>
            </Tabs> : viewMode === 'grid' ? <Tabs defaultValue="all" className="w-full">
              <TabsList className="w-full grid grid-cols-4 h-auto">
                <TabsTrigger value="all" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">All </span>({filteredTasks.length})
                </TabsTrigger>
                <TabsTrigger value="todo" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">To Do </span>({filteredTasks.filter(t => t.status === 'todo').length})
                </TabsTrigger>
                <TabsTrigger value="in-progress" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Progress </span>({filteredTasks.filter(t => t.status === 'in-progress').length})
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs sm:text-sm py-2 sm:py-1.5">
                  <span className="hidden sm:inline">Done </span>({filteredTasks.filter(t => t.status === 'completed').length})
                </TabsTrigger>
              </TabsList>

              {selectedProjectId && projects.find(p => p.id === selectedProjectId) && <div className={`mt-4 w-full bg-muted p-1 rounded-md border ${tasks.some(t => t.projectId === selectedProjectId && t.timer.isRunning) ? 'border-glow-pulse' : ''}`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span style={{
                      color: projects.find(p => p.id === selectedProjectId)?.color
                    }}>📁</span>
                    <span className="font-semibold text-base" style={{
                      color: projects.find(p => p.id === selectedProjectId)?.color
                    }}>
                      {projects.find(p => p.id === selectedProjectId)?.name}
                    </span>
                  </div>
                </div>}

              <TabsContent value="all" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="todo" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.filter(t => t.status === 'todo').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="in-progress" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.filter(t => t.status === 'in-progress').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="completed" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.filter(t => t.status === 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>
            </Tabs> : viewMode === 'gantt' ? <div className="mt-6">
              <GanttChart tasks={filteredTasks} />
            </div> : <div className="mt-6">
              <TimeTrackingChart tasks={filteredTasks} projects={projects} />
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
    </SidebarProvider>;
};
export default Index;