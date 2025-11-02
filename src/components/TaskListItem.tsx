import { Task } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Play, Pause, Calendar } from 'lucide-react';
import { useTimer } from '@/hooks/useTimer';
import { EditTaskDialog } from './EditTaskDialog';
import { useState } from 'react';
import { format } from 'date-fns';

interface TaskListItemProps {
  task: Task;
  onUpdate: (task: Task) => void;
}

const priorityColors = {
  low: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  medium: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  urgent: 'bg-red-500/20 text-red-300 border-red-500/30',
};

const statusColors = {
  'todo': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'in-progress': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'completed': 'bg-green-500/20 text-green-300 border-green-500/30',
};

export const TaskListItem = ({ task, onUpdate }: TaskListItemProps) => {
  const { timer, startTimer, stopTimer, formatTime } = useTimer(task.timer);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleStartStop = () => {
    if (timer.isRunning) {
      stopTimer();
      onUpdate({ ...task, timer: { ...timer, isRunning: false, startTime: undefined } });
    } else {
      startTimer();
      onUpdate({ 
        ...task, 
        status: 'in-progress',
        timer: { ...timer, isRunning: true, startTime: Date.now() } 
      });
    }
  };

  const handleCheckboxChange = (checked: boolean) => {
    onUpdate({
      ...task,
      status: checked ? 'completed' : 'todo'
    });
  };

  return (
    <>
      <div 
        className="group w-full border border-white/10 bg-card/50 backdrop-blur-sm rounded-lg p-3 sm:p-4 hover:border-primary/50 transition-all duration-300 cursor-pointer"
        onClick={() => setIsEditOpen(true)}
      >
        {/* Mobile/Tablet Layout */}
        <div className="flex flex-col gap-3 lg:hidden">
          {/* Checkbox and Title */}
          <div className="flex items-start gap-3" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={task.status === 'completed'}
              onCheckedChange={handleCheckboxChange}
              className="mt-1 shrink-0"
            />
            <h3 className="font-semibold text-base sm:text-lg text-foreground line-clamp-2">
              {task.title}
            </h3>
          </div>
          
          {/* Description */}
          <p className="text-sm text-muted-foreground line-clamp-2">
            {task.description || 'No description'}
          </p>

          {/* Badges Row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={priorityColors[task.priority]}>
              {task.priority}
            </Badge>
            <Badge className={statusColors[task.status]}>
              {task.status}
            </Badge>
            {task.dueDate && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4" />
                <span>{format(new Date(task.dueDate), 'MMM d')}</span>
              </div>
            )}
          </div>

          {/* Timer and Controls */}
          <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <span className="text-base font-mono text-muted-foreground">
              {formatTime(timer.totalSeconds)}
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleStartStop}
              className="h-10 w-10 p-0 touch-target"
            >
              {timer.isRunning ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Desktop Layout */}
        <div className="hidden lg:flex lg:items-center gap-4 w-full">
          {/* Checkbox */}
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={task.status === 'completed'}
              onCheckedChange={handleCheckboxChange}
              className="shrink-0"
            />
          </div>

          {/* Left: Title and Description */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate mb-1">
              {task.title}
            </h3>
            <p className="text-sm text-muted-foreground truncate">
              {task.description || 'No description'}
            </p>
          </div>

          {/* Middle: Priority and Status */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge className={priorityColors[task.priority]}>
              {task.priority}
            </Badge>
            <Badge className={statusColors[task.status]}>
              {task.status}
            </Badge>
          </div>

          {/* Right: Due Date, Timer, and Controls */}
          <div className="flex items-center gap-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {task.dueDate && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4" />
                <span>{format(new Date(task.dueDate), 'MMM d')}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-muted-foreground min-w-[60px]">
                {formatTime(timer.totalSeconds)}
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleStartStop}
                className="h-8 w-8 p-0"
              >
                {timer.isRunning ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <EditTaskDialog
        task={task}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        onUpdateTask={onUpdate}
      />
    </>
  );
};
