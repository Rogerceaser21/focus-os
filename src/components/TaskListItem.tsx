import { Task, Project } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Play, Pause, Calendar, Clock, Image, Share2, CheckCircle2, Pencil, AlertTriangle, X } from 'lucide-react';
import { ShareStatusPopover } from '@/components/ShareStatusPopover';
import { useTimer } from '@/hooks/useTimer';
import { useTimerAlert } from '@/hooks/useTimerAlert';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useIsMobile } from '@/hooks/use-mobile';
import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { LinkifiedText } from '@/components/LinkifiedText';

interface TaskListItemProps {
  task: Task;
  onUpdate: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onAssignTask?: (task: Task) => void;
  onRequestChanges?: (task: Task) => void;
  onDismissChangeRequest?: (task: Task) => void;
  globalViewMode: 'full' | 'compact';
  isIndividuallyExpanded: boolean;
  onTaskClick: () => void;
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

export const TaskListItem = ({ task, onUpdate, onEditTask, onAssignTask, onRequestChanges, onDismissChangeRequest, globalViewMode, isIndividuallyExpanded, onTaskClick, projects = [] }: TaskListItemProps) => {
  const { timer, displaySeconds, startTimer, stopTimer, formatTime } = useTimer(task.timer);
  const { preferences } = useUserPreferences();
  useTimerAlert({
    isRunning: timer.isRunning,
    displaySeconds,
    intervalMinutes: preferences?.timer_alert_interval_minutes ?? 45,
    enabled: preferences?.notify_timer ?? false,
    taskTitle: task.title,
  });
  const isMobile = useIsMobile();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [editedDescription, setEditedDescription] = useState(task.description || '');
  const recentlyBlurredRef = useRef(false);

  // Sync local state when task prop changes (e.g. after DB round-trip)
  // Skip sync briefly after blur to avoid realtime race condition
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
  const [isFading, setIsFading] = useState(false);
  const [isChecked, setIsChecked] = useState(task.status === 'completed');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isTitleExpanded, setIsTitleExpanded] = useState(false);
  const isExpanded = isIndividuallyExpanded || globalViewMode === 'full';
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const descriptionContainerRef = useRef<HTMLParagraphElement>(null);
  const titleContainerRef = useRef<HTMLHeadingElement>(null);
  const titleDisplayRef = useRef<HTMLHeadingElement>(null);
  const descriptionDisplayRef = useRef<HTMLParagraphElement>(null);


  // Auto-expand title textarea (matches description behavior)
  useEffect(() => {
    if (isEditingTitle && titleRef.current && editedTitle.trim().length > 0) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
    }
  }, [editedTitle, isEditingTitle]);

  // Auto-expand description textarea (matches desktop behavior)
  useEffect(() => {
    if (isEditingDescription && descriptionRef.current && editedDescription.trim().length > 0) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = descriptionRef.current.scrollHeight + 'px';
    }
  }, [editedDescription, isEditingDescription]);

  // Immediate height adjustment on mount (prevents layout shift)
  const handleTitleMount = (element: HTMLTextAreaElement | null) => {
    if (element) {
      titleRef.current = element;
      element.style.height = 'auto';
      element.style.height = element.scrollHeight + 'px';
    }
  };

  const handleDescriptionMount = (element: HTMLTextAreaElement | null) => {
    if (element) {
      descriptionRef.current = element;
      element.style.height = 'auto';
      element.style.height = element.scrollHeight + 'px';
    }
  };

  const isTruncated = (element: HTMLElement | null): boolean => {
    if (!element) return false;
    return element.scrollHeight > element.clientHeight;
  };

  // Sync checkbox with task status
  useEffect(() => {
    setIsChecked(task.status === 'completed');
  }, [task.status]);

  // Click-outside detection to auto-collapse description
  useEffect(() => {
    if (!isDescriptionExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Check if click is inside description container
      if (descriptionContainerRef.current?.contains(target)) {
        return;
      }

      // Check if click is on a safe zone (priority dropdown, date button, photo button)
      const isSafeZone = target.closest('[data-description-safe-zone="true"]');
      if (isSafeZone) {
        return;
      }

      // Check if currently editing description
      if (isEditingDescription) {
        return;
      }

      // Collapse description and exit edit mode
      setIsDescriptionExpanded(false);
      setIsEditingDescription(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDescriptionExpanded, isEditingDescription]);

  // Click-outside detection to auto-collapse title
  useEffect(() => {
    if (!isTitleExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Check if click is inside title container
      if (titleContainerRef.current?.contains(target)) {
        return;
      }

      // Check if click is on a safe zone (priority dropdown, date button, photo button)
      const isSafeZone = target.closest('[data-description-safe-zone="true"]');
      if (isSafeZone) {
        return;
      }

      // Check if currently editing title
      if (isEditingTitle) {
        return;
      }

      // Collapse title and exit edit mode
      setIsTitleExpanded(false);
      setIsEditingTitle(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isTitleExpanded, isEditingTitle]);

  const handleStartStop = () => {
    if (timer.isRunning) {
      // Calculate elapsed time before stopping
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
    } else {
      const startTime = Date.now();
      startTimer();
      onUpdate({ 
        ...task, 
        status: 'in-progress',
        timer: { ...timer, isRunning: true, startTime } 
      });
    }
  };

  const handleCheckboxChange = (checked: boolean) => {
    if (checked) {
      setIsChecked(true);
      setIsFading(true);
      
      setTimeout(() => {
        onUpdate({
          ...task,
          status: 'completed'
        });
        setIsFading(false);
      }, 1000);
    } else {
      setIsChecked(false);
      onUpdate({
        ...task,
        status: 'todo'
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

  return (
    <>
      <div 
        data-task-card
        className={`group w-full glass-card rounded-lg px-1 py-0.5 hover:border-primary/50 transition-all duration-300 cursor-pointer ${timer.isRunning ? 'border-glow-pulse' : ''} ${isFading ? 'animate-fade-out' : ''}`}
        onClick={isMobile && globalViewMode === 'compact' ? undefined : onTaskClick}
      >
        {/* Mobile/Tablet Layout */}
        <div className="flex flex-col gap-0 lg:hidden">
          {/* Line 1: Checkbox + Title + Play/Pause */}
          <div className="flex items-center gap-2">
            <Checkbox
              onClick={(e) => e.stopPropagation()}
              checked={isChecked}
              onCheckedChange={handleCheckboxChange}
              className="shrink-0"
            />
            {isEditingTitle ? (
              <Textarea
                ref={handleTitleMount}
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                autoFocus
                rows={1}
                className="font-semibold text-sm min-h-0 h-auto py-0.5 px-1.5 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 border-none bg-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <h3
                ref={titleContainerRef}
                className={`font-semibold text-sm text-foreground cursor-text rounded px-1.5 py-0 transition-colors flex-1 ${!isTitleExpanded ? 'line-clamp-2' : ''} ${task.status === 'completed' || isFading || (task.completedByEmail && (!task.sharedRecipients || task.sharedRecipients.length === 0)) ? 'line-through opacity-50' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (task.assignedToEmail) return;
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsTitleExpanded(true);
                  setIsEditingTitle(true);
                }}
              >
                {editedTitle}
              </h3>
            )}
            {onEditTask && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
                className="h-8 w-8 p-0 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                title="Edit task"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStartStop}
              className="h-8 w-8 p-0 shrink-0"
            >
              {timer.isRunning ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </div>
          
          {/* Line 2: Description */}
          <div className="flex items-center gap-2">
            {isEditingDescription ? (
              <Textarea
                ref={handleDescriptionMount}
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                autoFocus
                rows={1}
                className="text-sm min-h-0 h-auto py-0.5 px-1.5 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-muted-foreground resize-none flex-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p 
                ref={descriptionContainerRef}
                className={`text-sm text-muted-foreground cursor-text rounded px-1.5 py-0 transition-colors flex-1 whitespace-pre-wrap ${isDescriptionExpanded ? '' : 'line-clamp-2'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsDescriptionExpanded(true);
                  setIsEditingDescription(true);
                }}
              >
                {editedDescription ? (
                  <LinkifiedText text={editedDescription} />
                ) : (
                  'Click to add description...'
                )}
              </p>
            )}
          </div>

          {/* Line 3: Priority + Status + Due Date + Timer + Photo */}
          {isExpanded && (
            <div className="flex items-center gap-2 flex-wrap" data-third-row="true" onClick={(e) => e.stopPropagation()}>
              <div data-description-safe-zone="true">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      className="inline-flex"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge variant="outline" className={`${priorityColors[task.priority]} cursor-pointer hover:opacity-80 text-xs`}>
                        {task.priority}
                      </Badge>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-32 p-1 bg-card border-border" data-description-safe-zone="true" onClick={(e) => e.stopPropagation()}>
                    {(['low', 'medium', 'high', 'urgent'] as const).map((priority) => (
                      <DropdownMenuItem
                        key={priority}
                        onClick={() => onUpdate({ ...task, priority })}
                        className="cursor-pointer"
                      >
                        <Badge variant="outline" className={`${priorityColors[priority]} w-full justify-center`}>
                          {priority}
                        </Badge>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              
              {!isMobile && (
                <Badge className={`${statusColors[task.status]} text-xs`}>
                  {task.status}
                </Badge>
              )}
              
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded px-2 py-1"
                data-description-safe-zone="true"
                onClick={(e) => { e.stopPropagation(); onEditTask?.(task); }}
              >
                <Calendar className="w-3 h-3" />
                <span>{task.dueDate ? format(new Date(task.dueDate), 'MMM d') : 'no date'}</span>
              </button>

              <div className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded px-2 py-1">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{formatTime(displaySeconds, !isMobile)}</span>
              </div>

              <button
                data-description-safe-zone="true"
                onClick={(e) => { e.stopPropagation(); onEditTask?.(task); }}
                className={`p-1 rounded transition-colors relative ${
                  task.images && task.images.length > 0
                    ? 'text-primary border border-primary bg-primary/15'
                    : 'text-muted-foreground border border-border bg-muted/20'
                }`}
              >
                <Image className="w-3 h-3" />
                {task.images && task.images.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
                    {task.images.length}
                  </span>
                )}
              </button>

              <button
                  data-description-safe-zone="true"
                  onClick={(e) => { e.stopPropagation(); onAssignTask?.(task); }}
                  className="p-1 rounded transition-colors text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 hover:border-primary"
                  title="Share Task"
                >
                  <Share2 className="w-3 h-3" />
                </button>

              {task.sharedRecipients && task.sharedRecipients.length > 0 ? (
                <ShareStatusPopover
                  recipients={task.sharedRecipients}
                  itemType="Task"
                  onRequestChanges={(email) => onRequestChanges?.({ ...task, completedByEmail: email })}
                  allCompleted={task.sharedRecipients.every(r => r.status === 'completed')}
                  onMoveAllToDone={() => { onUpdate({ ...task, status: 'completed' }); }}
                />
              ) : task.completedByEmail && task.status !== 'completed' ? (
                <>
                  <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                    ✅ {task.completedByEmail}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-5 px-2 border-success/30 text-success hover:bg-success/20"
                    onClick={(e) => { e.stopPropagation(); onUpdate({ ...task, status: 'completed' }); }}
                  >
                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-5 px-2 border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                    onClick={(e) => { e.stopPropagation(); onRequestChanges?.(task); }}
                  >
                    <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                    Changes
                  </Button>
                </>
              ) : null}
            </div>
          )}

          {/* Always-visible shared badge (mobile) - for both shared recipients AND single completedByEmail */}
          {!isExpanded && task.sharedRecipients && task.sharedRecipients.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap ml-6 mt-1" onClick={(e) => e.stopPropagation()}>
              <ShareStatusPopover
                recipients={task.sharedRecipients}
                itemType="Task"
                onRequestChanges={(email) => onRequestChanges?.({ ...task, completedByEmail: email })}
                allCompleted={task.sharedRecipients.every(r => r.status === 'completed')}
                onMoveAllToDone={() => { onUpdate({ ...task, status: 'completed' }); }}
              />
            </div>
          )}
          {!isExpanded && !task.sharedRecipients?.length && task.completedByEmail && task.status !== 'completed' && (
            <div className="flex items-center gap-2 flex-wrap ml-6 mt-1" onClick={(e) => e.stopPropagation()}>
              <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                ✅ {task.completedByEmail}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-5 px-2 border-success/30 text-success hover:bg-success/20"
                onClick={(e) => { e.stopPropagation(); onUpdate({ ...task, status: 'completed' }); }}
              >
                <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                Done
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-5 px-2 border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                onClick={(e) => { e.stopPropagation(); onRequestChanges?.(task); }}
              >
                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                Changes
              </Button>
            </div>
          )}


          {/* Change request banner (mobile) */}
          {task.changeRequestMessage && (
            <div className="flex items-start gap-2 ml-6 mt-1 p-2 rounded-md bg-orange-500/10 border border-orange-500/30" onClick={(e) => e.stopPropagation()}>
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

        {/* Desktop Layout */}
        <div className="hidden lg:flex lg:flex-col gap-0">
          {/* Line 1: Checkbox + Title + Play/Pause */}
          <div className="flex items-center gap-1.5">
            <Checkbox
              onClick={(e) => e.stopPropagation()}
              checked={isChecked}
              onCheckedChange={handleCheckboxChange}
              className="shrink-0"
            />
            {isEditingTitle ? (
              <Textarea
                ref={handleTitleMount}
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                autoFocus
                rows={1}
                className="font-semibold text-sm leading-tight min-h-0 h-auto py-0 px-1 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 border-none bg-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <h3
                ref={titleContainerRef}
                className={`font-semibold text-sm leading-tight text-foreground cursor-text rounded px-1 py-0 transition-colors flex-1 ${!isTitleExpanded ? 'line-clamp-2' : ''} ${task.status === 'completed' || isFading || (task.completedByEmail && (!task.sharedRecipients || task.sharedRecipients.length === 0)) ? 'line-through opacity-50' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (task.assignedToEmail) return;
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsTitleExpanded(true);
                  setIsEditingTitle(true);
                }}
              >
                {editedTitle}
              </h3>
            )}
            {onEditTask && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
                className="h-7 w-7 p-0 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                title="Edit task"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStartStop}
              className="h-7 w-7 p-0 shrink-0"
            >
              {timer.isRunning ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Line 2: Description */}
          <div className="flex items-center gap-1">
            {isEditingDescription ? (
              <Textarea
                ref={handleDescriptionMount}
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                autoFocus
                rows={1}
                className="text-sm leading-tight min-h-0 h-auto py-0 px-1 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-muted-foreground resize-none flex-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p 
                ref={descriptionContainerRef}
                className={`text-sm leading-tight text-muted-foreground cursor-text rounded px-1 py-0 transition-colors flex-1 whitespace-pre-wrap ${isDescriptionExpanded ? '' : 'line-clamp-2'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsDescriptionExpanded(true);
                  setIsEditingDescription(true);
                }}
              >
                {editedDescription ? (
                  <LinkifiedText text={editedDescription} />
                ) : (
                  'Click to add description...'
                )}
              </p>
            )}
          </div>

          {/* Line 3: Priority + Status + Due Date + Timer + Photo */}
          {isExpanded && (
            <div className="flex items-center gap-x-1 gap-y-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
              <div data-description-safe-zone="true">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      className="inline-flex"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge variant="outline" className={`${priorityColors[task.priority]} cursor-pointer hover:opacity-80 text-xs`}>
                        {task.priority}
                      </Badge>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-32 p-1 bg-card border-border" data-description-safe-zone="true" onClick={(e) => e.stopPropagation()}>
                    {(['low', 'medium', 'high', 'urgent'] as const).map((priority) => (
                      <DropdownMenuItem
                        key={priority}
                        onClick={() => onUpdate({ ...task, priority })}
                        className="cursor-pointer"
                      >
                        <Badge variant="outline" className={`${priorityColors[priority]} w-full justify-center`}>
                          {priority}
                        </Badge>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              
              <Badge className={`${statusColors[task.status]} text-xs`}>
                {task.status}
              </Badge>
              
              <button 
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded px-2 py-0.5"
                data-description-safe-zone="true"
                onClick={() => onEditTask?.(task)}
              >
                <Calendar className="w-3 h-3" />
                <span>{task.dueDate ? format(new Date(task.dueDate), 'MMM d') : 'no date'}</span>
              </button>

              <div className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded px-2 py-0.5">
                <Clock className="w-3 h-3" />
                <span className="font-mono min-w-[72px]">{formatTime(displaySeconds, true)}</span>
              </div>

              <button
                data-description-safe-zone="true"
                onClick={() => onEditTask?.(task)}
                className={`p-1 rounded transition-colors relative ${
                  task.images && task.images.length > 0
                    ? 'text-primary border border-primary bg-primary/15'
                    : 'text-muted-foreground border border-border bg-muted/20'
                }`}
              >
                <Image className="w-3 h-3" />
                {task.images && task.images.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
                    {task.images.length}
                  </span>
                )}
              </button>

              <button
                  data-description-safe-zone="true"
                  onClick={() => onAssignTask?.(task)}
                  className="p-1 rounded transition-colors text-primary border border-primary/30 bg-primary/10 hover:bg-primary/20 hover:border-primary"
                  title="Share Task"
                >
                  <Share2 className="w-3 h-3" />
                </button>

              {task.sharedRecipients && task.sharedRecipients.length > 0 ? (
                <ShareStatusPopover
                  recipients={task.sharedRecipients}
                  itemType="Task"
                  onRequestChanges={(email) => onRequestChanges?.({ ...task, completedByEmail: email })}
                  allCompleted={task.sharedRecipients.every(r => r.status === 'completed')}
                  onMoveAllToDone={() => { onUpdate({ ...task, status: 'completed' }); }}
                />
              ) : task.completedByEmail && task.status !== 'completed' ? (
                <>
                  <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-[10px]">
                    ✅ Completed by {task.completedByEmail}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-5 px-2 border-success/30 text-success hover:bg-success/20"
                    onClick={(e) => { e.stopPropagation(); onUpdate({ ...task, status: 'completed' }); }}
                  >
                    <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                    Move to Done
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-5 px-2 border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                    onClick={(e) => { e.stopPropagation(); onRequestChanges?.(task); }}
                  >
                    <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                    Changes Needed
                  </Button>
                </>
              ) : null}
            </div>
          )}

          {/* Always-visible shared badge (desktop) */}
          {!isExpanded && task.sharedRecipients && task.sharedRecipients.length > 0 && (
            <div className="flex items-center gap-2 ml-6 mt-1" onClick={(e) => e.stopPropagation()}>
              <ShareStatusPopover
                recipients={task.sharedRecipients}
                itemType="Task"
                onRequestChanges={(email) => onRequestChanges?.({ ...task, completedByEmail: email })}
                allCompleted={task.sharedRecipients.every(r => r.status === 'completed')}
                onMoveAllToDone={() => { onUpdate({ ...task, status: 'completed' }); }}
              />
            </div>
          )}
          {!isExpanded && !task.sharedRecipients?.length && task.completedByEmail && task.status !== 'completed' && (
            <div className="flex items-center gap-2 ml-6 mt-1" onClick={(e) => e.stopPropagation()}>
              <Badge variant="outline" className="bg-success/15 text-success border-success/30 text-xs">
                ✅ Completed by {task.completedByEmail}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-6 px-2 border-success/30 text-success hover:bg-success/20"
                onClick={(e) => { e.stopPropagation(); onUpdate({ ...task, status: 'completed' }); }}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Move to Done
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-6 px-2 border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                onClick={(e) => { e.stopPropagation(); onRequestChanges?.(task); }}
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                Changes Needed
              </Button>
            </div>
          )}


          {/* Change request banner (desktop) */}
          {task.changeRequestMessage && (
            <div className="flex items-start gap-2 ml-6 mt-1 p-2 rounded-md bg-orange-500/10 border border-orange-500/30" onClick={(e) => e.stopPropagation()}>
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
    </>
  );
};
