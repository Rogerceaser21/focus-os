import { Task, Project } from '@/types/task';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, addMonths } from 'date-fns';
import { useMemo, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ListTodo } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface GanttChartProps {
  tasks: Task[];
  allTasks?: Task[];
  projectName?: string;
  projectId?: string | null;
  projects?: Project[];
  onTaskClick?: (task: Task) => void;
  onAddTask?: (task: Task) => void;
  onOpenAddTask?: () => void;
}

export const GanttChart = ({ tasks, allTasks = [], projectName = 'Gantt Chart', projectId, projects = [], onTaskClick, onAddTask, onOpenAddTask }: GanttChartProps) => {
  const isMobile = useIsMobile();
  const [existingSheetOpen, setExistingSheetOpen] = useState(false);

  const tasksWithoutDates = allTasks.filter(t => (!t.startDate || !t.endDate) && t.status !== 'completed');
  const tasksWithDates = tasks
    .filter(t => t.startDate && t.endDate)
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime());
  
  const months = useMemo(() => {
    const today = new Date();
    return [
      { start: startOfMonth(today), end: endOfMonth(today) },
      { start: startOfMonth(addMonths(today, 1)), end: endOfMonth(addMonths(today, 1)) },
      { start: startOfMonth(addMonths(today, 2)), end: endOfMonth(addMonths(today, 2)) },
    ].map(({ start, end }) => ({
      start,
      end,
      days: eachDayOfInterval({ start, end })
    }));
  }, []);

  const today = new Date();

  const getTaskPosition = (task: Task, days: Date[], monthStart: Date, monthEnd: Date) => {
    if (!task.startDate || !task.endDate) return null;
    
    // Clip task dates to month boundaries
    const clippedStart = task.startDate < monthStart ? monthStart : task.startDate;
    const clippedEnd = task.endDate > monthEnd ? monthEnd : task.endDate;
    
    const totalDays = days.length;
    const startIndex = days.findIndex(day => isSameDay(day, clippedStart));
    const endIndex = days.findIndex(day => isSameDay(day, clippedEnd));
    
    if (startIndex === -1 || endIndex === -1) return null;
    
    const left = (startIndex / totalDays) * 100;
    const width = ((endIndex - startIndex + 1) / totalDays) * 100;
    
    return { left, width };
  };

  const getTasksForMonth = (monthStart: Date, monthEnd: Date) => {
    return tasksWithDates.filter(task => {
      if (!task.startDate || !task.endDate) return false;
      return isWithinInterval(task.startDate, { start: monthStart, end: monthEnd }) ||
             isWithinInterval(task.endDate, { start: monthStart, end: monthEnd }) ||
             (task.startDate < monthStart && task.endDate > monthEnd);
    });
  };

  const taskColors = [
    { bg: 'bg-blue-500', border: 'border-blue-500' },
    { bg: 'bg-purple-500', border: 'border-purple-500' },
    { bg: 'bg-green-500', border: 'border-green-500' },
    { bg: 'bg-orange-500', border: 'border-orange-500' },
    { bg: 'bg-pink-500', border: 'border-pink-500' },
    { bg: 'bg-cyan-500', border: 'border-cyan-500' },
    { bg: 'bg-yellow-500', border: 'border-yellow-500' },
    { bg: 'bg-indigo-500', border: 'border-indigo-500' },
    { bg: 'bg-red-500', border: 'border-red-500' },
    { bg: 'bg-teal-500', border: 'border-teal-500' }
  ];

  if (tasksWithDates.length === 0) {
    return (
      <Card className="p-8 bg-card/80 backdrop-blur-sm border-2">
        <p className="text-center text-muted-foreground">
          No tasks with dates to display in Gantt view
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-40">

      {months.map((month, monthIndex) => {
        const monthTasks = getTasksForMonth(month.start, month.end);
        
        return (
          <Card key={monthIndex} className="p-6 overflow-x-auto bg-card/80 backdrop-blur-sm border-2">
            {/* Title row with buttons */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {projectName} - {format(month.start, 'MMMM yyyy')}
              </h3>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-primary border-2" onClick={() => onOpenAddTask?.()}>
                  <Plus className="h-3 w-3" />
                  New
                </Button>
                {isMobile ? (
                  <>
                    <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-accent border-2" disabled={tasksWithoutDates.length === 0} onClick={() => setExistingSheetOpen(true)}>
                      <ListTodo className="h-3 w-3" />
                      Existing
                    </Button>
                    <Sheet open={existingSheetOpen} onOpenChange={setExistingSheetOpen}>
                      <SheetContent side="bottom" className="max-h-[60vh]">
                        <SheetHeader>
                          <SheetTitle>Unscheduled Tasks</SheetTitle>
                        </SheetHeader>
                        <div className="overflow-y-auto mt-3 space-y-1">
                          {tasksWithoutDates.map(task => (
                            <button
                              key={task.id}
                              className="w-full text-left px-3 py-2.5 rounded-md border border-accent/50 text-sm truncate hover:bg-accent/10 transition-colors"
                              onClick={() => { onTaskClick?.(task); setExistingSheetOpen(false); }}
                            >
                              {task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}
                            </button>
                          ))}
                        </div>
                      </SheetContent>
                    </Sheet>
                  </>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-accent border-2" disabled={tasksWithoutDates.length === 0}>
                        <ListTodo className="h-3 w-3" />
                        Existing
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-64 overflow-y-auto border-accent/50 border">
                      {tasksWithoutDates.map(task => (
                        <DropdownMenuItem key={task.id} onClick={() => onTaskClick?.(task)} className="border-b border-accent/20 last:border-b-0">
                          {task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            
            {/* Timeline Header */}
            <div className="mb-4">
              <div className="flex relative h-12 border-b">
                {month.days.map((day, idx) => {
                  const isToday = isSameDay(day, today);
                  return (
                    <div 
                      key={idx} 
                      className={`flex-1 text-center text-xs py-2 border-r min-w-0 ${isToday ? 'bg-primary/10' : ''}`}
                    >
                      <div className="font-medium truncate">{format(day, 'd')}</div>
                      <div className="text-muted-foreground hidden min-[1100px]:block truncate">{format(day, 'EEE')}</div>
                    </div>
                  );
                })}
                {/* Today indicator */}
                {month.days.findIndex(day => isSameDay(day, today)) !== -1 && (
                  <div 
                    className="absolute top-0 bottom-0 w-0.5 bg-accent z-10"
                    style={{ 
                      left: `${(month.days.findIndex(day => isSameDay(day, today)) / month.days.length) * 100}%` 
                    }}
                  />
                )}
                </div>
              </div>
            </div>

            {/* Tasks */}
            {monthTasks.length > 0 ? (
              <div className="space-y-3">
                {monthTasks.map((task, index) => {
                  const position = getTaskPosition(task, month.days, month.start, month.end);
                  if (!position) return null;

                  const taskColor = taskColors[tasksWithDates.findIndex(t => t.id === task.id) % taskColors.length];

                  return (
                    <div key={task.id} className="relative h-12 border-b border-border/50">
                      <div 
                        className={`absolute left-0 top-2 bottom-2 w-48 truncate text-sm font-medium border-b-2 ${taskColor.border} cursor-pointer hover:opacity-80 transition-opacity ${task.status === 'completed' ? 'line-through opacity-50' : ''}`}
                        onClick={() => onTaskClick?.(task)}
                      >
                        {task.title}
                      </div>
                      <div className="relative h-full ml-48">
                        <div 
                          className={`absolute top-2 bottom-2 rounded ${taskColor.bg} hover:opacity-100 transition-opacity cursor-pointer ${task.status === 'completed' ? 'opacity-30' : 'opacity-80'}`}
                          style={{ 
                            left: `${position.left}%`, 
                            width: `${position.width}%` 
                          }}
                          title={`${task.title} - ${format(task.startDate!, 'MMM d')} to ${format(task.endDate!, 'MMM d')}`}
                          onClick={() => onTaskClick?.(task)}
                        >
                          {task.status === 'completed' && (
                            <div className="absolute inset-y-1/2 left-0 right-0 h-0.5 bg-foreground/60" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                No tasks scheduled for this month
              </p>
            )}
          </Card>
        );
      })}

    </div>
  );
};
