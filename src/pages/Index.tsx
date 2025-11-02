import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Task } from '@/types/task';
import { TaskCard } from '@/components/TaskCard';
import { TaskListItem } from '@/components/TaskListItem';
import { GanttChart } from '@/components/GanttChart';
import { AddTaskDialog } from '@/components/AddTaskDialog';
import { ProjectSidebar } from '@/components/ProjectSidebar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Search, LayoutList, LayoutGrid, GanttChartSquare, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import DarkVeil from '@/components/DarkVeil';
import HeroSection from '@/components/HeroSection';
import { startOfDay, endOfDay } from 'date-fns';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
const Index = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    signOut
  } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'gantt'>('grid');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSpecialList, setSelectedSpecialList] = useState<'unassigned' | 'today' | null>(null);
  const [projectRefreshTrigger, setProjectRefreshTrigger] = useState(0);
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);
  useEffect(() => {
    if (user) {
      fetchTasks();
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
      return;
    }
    fetchTasks();
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
  return <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen flex w-full relative">
        <DarkVeil hueShift={108} noiseIntensity={0} scanlineIntensity={0} speed={0.3} scanlineFrequency={0} warpAmount={0.4} resolutionScale={0.6} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />

        <div className="flex flex-1 relative w-full flex-col">
          {/* Brain Dump - Always visible */}
          <div className="w-full relative z-[5]">
            <HeroSection onTasksCreated={() => {
            fetchTasks();
            setProjectRefreshTrigger(prev => prev + 1);
          }} />
          </div>

          <div className="flex flex-1 relative w-full">
            {/* Sidebar */}
            <ProjectSidebar selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onSelectSpecialList={setSelectedSpecialList} selectedSpecialList={selectedSpecialList} projectRefreshTrigger={projectRefreshTrigger} />

            {/* Main Content */}
            <div className="flex-1 relative z-10 w-full">
              <div className="container mx-auto py-4 sm:py-6 lg:py-8 px-2 sm:px-4">
                {/* Header */}
                <div className="mb-4 sm:mb-6 lg:mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
                    <SidebarTrigger className="relative z-10 min-h-[44px] min-w-[44px]" />
                    <div className="flex-1">
                      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-1 sm:mb-2 drop-shadow-lg">
                        Brain Manager
                      </h1>
                      <p className="text-sm sm:text-base text-muted-foreground drop-shadow hidden sm:block">
                        Organize your work with timers and visual planning
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" onClick={handleSignOut} className="gap-2 self-end sm:self-auto min-h-[44px]">
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

              <TabsContent value="all" className="flex flex-col gap-2 mt-6">
                {filteredTasks.map(task => <TaskListItem key={task.id} task={task} onUpdate={handleUpdateTask} className="py-0" />)}
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

              <TabsContent value="all" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="todo" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.filter(t => t.status === 'todo').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>

              <TabsContent value="in-progress" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.filter(t => t.status === 'in-progress').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} className="rounded-sm" />)}
              </TabsContent>

              <TabsContent value="completed" className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
                {filteredTasks.filter(t => t.status === 'completed').map(task => <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />)}
              </TabsContent>
            </Tabs> : <div className="mt-6">
              <GanttChart tasks={filteredTasks} />
            </div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>;
};
export default Index;