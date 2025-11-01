import { Task } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Pause, RotateCcw, Clock, Calendar } from 'lucide-react';
import { useTimer } from '@/hooks/useTimer';
import { format } from 'date-fns';

interface TaskCardProps {
  task: Task;
  onUpdate: (task: Task) => void;
}

const priorityColors = {
  low: 'bg-muted/50 text-muted-foreground border-muted-foreground/20',
  medium: 'bg-info/20 text-info border-info/30',
  high: 'bg-warning/20 text-warning border-warning/30',
  urgent: 'bg-destructive/20 text-destructive border-destructive/30'
};

const statusColors = {
  'todo': 'bg-muted/50 text-muted-foreground border-muted-foreground/20',
  'in-progress': 'bg-primary/20 text-primary border-primary/30',
  'completed': 'bg-success/20 text-success border-success/30'
};

export const TaskCard = ({ task, onUpdate }: TaskCardProps) => {
  const { timer, startTimer, stopTimer, resetTimer, formatTime } = useTimer(task.timer);

  const handleTimerUpdate = (action: 'start' | 'stop' | 'reset') => {
    if (action === 'start') startTimer();
    else if (action === 'stop') stopTimer();
    else if (action === 'reset') resetTimer();
    
    onUpdate({ ...task, timer });
  };

  return (
    <Card className="p-4 bg-card/80 backdrop-blur-sm border-2 border-border hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/10">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate">{task.title}</h3>
            {task.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Badge variant="outline" className={priorityColors[task.priority]}>
              {task.priority}
            </Badge>
            <Badge variant="outline" className={statusColors[task.status]}>
              {task.status}
            </Badge>
          </div>
        </div>

        {task.imageUrl && (
          <img 
            src={task.imageUrl} 
            alt="Task attachment" 
            className="w-full h-32 object-cover rounded-md"
          />
        )}

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {task.dueDate && (
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>{format(task.dueDate, 'MMM d, yyyy')}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>{formatTime(timer.totalSeconds)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t">
          {!timer.isRunning ? (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => handleTimerUpdate('start')}
              className="gap-2"
            >
              <Play className="h-3 w-3" />
              Start
            </Button>
          ) : (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => handleTimerUpdate('stop')}
              className="gap-2"
            >
              <Pause className="h-3 w-3" />
              Pause
            </Button>
          )}
          <Button 
            size="sm" 
            variant="ghost"
            onClick={() => handleTimerUpdate('reset')}
            className="gap-2"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
      </div>
    </Card>
  );
};
