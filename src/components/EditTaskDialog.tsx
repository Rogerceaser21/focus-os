import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Task, TaskPriority, TaskStatus, Project } from '@/types/task';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TouchDialog, TouchDialogContent } from '@/components/ui/touch-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Share2, Trash2 } from 'lucide-react';
import { GoogleCalendarButton } from '@/components/GoogleCalendarButton';
import { HandToAI } from '@/components/icons/HandToAI';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { ImageViewer } from '@/components/ImageViewer';
import { ShareItemDialog } from '@/components/ShareItemDialog';
import { ShareStatusPopover } from '@/components/ShareStatusPopover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSidebar } from '@/components/ui/sidebar';
import { SidePanel } from '@/components/SidePanel';
import { ScrollHintArea } from '@/components/ScrollHintArea';
import { uploadTaskImage, getImageDisplayUrl } from '@/lib/taskImageStorage';
import { supabase } from '@/integrations/supabase/client';
import { HandoffToAIDialog } from '@/components/HandoffToAIDialog';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { AIProvider, ImageMode } from '@/lib/aiHandoff';

interface EditTaskDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateTask: (task: Task) => void;
  projects?: Project[];
  onAssigned?: (taskId: string, email: string) => void;
  desktopDocked?: boolean;
  currentUserId?: string;
  onDeleteTask?: (task: Task) => void | Promise<void>;
  highlight?: { target: 'images' | 'dates'; nonce: number } | null;
  /** Live share status for THIS task, read by the caller from its sender map
      during render (O2, 2026-08-23). The `task` prop is a snapshot taken when
      the sheet opened and cannot be swapped for a fresh object without the
      seed effect below wiping unsaved edits, so the chip reads this instead
      and falls back to the snapshot when the caller passes nothing. */
  sharedRecipients?: Task['sharedRecipients'];
}

export const EditTaskDialog = ({
  task,
  open,
  onOpenChange,
  onUpdateTask,
  projects = [],
  onAssigned,
  desktopDocked = false,
  currentUserId,
  onDeleteTask,
  highlight = null,
  sharedRecipients: sharedRecipientsLive,
}: EditTaskDialogProps) => {
  // Derived during render, never stored: live map first, snapshot second.
  const chipRecipients = sharedRecipientsLive ?? task.sharedRecipients;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [startDate, setStartDate] = useState<Date | undefined>(task.startDate);
  const [endDate, setEndDate] = useState<Date | undefined>(task.endDate);
  const [dueDate, setDueDate] = useState<Date | undefined>(task.dueDate);
  const [images, setImages] = useState<string[]>(task.images || []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(task.projectId || null);
  const [maxHeight, setMaxHeight] = useState('300px');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const imagesSectionRef = useRef<HTMLDivElement>(null);
  const [boxSweep, setBoxSweep] = useState(false);
  const [hintGlow, setHintGlow] = useState(false);
  const [datesSweep, setDatesSweep] = useState(false);

  useEffect(() => {
    if (!(open && highlight)) {
      setBoxSweep(false);
      setHintGlow(false);
      setDatesSweep(false);
      return;
    }
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    if (highlight.target === 'images') {
      timeouts.push(setTimeout(() => {
        imagesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50));
      setBoxSweep(true);
      setHintGlow(false);
      setDatesSweep(false);
      timeouts.push(setTimeout(() => setBoxSweep(false), 900));
      timeouts.push(setTimeout(() => setHintGlow(true), 900));
      timeouts.push(setTimeout(() => setHintGlow(false), 2700));
    } else if (highlight.target === 'dates') {
      setDatesSweep(true);
      setBoxSweep(false);
      setHintGlow(false);
      timeouts.push(setTimeout(() => setDatesSweep(false), 900));
    }
    return () => { timeouts.forEach(clearTimeout); };
  }, [open, highlight?.nonce, highlight?.target]);
  const sidebar = useSidebar();
  const prevSidebarOpen = useRef<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const { preferences, updatePreferences } = useUserPreferences(userId);

  // If the task has assignedToEmail, the current user is the recipient of a shared task
  const isReceivedSharedTask = !!task.assignedToEmail;
  
  // Check if user is a collaborator (not owner) on a collaborative project
  const taskProject = projects.find(p => p.id === task.projectId);
  const isCollaboratorOnProject = taskProject?.isShared && taskProject?.userId !== currentUserId && !!currentUserId;
  
  // Due date is locked for both received shared tasks AND collaborators on collaborative projects
  const isDueDateLocked = isReceivedSharedTask || isCollaboratorOnProject;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const MAX_IMAGES = 8;

  useEffect(() => {
    if (isMobile) return;

    if (open) {
      prevSidebarOpen.current = sidebar.open;
      sidebar.setOpen(false);
    } else if (prevSidebarOpen.current !== null) {
      sidebar.setOpen(prevSidebarOpen.current);
      prevSidebarOpen.current = null;
    }

    return () => {
      if (!isMobile && prevSidebarOpen.current !== null) {
        sidebar.setOpen(prevSidebarOpen.current);
        prevSidebarOpen.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isMobile]);

  useEffect(() => {
    if (open) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setStartDate(task.startDate);
      setEndDate(task.endDate);
      setDueDate(task.dueDate);
      setImages(task.images || []);
      setSelectedProjectId(task.projectId || null);
    }
  }, [task, open]);

  useEffect(() => {
    const updateMaxHeight = () => {
      const mobile = window.innerWidth < 640;
      setMaxHeight(mobile ? '160px' : '300px');
    };

    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    return () => window.removeEventListener('resize', updateMaxHeight);
  }, []);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title, open]);

  const uploadImageFile = useCallback(async (file: File | Blob) => {
    if (!userId) {
      toast({ title: 'Not authenticated', variant: 'destructive' });
      return;
    }
    try {
      setUploading(true);
      const path = await uploadTaskImage(file, userId);
      setImages((prev) => [...prev, path]);
      toast({ title: 'Image uploaded', description: 'Image uploaded successfully' });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          if (images.length >= MAX_IMAGES) {
            toast({ title: 'Maximum images reached', description: 'You can only add up to 8 images per task', variant: 'destructive' });
            return;
          }

          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            uploadImageFile(blob);
          }
          break;
        }
      }
    };

    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [open, images, uploadImageFile]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast({ title: 'Maximum images reached', description: 'You can only add up to 8 images per task', variant: 'destructive' });
      return;
    }

    const filesToAdd = Array.from(files).slice(0, remaining);
    for (const file of filesToAdd) {
      await uploadImageFile(file);
    }
    if (files.length > remaining) {
      toast({ title: 'Limit reached', description: `Only added ${remaining} images (limit: 8)` });
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
    toast({ title: 'Image removed', description: 'Image removed successfully' });
  };

  const handleImageClick = (index: number) => {
    setCurrentImageIndex(index);
    setViewerOpen(true);
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast({ title: 'Error', description: 'Please enter a task title', variant: 'destructive' });
      return;
    }

    const updatedTask: Task = {
      ...task,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status,
      startDate,
      endDate,
      dueDate,
      images,
      projectId: selectedProjectId || undefined,
    };

    onUpdateTask(updatedTask);
    onOpenChange(false);
    toast({ title: 'Task updated', description: 'Your task has been updated successfully' });
  };

  const panelTitle = (
    // pr-9 keeps the trailing bin icon clear of the dialog's built-in X close;
    // flex-wrap lets the share chip drop to its own line on narrow screens.
    <div className="flex items-center gap-2 flex-wrap pr-9">
      <span>Edit Task</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setHandoffOpen(true)}
        className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-primary border-primary/30 hover:border-primary"
        title="Hand off to AI"
      >
        <HandToAI variant="full" className="h-4 w-auto" strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShareDialogOpen(true)}
        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
        title="Share"
        aria-label="Share"
      >
        <Share2 className="h-4 w-4" />
      </Button>
      <GoogleCalendarButton
        taskId={task.id}
        task={{ ...task, title, description, priority, status, startDate, endDate, dueDate, projectId: selectedProjectId || undefined }}
        synced={!!task.googleCalendarEventId}
      />
      {/* On phones the share-status chip lives here instead of on the task row.
          Reads the LIVE recipients the caller derives during render, so a share
          sent from this very sheet shows its chip without closing it (O2). */}
      {isMobile && chipRecipients && chipRecipients.length > 0 && (
        <div onClick={(e) => e.stopPropagation()}>
          <ShareStatusPopover
            recipients={chipRecipients}
            itemType="Task"
            allCompleted={chipRecipients.every(r => r.status === 'completed')}
          />
        </div>
      )}
    </div>
  );

  const formContent = (
    <div className="space-y-4 py-4">
      <div className="space-y-2" data-task-tour-step="title">
        <Label htmlFor="title">Title *{isReceivedSharedTask && <span className="text-muted-foreground text-[10px] ml-1">(locked)</span>}</Label>
        <Textarea
          id="title"
          ref={titleRef}
          placeholder="Task title"
          value={title}
          onChange={(e) => !isReceivedSharedTask && setTitle(e.target.value)}
          rows={3}
          className={`text-sm resize-none min-h-0 h-auto overflow-hidden ${isReceivedSharedTask ? 'opacity-60 cursor-not-allowed' : ''}`}
          style={{ minHeight: '80px' }}
          readOnly={isReceivedSharedTask}
        />
      </div>

      <div className="space-y-2" data-task-tour-step="description">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Task description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="text-sm resize-none overflow-y-auto !min-h-0"
          style={{ height: maxHeight, maxHeight }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {projects.length > 0 && (
          <div className="space-y-1 sm:space-y-2" data-task-tour-step="project" data-projects-tour-step="task-project-selector">
            <Label className="text-xs sm:text-sm">Project{isReceivedSharedTask && <span className="text-muted-foreground text-[10px] ml-1">(locked)</span>}</Label>
            <Select value={selectedProjectId || 'unassigned'} onValueChange={(value) => !isReceivedSharedTask && setSelectedProjectId(value === 'unassigned' ? null : value)} disabled={isReceivedSharedTask}>
              <SelectTrigger className={`text-xs sm:text-sm h-9 sm:h-10 ${isReceivedSharedTask ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
                      <span className="truncate">{project.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className={cn('space-y-1 sm:space-y-2', projects.length === 0 && 'col-start-1')} data-task-tour-step="priority">
          <Label className="text-xs sm:text-sm">Priority</Label>
          <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
            <SelectTrigger className="text-xs sm:text-sm h-9 sm:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 sm:space-y-2">
          <Label className="text-xs sm:text-sm">Status</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
            <SelectTrigger className="text-xs sm:text-sm h-9 sm:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">To Do</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className={cn('grid grid-cols-3 gap-2 sm:gap-4 rounded-lg', datesSweep && 'sweep-highlight')}>
        <div className="space-y-1 sm:space-y-2" data-task-tour-step="start-date">
          <Label className="text-xs sm:text-sm">Start</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-full justify-start text-left font-normal text-xs sm:text-sm h-9 sm:h-10 px-2 sm:px-3', !startDate && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">{startDate ? format(startDate, 'MMM d') : 'Pick'}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1 sm:space-y-2" data-task-tour-step="end-date">
          <Label className="text-xs sm:text-sm">End</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-full justify-start text-left font-normal text-xs sm:text-sm h-9 sm:h-10 px-2 sm:px-3', !endDate && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">{endDate ? format(endDate, 'MMM d') : 'Pick'}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1 sm:space-y-2" data-task-tour-step="due-date">
          <Label className="text-xs sm:text-sm">Due{isDueDateLocked && <span className="text-muted-foreground text-[10px] ml-1">(locked)</span>}</Label>
          <Popover>
            <PopoverTrigger asChild disabled={isDueDateLocked}>
              <Button
                variant="outline"
                className={cn('w-full justify-start text-left font-normal text-xs sm:text-sm h-9 sm:h-10 px-2 sm:px-3', !dueDate && 'text-muted-foreground', isDueDateLocked && 'opacity-60 cursor-not-allowed')}
                disabled={isDueDateLocked}
              >
                <CalendarIcon className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">{dueDate ? format(dueDate, 'MMM d') : 'Pick'}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div
        data-task-tour-step="images"
        ref={imagesSectionRef}
        className={cn('rounded-lg', boxSweep && 'sweep-highlight')}
      >
        <Label htmlFor="edit-image">Images (Optional - Max 8)</Label>
        <div className="space-y-2">
          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {images.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img
                    src={getImageDisplayUrl(img)}
                    alt={`Upload ${idx + 1}`}
                    className="w-full h-24 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => handleImageClick(idx)}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(idx)}
                    className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input type="file" accept="image/*" multiple ref={fileInputRef} onChange={handleFileSelect} className="hidden" id="edit-file-input" />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full" disabled={images.length >= MAX_IMAGES || uploading}>
            📁 Choose from Gallery ({images.length}/{MAX_IMAGES})
          </Button>
          <p className={cn('text-xs transition-colors duration-500', hintGlow ? 'sweep-highlight text-yellow-500 dark:text-yellow-400 font-semibold' : 'text-muted-foreground')}>Desktop: You can also paste images with Ctrl+V</p>
        </div>
      </div>

    </div>
  );

  // Pinned outside the scroll area in every container so Cancel/Save are
  // always reachable without scrolling. Delete sits far left, red.
  const formFooter = (
    <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/50 flex-shrink-0">
      {onDeleteTask && !isReceivedSharedTask && !isCollaboratorOnProject && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0 mr-auto text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Delete task"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the task{chipRecipients && chipRecipients.length > 0 ? ' and remove it from all recipients you shared it with' : ''}. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await onDeleteTask(task);
                  onOpenChange(false);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Yes, Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button onClick={handleSubmit} data-task-tour-step="save-button" disabled={uploading}>
        {uploading ? 'Uploading...' : 'Save Changes'}
      </Button>
    </div>
  );

  const extras = (
    <>
      {viewerOpen && <ImageViewer images={images.map(getImageDisplayUrl)} currentIndex={currentImageIndex} onClose={() => setViewerOpen(false)} onNavigate={setCurrentImageIndex} />}
      <ShareItemDialog itemType="task" itemId={task.id} itemTitle={task.title} open={shareDialogOpen} onOpenChange={setShareDialogOpen} onShared={() => onAssigned?.(task.id, '')} />
      <HandoffToAIDialog
        open={handoffOpen}
        onOpenChange={setHandoffOpen}
        task={task}
        projectName={taskProject?.name}
        defaultProvider={(preferences?.ai_handoff_default_provider as AIProvider | null | undefined) ?? null}
        defaultImageMode={(preferences?.ai_handoff_image_mode as ImageMode | undefined) ?? 'public_link'}
        onPersistDefaults={async ({ provider, imageMode }) => {
          if (!userId) return;
          const updates: Record<string, any> = {};
          if (provider && provider !== preferences?.ai_handoff_default_provider) updates.ai_handoff_default_provider = provider;
          if (imageMode && imageMode !== preferences?.ai_handoff_image_mode) updates.ai_handoff_image_mode = imageMode;
          if (Object.keys(updates).length === 0) return;
          // Silent update — no toast (reuses table directly)
          await (supabase as any)
            .from('focusos_user_preferences')
            .update(updates)
            .eq('user_id', userId);
        }}
      />
    </>
  );

  if (isMobile) {
    return (
      <>
        <TouchDialog open={open} onOpenChange={onOpenChange}>
          <TouchDialogContent className="lg-editsheet sm:max-w-[600px] max-h-[90vh] flex flex-col w-full mx-0 sm:mx-auto p-4 sm:p-6">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{panelTitle}</DialogTitle>
            </DialogHeader>
            <ScrollHintArea>{formContent}</ScrollHintArea>
            {formFooter}
          </TouchDialogContent>
        </TouchDialog>
        {extras}
      </>
    );
  }

  if (!desktopDocked) {
    return (
      <>
        <TouchDialog open={open} onOpenChange={onOpenChange}>
          <TouchDialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col w-full mx-0 sm:mx-auto p-4 sm:p-6">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>{panelTitle}</DialogTitle>
            </DialogHeader>
            <ScrollHintArea>{formContent}</ScrollHintArea>
            {formFooter}
          </TouchDialogContent>
        </TouchDialog>
        {extras}
      </>
    );
  }

  return (
    <>
      {open && (
        <SidePanel open={open} onClose={() => onOpenChange(false)} title={panelTitle} className="border-r border-l-0" footer={formFooter}>
          {formContent}
        </SidePanel>
      )}
      {extras}
    </>
  );
};
