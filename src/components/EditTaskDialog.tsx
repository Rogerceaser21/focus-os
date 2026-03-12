import { useState, useEffect, useRef } from 'react';
import { Task, TaskPriority, TaskStatus, Project } from '@/types/task';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, ImageIcon, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { ImageViewer } from '@/components/ImageViewer';
import { ShareItemDialog } from '@/components/ShareItemDialog';

interface EditTaskDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateTask: (task: Task) => void;
  projects?: Project[];
  onAssigned?: (taskId: string, email: string) => void;
}

export const EditTaskDialog = ({ task, open, onOpenChange, onUpdateTask, projects = [], onAssigned }: EditTaskDialogProps) => {
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
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const MAX_IMAGES = 8;

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
      const isMobile = window.innerWidth < 640;
      setMaxHeight(isMobile ? '160px' : '300px');
    };
    
    updateMaxHeight();
    window.addEventListener('resize', updateMaxHeight);
    return () => window.removeEventListener('resize', updateMaxHeight);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          if (images.length >= MAX_IMAGES) {
            toast({
              title: 'Maximum images reached',
              description: 'You can only add up to 8 images per task',
              variant: 'destructive'
            });
            return;
          }
          
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              setImages(prev => [...prev, event.target?.result as string]);
              toast({
                title: 'Image pasted',
                description: 'Image added successfully'
              });
            };
            reader.readAsDataURL(blob);
          }
          break;
        }
      }
    };

    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [open, images]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast({
        title: 'Maximum images reached',
        description: 'You can only add up to 8 images per task',
        variant: 'destructive'
      });
      return;
    }
    
    const filesToAdd = Array.from(files).slice(0, remaining);
    let processed = 0;
    
    filesToAdd.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImages(prev => [...prev, event.target?.result as string]);
        processed++;
        
        if (processed === filesToAdd.length) {
          toast({
            title: 'Images added',
            description: files.length > remaining 
              ? `Only added ${remaining} images (limit: 8)`
              : `Added ${filesToAdd.length} image(s)`
          });
        }
      };
      reader.readAsDataURL(file);
    });
  };
  
  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
    toast({
      title: 'Image removed',
      description: 'Image removed successfully'
    });
  };

  const handleImageClick = (index: number) => {
    setCurrentImageIndex(index);
    setViewerOpen(true);
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a task title',
        variant: 'destructive'
      });
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
      projectId: selectedProjectId || undefined
    };

    onUpdateTask(updatedTask);
    onOpenChange(false);
    
    toast({
      title: 'Task updated',
      description: 'Your task has been updated successfully'
    });
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto w-full mx-0 sm:mx-auto p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Edit Task</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAssignDialogOpen(true)}
              className="h-8 w-8 p-0 mr-6 text-muted-foreground hover:text-primary"
              title="Assign & Email"
            >
              <Mail className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2" data-task-tour-step="title">
            <Label htmlFor="title">Title *</Label>
            <Textarea
              id="title"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={3}
              className="text-sm resize-none min-h-0 h-auto overflow-hidden"
              style={{ 
                height: 'auto',
                minHeight: '80px'
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = target.scrollHeight + 'px';
              }}
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

          {/* Project, Priority, Status - 3 columns on mobile */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {projects.length > 0 && (
              <div className="space-y-1 sm:space-y-2" data-task-tour-step="project" data-projects-tour-step="task-project-selector">
                <Label className="text-xs sm:text-sm">Project</Label>
                <Select 
                  value={selectedProjectId || 'unassigned'} 
                  onValueChange={(value) => setSelectedProjectId(value === 'unassigned' ? null : value)}
                >
                  <SelectTrigger className="text-xs sm:text-sm h-9 sm:h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">
                      <span className="text-muted-foreground">None</span>
                    </SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full flex-shrink-0" 
                            style={{ backgroundColor: project.color }}
                          />
                          <span className="truncate">{project.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className={cn("space-y-1 sm:space-y-2", projects.length === 0 && "col-start-1")} data-task-tour-step="priority">
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

          {/* Start, End, Due Dates - 3 columns on mobile */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className="space-y-1 sm:space-y-2" data-task-tour-step="start-date">
              <Label className="text-xs sm:text-sm">Start</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-xs sm:text-sm h-9 sm:h-10 px-2 sm:px-3", !startDate && "text-muted-foreground")}>
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
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-xs sm:text-sm h-9 sm:h-10 px-2 sm:px-3", !endDate && "text-muted-foreground")}>
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
              <Label className="text-xs sm:text-sm">Due</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal text-xs sm:text-sm h-9 sm:h-10 px-2 sm:px-3", !dueDate && "text-muted-foreground")}>
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

          <div data-task-tour-step="images">
            <Label htmlFor="edit-image">Images (Optional - Max 8)</Label>
            <div className="space-y-2">
              {images.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {images.map((img, idx) => (
                  <div key={idx} className="relative group">
                      <img 
                        src={img} 
                        alt={`Upload ${idx + 1}`}
                        className="w-full h-24 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => handleImageClick(idx)}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                id="edit-file-input"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
                disabled={images.length >= MAX_IMAGES}
              >
                📁 Choose from Gallery ({images.length}/{MAX_IMAGES})
              </Button>
              <p className="text-xs text-muted-foreground">
                Desktop: You can also paste images with Ctrl+V
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} data-task-tour-step="save-button">
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {viewerOpen && (
      <ImageViewer
        images={images}
        currentIndex={currentImageIndex}
        onClose={() => setViewerOpen(false)}
        onNavigate={setCurrentImageIndex}
      />
    )}

    <AssignTaskDialog
      task={task}
      open={assignDialogOpen}
      onOpenChange={setAssignDialogOpen}
      onAssigned={onAssigned}
    />
  </>
  );
};