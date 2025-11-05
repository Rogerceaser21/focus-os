import { useState } from 'react';
import { Task } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Play, Pause, Clock, Calendar } from 'lucide-react';
import { useTimer } from '@/hooks/useTimer';
import { format } from 'date-fns';
import { EditTaskDialog } from '@/components/EditTaskDialog';
import { LinkifiedText } from '@/components/LinkifiedText';

interface TaskCardProps {
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
  'todo': 'bg-muted/50 text-muted-foreground border-muted-foreground/20',
  'in-progress': 'bg-primary/20 text-primary border-primary/30',
  'completed': 'bg-success/20 text-success border-success/30'
};

export const TaskCard = ({ task, onUpdate }: TaskCardProps) => {
  const { timer, startTimer, stopTimer, formatTime } = useTimer(task.timer);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [editedDescription, setEditedDescription] = useState(task.description || '');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [isFading, setIsFading] = useState(false);

  const handleTimerUpdate = (action: 'start' | 'stop') => {
    if (action === 'start') {
      startTimer();
      onUpdate({ ...task, status: 'in-progress', timer });
    } else if (action === 'stop') {
      stopTimer();
      onUpdate({ ...task, timer });
    }
  };

  const handleTitleBlur = () => {
    setIsEditingTitle(false);
    if (editedTitle.trim() && editedTitle !== task.title) {
      onUpdate({ ...task, title: editedTitle.trim() });
    } else {
      setEditedTitle(task.title);
    }
  };

  const handleDescriptionBlur = () => {
    setIsEditingDescription(false);
    if (editedDescription !== task.description) {
      onUpdate({ ...task, description: editedDescription.trim() || undefined });
    }
  };

  const handleDateClick = () => {
    setShowEditDialog(true);
  };

  const handleCheckboxChange = (checked: boolean) => {
    if (checked) {
      setIsFading(true);
      
      setTimeout(() => {
        onUpdate({
          ...task,
          status: 'completed'
        });
        setIsFading(false);
      }, 1000);
    } else {
      onUpdate({
        ...task,
        status: 'todo'
      });
    }
  };

  return (
    <>
      <Card className={`p-2.5 bg-card/80 backdrop-blur-sm border-2 border-border hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/10 ${timer.isRunning ? 'border-glow-pulse' : ''} ${isFading ? 'animate-fade-out' : ''}`}>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <Checkbox
              checked={task.status === 'completed'}
              onCheckedChange={handleCheckboxChange}
              className="mt-1 shrink-0"
            />
            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                {isEditingTitle ? (
                  <Input
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onBlur={handleTitleBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                    autoFocus
                    className="font-semibold h-auto py-1 px-2 -mx-2"
                  />
                ) : (
                  <h3 
                    className={`font-semibold text-foreground truncate cursor-text hover:bg-accent/50 rounded px-2 py-1 -mx-2 transition-colors ${task.status === 'completed' || isFading ? 'line-through opacity-50' : ''}`}
                    onClick={() => setIsEditingTitle(true)}
                  >
                    {task.title}
                  </h3>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Popover open={isPriorityOpen} onOpenChange={setIsPriorityOpen}>
                  <PopoverTrigger asChild>
                    <button 
                      className="inline-flex"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge variant="outline" className={`${priorityColors[task.priority]} cursor-pointer hover:opacity-80`}>
                        {task.priority}
                      </Badge>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="center" side="bottom" className="w-32 p-2 bg-card border-border z-50" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-1">
                      {(['low', 'medium', 'high', 'urgent'] as const).map((priority) => (
                        <Badge
                          key={priority}
                          variant="outline"
                          className={`${priorityColors[priority]} cursor-pointer justify-center hover:opacity-80`}
                          onClick={() => {
                            onUpdate({ ...task, priority });
                            setIsPriorityOpen(false);
                          }}
                        >
                          {priority}
                        </Badge>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Badge variant="outline" className={statusColors[task.status]}>
                  {task.status}
                </Badge>
              </div>
            </div>
          </div>

          {isEditingDescription ? (
            <Textarea
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              autoFocus
              className="text-sm min-h-[60px] py-1 px-2 -mx-2 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-muted-foreground resize-none w-full"
            />
          ) : (
            <p 
              className="text-sm text-muted-foreground line-clamp-2 cursor-text hover:bg-accent/50 rounded px-2 py-0.5 -mx-2 transition-colors"
              onClick={() => setIsEditingDescription(true)}
            >
              {task.description ? (
                <LinkifiedText text={task.description} />
              ) : (
                'Click to add description...'
              )}
            </p>
          )}

        {task.imageUrl && (
          <img 
            src={task.imageUrl} 
            alt="Task attachment" 
            className="w-full h-32 object-cover rounded-md"
          />
        )}

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {task.dueDate && (
            <div 
              className="flex items-center gap-1 cursor-pointer hover:bg-accent/50 rounded px-2 py-0.5 -mx-2 transition-colors"
              onClick={handleDateClick}
            >
              <Calendar className="h-4 w-4" />
              <span>{format(task.dueDate, 'MMM d, yyyy')}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>{formatTime(timer.totalSeconds)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 border-t">
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
        </div>
      </div>
    </Card>
    
    <EditTaskDialog 
      task={task}
      open={showEditDialog}
      onOpenChange={setShowEditDialog}
      onUpdateTask={onUpdate}
    />
    </>
  );
};
