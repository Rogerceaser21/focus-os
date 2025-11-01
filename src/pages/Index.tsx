import { useState } from 'react';
import { Task } from '@/types/task';
import { TaskCard } from '@/components/TaskCard';
import { GanttChart } from '@/components/GanttChart';
import { AddTaskDialog } from '@/components/AddTaskDialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Search, LayoutList, GanttChartSquare } from 'lucide-react';

// Mock data
const initialTasks: Task[] = [
  {
    id: '1',
    title: 'Design landing page mockups',
    description: 'Create high-fidelity mockups for the new landing page',
    priority: 'high',
    status: 'in-progress',
    startDate: new Date(2025, 10, 1),
    endDate: new Date(2025, 10, 5),
    dueDate: new Date(2025, 10, 5),
    timer: { totalSeconds: 3600, isRunning: false }
  },
  {
    id: '2',
    title: 'Implement authentication flow',
    description: 'Set up user registration and login with email',
    priority: 'urgent',
    status: 'todo',
    startDate: new Date(2025, 10, 6),
    endDate: new Date(2025, 10, 12),
    dueDate: new Date(2025, 10, 12),
    timer: { totalSeconds: 0, isRunning: false }
  },
  {
    id: '3',
    title: 'Write API documentation',
    description: 'Document all REST API endpoints',
    priority: 'medium',
    status: 'todo',
    startDate: new Date(2025, 10, 8),
    endDate: new Date(2025, 10, 15),
    dueDate: new Date(2025, 10, 15),
    timer: { totalSeconds: 1800, isRunning: false }
  },
  {
    id: '4',
    title: 'Update dependencies',
    description: 'Upgrade all npm packages to latest versions',
    priority: 'low',
    status: 'completed',
    dueDate: new Date(2025, 10, 3),
    timer: { totalSeconds: 900, isRunning: false }
  }
];

const Index = () => {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'gantt'>('list');

  const filteredTasks = tasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddTask = (newTask: Task) => {
    setTasks(prev => [...prev, newTask]);
  };

  const handleUpdateTask = (updatedTask: Task) => {
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Task Manager</h1>
          <p className="text-muted-foreground">Organize your work with timers and visual planning</p>
        </div>

        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              onClick={() => setViewMode('list')}
              className="gap-2"
            >
              <LayoutList className="h-4 w-4" />
              List
            </Button>
            <Button
              variant={viewMode === 'gantt' ? 'default' : 'outline'}
              onClick={() => setViewMode('gantt')}
              className="gap-2"
            >
              <GanttChartSquare className="h-4 w-4" />
              Gantt
            </Button>
            <AddTaskDialog onAddTask={handleAddTask} />
          </div>
        </div>

        {/* Main Content */}
        {viewMode === 'list' ? (
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All Tasks ({filteredTasks.length})</TabsTrigger>
              <TabsTrigger value="todo">To Do ({filteredTasks.filter(t => t.status === 'todo').length})</TabsTrigger>
              <TabsTrigger value="in-progress">In Progress ({filteredTasks.filter(t => t.status === 'in-progress').length})</TabsTrigger>
              <TabsTrigger value="completed">Completed ({filteredTasks.filter(t => t.status === 'completed').length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-6">
              {filteredTasks.map(task => (
                <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />
              ))}
            </TabsContent>

            <TabsContent value="todo" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-6">
              {filteredTasks.filter(t => t.status === 'todo').map(task => (
                <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />
              ))}
            </TabsContent>

            <TabsContent value="in-progress" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-6">
              {filteredTasks.filter(t => t.status === 'in-progress').map(task => (
                <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />
              ))}
            </TabsContent>

            <TabsContent value="completed" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-6">
              {filteredTasks.filter(t => t.status === 'completed').map(task => (
                <TaskCard key={task.id} task={task} onUpdate={handleUpdateTask} />
              ))}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="mt-6">
            <GanttChart tasks={filteredTasks} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
