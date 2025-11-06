import { Task } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Play, Pause, Calendar, Clock, Image } from 'lucide-react';
import { useTimer } from '@/hooks/useTimer';
import { useIsMobile } from '@/hooks/use-mobile';
import { EditTaskDialog } from './EditTaskDialog';
import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { LinkifiedText } from '@/components/LinkifiedText';

interface TaskListItemProps {
  task: Task;
  onUpdate: (task: Task) => void;
  globalViewMode: 'full' | 'compact';
  isIndividuallyExpanded: boolean;
  onTaskClick: () => void;
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

export const TaskListItem = ({ task, onUpdate, globalViewMode, isIndividuallyExpanded, onTaskClick }: TaskListItemProps) => {
  const { timer, startTimer, stopTimer, formatTime } = useTimer(task.timer);
  const isMobile = useIsMobile();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);
  const [editedDescription, setEditedDescription] = useState(task.description || '');
  const [isFading, setIsFading] = useState(false);
  const isExpanded = isIndividuallyExpanded || globalViewMode === 'full';
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const titleDisplayRef = useRef<HTMLHeadingElement>(null);
  const descriptionDisplayRef = useRef<HTMLParagraphElement>(null);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [titleLineClamp, setTitleLineClamp] = useState<'line-clamp-1' | 'line-clamp-2'>('line-clamp-1');
  const [descriptionLineClamp, setDescriptionLineClamp] = useState<'line-clamp-1' | 'line-clamp-2'>('line-clamp-1');

  // Detect title overflow and calculate needed lines
  useEffect(() => {
    if (titleDisplayRef.current && !isEditingTitle) {
      const element = titleDisplayRef.current;
      
      // Temporarily remove line clamp to measure actual height
      element.style.webkitLineClamp = 'unset';
      const fullHeight = element.scrollHeight;
      element.style.webkitLineClamp = '';
      
      const lineHeight = parseInt(window.getComputedStyle(element).lineHeight);
      const lines = Math.ceil(fullHeight / lineHeight);
      
      // Set line clamp based on content
      setTitleLineClamp(lines > 1 ? 'line-clamp-2' : 'line-clamp-1');
      setIsTitleOverflowing(lines > 2);
    }
  }, [task.title, isEditingTitle]);

  // Calculate needed lines for description
  useEffect(() => {
    if (descriptionDisplayRef.current && !isEditingDescription) {
      const element = descriptionDisplayRef.current;
      
      // If no description, use single line
      if (!task.description) {
        setDescriptionLineClamp('line-clamp-1');
        return;
      }
      
      // Temporarily remove line clamp to measure actual height
      element.style.webkitLineClamp = 'unset';
      const fullHeight = element.scrollHeight;
      element.style.webkitLineClamp = '';
      
      const lineHeight = parseInt(window.getComputedStyle(element).lineHeight);
      const lines = Math.ceil(fullHeight / lineHeight);
      
      // Set line clamp based on content
      setDescriptionLineClamp(lines > 1 ? 'line-clamp-2' : 'line-clamp-1');
    }
  }, [task.description, isEditingDescription]);

  // Auto-expand title input and detect overflow (mobile only)
  useEffect(() => {
    if (isEditingTitle && titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
      
      if (isMobile) {
        const lineHeight = parseInt(window.getComputedStyle(titleRef.current).lineHeight);
        const lines = Math.ceil(titleRef.current.scrollHeight / lineHeight);
        
        if (lines > 2) {
          setIsEditingTitle(false);
          setIsEditOpen(true);
        }
      }
    }
  }, [editedTitle, isEditingTitle, isMobile]);

  // Auto-expand description textarea and detect overflow
  useEffect(() => {
    if (isEditingDescription && descriptionRef.current) {
      descriptionRef.current.style.height = 'auto';
      descriptionRef.current.style.height = descriptionRef.current.scrollHeight + 'px';
      
      const lineHeight = parseInt(window.getComputedStyle(descriptionRef.current).lineHeight);
      const lines = Math.ceil(descriptionRef.current.scrollHeight / lineHeight);
      
      if (lines > 8) {
        setIsEditingDescription(false);
        setIsEditOpen(true);
      }
    }
  }, [editedDescription, isEditingDescription]);

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

  return (
    <>
      <div 
        data-task-card
        className={`group w-full border border-white/10 bg-card/50 rounded-lg p-1.5 hover:border-primary/50 transition-all duration-300 cursor-pointer ${timer.isRunning ? 'border-glow-pulse' : ''} ${isFading ? 'animate-fade-out' : ''}`}
        onClick={onTaskClick}
      >
        {/* Mobile/Tablet Layout */}
        <div className="flex flex-col gap-1 lg:hidden">
          {/* Line 1: Checkbox + Title + Play/Pause */}
          <div className="flex items-center gap-2">
            <Checkbox
              onClick={(e) => e.stopPropagation()}
              checked={task.status === 'completed'}
              onCheckedChange={handleCheckboxChange}
              className="shrink-0"
            />
            {isEditingTitle ? (
              <Textarea
                ref={titleRef as any}
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                autoFocus
                className="font-semibold text-sm min-h-0 h-auto py-0.5 px-1.5 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 border-none bg-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
                style={{ height: 'auto' }}
              />
            ) : (
              <h3
                ref={titleDisplayRef}
                className={`font-semibold text-sm text-foreground cursor-text rounded px-1.5 py-0.5 transition-colors flex-1 ${titleLineClamp} ${task.status === 'completed' || isFading ? 'line-through opacity-50' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  
                  // If title is overflowing (more than 2 lines), open EditTaskDialog
                  if (isTitleOverflowing) {
                    setIsEditOpen(true);
                    return;
                  }
                  
                  // Otherwise, allow inline editing
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsEditingTitle(true);
                }}
              >
                {task.title}
              </h3>
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
                ref={descriptionRef}
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                autoFocus
                className="text-sm min-h-0 h-auto py-0.5 px-1.5 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-muted-foreground resize-none flex-1"
                onClick={(e) => e.stopPropagation()}
                style={{ height: 'auto' }}
              />
            ) : (
              <p 
                ref={descriptionDisplayRef}
                className={`text-sm text-muted-foreground cursor-text rounded px-1.5 py-0.5 transition-colors ${descriptionLineClamp} flex-1`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsEditingDescription(true);
                }}
              >
                {task.description ? (
                  <LinkifiedText text={task.description} />
                ) : (
                  'Click to add description...'
                )}
              </p>
            )}
          </div>

          {/* Line 3: Priority + Status + Due Date + Timer + Photo */}
          {isExpanded && (
            <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
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
                <DropdownMenuContent align="center" className="w-32 p-1 bg-card border-border" onClick={(e) => e.stopPropagation()}>
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
              
              {!isMobile && (
                <Badge className={`${statusColors[task.status]} text-xs`}>
                  {task.status}
                </Badge>
              )}
              
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded px-2 py-1"
                onClick={() => setIsEditOpen(true)}
              >
                <Calendar className="w-3 h-3" />
                <span>{task.dueDate ? format(new Date(task.dueDate), 'MMM d') : 'no date'}</span>
              </button>

              <div className="flex items-center gap-1 text-xs text-muted-foreground border border-border rounded px-2 py-1">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{formatTime(timer.totalSeconds, !isMobile)}</span>
              </div>

              <button
                onClick={() => setIsEditOpen(true)}
                className={`p-1 rounded transition-colors ${
                  task.imageUrl 
                    ? 'text-blue-500 border border-blue-500 bg-blue-500/20' 
                    : 'text-white/50 border border-white/30'
                }`}
              >
                <Image className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Desktop Layout */}
        <div className="hidden lg:flex lg:flex-col gap-1">
          {/* Line 1: Checkbox + Title + Play/Pause */}
          <div className="flex items-center gap-2">
            <Checkbox
              onClick={(e) => e.stopPropagation()}
              checked={task.status === 'completed'}
              onCheckedChange={handleCheckboxChange}
              className="shrink-0"
            />
            {isEditingTitle ? (
              <Textarea
                ref={titleRef as any}
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                autoFocus
                className="font-semibold text-sm min-h-0 h-auto py-0.5 px-1.5 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 border-none bg-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
                style={{ height: 'auto' }}
              />
            ) : (
              <h3
                ref={titleDisplayRef}
                className={`font-semibold text-sm text-foreground cursor-text rounded px-1.5 py-0.5 transition-colors flex-1 ${titleLineClamp} ${task.status === 'completed' || isFading ? 'line-through opacity-50' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  
                  // Allow inline editing
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsEditingTitle(true);
                }}
              >
                {task.title}
              </h3>
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
                ref={descriptionRef}
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                autoFocus
                className="text-sm min-h-0 h-auto py-0.5 px-1.5 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-muted-foreground resize-none flex-1"
                onClick={(e) => e.stopPropagation()}
                style={{ height: 'auto' }}
              />
            ) : (
              <p 
                ref={descriptionDisplayRef}
                className={`text-sm text-muted-foreground cursor-text rounded px-1.5 py-0.5 transition-colors ${descriptionLineClamp} flex-1`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isIndividuallyExpanded) {
                    onTaskClick();
                  }
                  setIsEditingDescription(true);
                }}
              >
                {task.description ? (
                  <LinkifiedText text={task.description} />
                ) : (
                  'Click to add description...'
                )}
              </p>
            )}
          </div>

          {/* Line 3: Priority + Status + Due Date + Timer + Photo */}
          {isExpanded && (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button 
                    className="inline-flex"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Badge variant="outline" className={`${priorityColors[task.priority]} cursor-pointer hover:opacity-80`}>
                      {task.priority}
                    </Badge>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-32 p-1 bg-card border-border" onClick={(e) => e.stopPropagation()}>
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
              
              <Badge className={statusColors[task.status]}>
                {task.status}
              </Badge>
              
              <button 
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded px-2 py-1"
                onClick={() => setIsEditOpen(true)}
              >
                <Calendar className="w-4 h-4" />
                <span>{task.dueDate ? format(new Date(task.dueDate), 'MMM d') : 'no date'}</span>
              </button>

              <div className="flex items-center gap-1 text-sm text-muted-foreground border border-border rounded px-2 py-1">
                <Clock className="w-4 h-4" />
                <span className="font-mono min-w-[80px]">{formatTime(timer.totalSeconds, true)}</span>
              </div>

              <button
                onClick={() => setIsEditOpen(true)}
                className={`p-1.5 rounded transition-colors ${
                  task.imageUrl 
                    ? 'text-blue-500 border border-blue-500 bg-blue-500/20' 
                    : 'text-white/50 border border-white/30'
                }`}
              >
                <Image className="w-4 h-4" />
              </button>
            </div>
          )}
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
