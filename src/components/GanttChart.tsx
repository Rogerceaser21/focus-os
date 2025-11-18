import { Task, Project } from '@/types/task';
import { Card } from '@/components/ui/card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval } from 'date-fns';
import { useMemo } from 'react';

interface GanttChartProps {
  tasks: Task[];
  projectName?: string;
}

export const GanttChart = ({ tasks, projectName = 'Gantt Chart' }: GanttChartProps) => {
  const tasksWithDates = tasks.filter(t => t.startDate && t.endDate);
  
  const { days, monthStart, monthEnd } = useMemo(() => {
    const today = new Date();
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    return { days, monthStart, monthEnd };
  }, []);

  const today = new Date();

  const getTaskPosition = (task: Task) => {
    if (!task.startDate || !task.endDate) return null;
    
    const totalDays = days.length;
    const startIndex = days.findIndex(day => isSameDay(day, task.startDate!));
    const endIndex = days.findIndex(day => isSameDay(day, task.endDate!));
    
    if (startIndex === -1 || endIndex === -1) return null;
    
    const left = (startIndex / totalDays) * 100;
    const width = ((endIndex - startIndex + 1) / totalDays) * 100;
    
    return { left, width };
  };

  const taskColors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-green-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-yellow-500',
    'bg-indigo-500',
    'bg-red-500',
    'bg-teal-500'
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
    <Card className="p-6 overflow-x-auto bg-card/80 backdrop-blur-sm border-2">
      <h3 className="text-lg font-semibold mb-4 text-foreground text-center">{projectName} - {format(monthStart, 'MMMM yyyy')}</h3>
      
      {/* Timeline Header */}
      <div className="mb-4">
        <div className="flex relative h-12 border-b ml-48">
          {days.map((day, idx) => {
            const isToday = isSameDay(day, today);
            return (
              <div 
                key={idx} 
                className={`flex-1 text-center text-xs py-2 border-r ${isToday ? 'bg-primary/10' : ''}`}
              >
                <div className="font-medium">{format(day, 'd')}</div>
                <div className="text-muted-foreground">{format(day, 'EEE')}</div>
              </div>
            );
          })}
          {/* Today indicator */}
          {days.findIndex(day => isSameDay(day, today)) !== -1 && (
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-accent z-10"
              style={{ 
                left: `${(days.findIndex(day => isSameDay(day, today)) / days.length) * 100}%` 
              }}
            />
          )}
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-3">
        {tasksWithDates.map((task, index) => {
          const position = getTaskPosition(task);
          if (!position) return null;

          const taskColor = taskColors[index % taskColors.length];

          return (
            <div key={task.id} className="relative h-12 border-b border-border/50">
              <div className="absolute left-0 top-2 bottom-2 w-48 truncate text-sm font-medium">
                {task.title}
              </div>
              <div className="relative h-full ml-48">
                <div 
                  className={`absolute top-2 bottom-2 rounded ${taskColor} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                  style={{ 
                    left: `${position.left}%`, 
                    width: `${position.width}%` 
                  }}
                  title={`${task.title} - ${format(task.startDate!, 'MMM d')} to ${format(task.endDate!, 'MMM d')}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
