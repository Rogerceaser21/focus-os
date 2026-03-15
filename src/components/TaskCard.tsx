import { useState, useEffect, useRef } from 'react';
import { Task, Project } from '@/types/task';
import { getImageDisplayUrl } from '@/lib/taskImageStorage';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Play, Pause, Clock, Calendar, Share2, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { ShareStatusPopover } from '@/components/ShareStatusPopover';
import { useTimer } from '@/hooks/useTimer';
import { useTimerAlert } from '@/hooks/useTimerAlert';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { format } from 'date-fns';
import { LinkifiedText } from '@/components/LinkifiedText';

interface TaskCardProps {
  task: Task;
  onUpdate: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onAssignTask?: (task: Task) => void;
  onRequestChanges?: (task: Task) => void;
  onDismissChangeRequest?: (task: Task) => void;
  projects?: Project[];
}

const priorityColors = {
  low: 'bg-secondary/70 text-foreground border-border',
  medium: 'bg-accent/20 text-foreground border-accent/30',
  high: 'bg-primary/15 text-foreground border-primary/25',
  urgent: 'bg-destructive/15 text-foreground border-destructive/25',
};

const statusColors = {
  todo: 'bg-muted text-foreground border-border',
  'in-progress': 'bg-primary/15 text-foreground border-primary/25',
  completed: 'bg-secondary text-foreground border-border',
};

export const TaskCard = ({ task, onUpdate, onEditTask, onAssignTask, onRequestChanges, onDismissChangeRequest, projects = [] }: TaskCardProps) => {
  const { timer, displaySeconds, startTimer, stopTimer, formatTime } = useTimer(task.timer);
  const { preferences } = useUserPreferences();
  useTimerAlert({
    isRunning: timer.isRunning,
    displaySeconds,
    intervalMinutes: preferences?.timer_alert_interval_minutes ?? 45,
    enabled: preferences?.notify_timer ?? false,
    taskTitle: task.title,
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [editedDescription, setEditedDescription] = useState(task.description || '');
  const recentlyBlurredRef = useRef(false);

  // Sync local state when task prop changes, skip briefly after blur to avoid realtime race
  useEffect(() => {
    if (!isEditingTitle && !recentlyBlurredRef.current) {
      setEditedTitle(task.title);
    }
  }, [task.title]);

  useEffect(() => {
    if (!isEditingDescription && !recentlyBlurredRef.current) {
      setEditedDescription(task.description || '');
    }
  }, [task.description]);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [isFading, setIsFading] = useState(false);

  const handleTimerUpdate = (action: 'start' | 'stop') => {
    if (action === 'start') {
      const startTime = Date.now();
      startTimer();
      onUpdate({ ...task, status: 'in-progress', timer: { ...timer, isRunning: true, startTime } });
    } else if (action === 'stop') {
      const elapsed = timer.startTime 
        ? Math.floor((Date.now() - timer.startTime) / 1000)
        : 0;
      stopTimer();
      onUpdate({ 
        ...task, 
        timer: { 
          totalSeconds: timer.totalSeconds + elapsed, 
          isRunning: false, 
          startTime: undefined 
        } 
      });
    }
  };

  const handleTitleBlur = () => {
    setIsEditingTitle(false);
    if (editedTitle.trim() && editedTitle !== task.title) {
      recentlyBlurredRef.current = true;
      onUpdate({ ...task, title: editedTitle.trim() });
      setTimeout(() => { recentlyBlurredRef.current = false; }, 2000);
    } else {
      setEditedTitle(task.title);
    }
  };

  const handleDescriptionBlur = () => {
    setIsEditingDescription(false);
    if (editedDescription !== task.description) {
      recentlyBlurredRef.current = true;
      onUpdate({ ...task, description: editedDescription.trim() || undefined });
      setTimeout(() => { recentlyBlurredRef.current = false; }, 2000);
    }
  };

  const handleDateClick = () => {
    onEditTask?.(task);
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
    <Card variant="glass" className={`p-2.5 hover:border-primary/50 ${timer.isRunning ? 'border-glow-pulse' : ''} ${isFading ? 'animate-fade-out' : ''}`}>
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
                    className={`font-semibold text-foreground truncate cursor-text hover:bg-accent/50 rounded px-2 py-1 -mx-2 transition-colors ${task.status === 'completed' || isFading || (task.completedByEmail && (!task.sharedRecipients || task.sharedRecipients.length === 0)) ? 'line-through opacity-50' : ''}`}
                    onClick={() => setIsEditingTitle(true)}
                  >
                    {editedTitle}
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
              {editedDescription ? (
                <LinkifiedText text={editedDescription} />
              ) : (
                'Click to add description...'
              )}
            </p>
          )}

        {task.images && task.images.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {task.images.slice(0, 4).map((img, idx) => (
              <img 
                key={idx}
                src={img} 
                alt={`Task attachment ${idx + 1}`} 
                className="w-full h-24 object-cover rounded-md"
              />
            ))}
            {task.images.length > 4 && (
              <div className="flex items-center justify-center bg-muted rounded-md text-sm text-muted-foreground">
                +{task.images.length - 4} more
              </div>
            )}
          </div>
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
            <span>{formatTime(displaySeconds)}</span>
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
          {!projects?.find(p => p.id === task.projectId)?.isShared && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAssignTask?.(task)}
              className="gap-1 ml-auto text-muted-foreground hover:text-primary"
              title="Share Task"
            >
              <Share2 className="h-3 w-3" />
            </Button>
          )}
          {task.assignedToEmail && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={`Shared by ${task.assignedToEmail}`}>
              Shared by {task.assignedToEmail}
            </span>
          )}
          {task.sharedRecipients && task.sharedRecipients.length > 0 ? (
            <div className="ml-auto">
              <ShareStatusPopover
                recipients={task.sharedRecipients}
                itemType="Task"
                onRequestChanges={(email) => onRequestChanges?.({ ...task, completedByEmail: email })}
                allCompleted={task.sharedRecipients.every(r => r.status === 'completed')}
                onMoveAllToDone={() => onUpdate({ ...task, status: 'completed' })}
              />
            </div>
          ) : task.completedByEmail && task.status !== 'completed' ? (
            <>
              <Badge variant="outline" className="bg-green-500/15 text-green-400 border-green-500/30 text-xs ml-auto">
                ✅ Completed by {task.completedByEmail}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-6 px-2 border-green-500/30 text-green-400 hover:bg-green-500/20"
                onClick={() => onUpdate({ ...task, status: 'completed' })}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Move to Done
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-6 px-2 border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                onClick={() => onRequestChanges?.(task)}
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Changes Needed
              </Button>
            </>
          ) : null}

          {/* Change request banner */}
          {task.changeRequestMessage && (
            <div className="flex items-start gap-2 w-full p-2 rounded-md bg-orange-500/10 border border-orange-500/30">
              <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-orange-400">Changes Requested</p>
                <p className="text-xs text-muted-foreground mt-0.5">{task.changeRequestMessage}</p>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => onDismissChangeRequest?.(task)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
