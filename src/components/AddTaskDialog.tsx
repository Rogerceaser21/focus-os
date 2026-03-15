import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Task, TaskPriority, TaskStatus } from '@/types/task';
import { Plus, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ImageViewer } from '@/components/ImageViewer';

interface Project {
  id: string;
  name: string;
  color: string;
}

interface AddTaskDialogProps {
  onAddTask: (task: Task) => void;
  selectedProjectId?: string | null;
  selectedSpecialList?: string | null;
  projects?: Project[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export const AddTaskDialog = ({ onAddTask, selectedProjectId, selectedSpecialList, projects = [], open: controlledOpen, onOpenChange, showTrigger = true }: AddTaskDialogProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [dueDate, setDueDate] = useState<Date>();
  const [images, setImages] = useState<string[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [projectId, setProjectId] = useState<string | undefined>(selectedProjectId || undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const MAX_IMAGES = 8;

  // Auto-set due date to today when creating task in "Today's To-Do" view
  useEffect(() => {
    if (open && selectedSpecialList === 'today' && !dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setDueDate(today);
    }
  }, [open, selectedSpecialList, dueDate]);

  useEffect(() => {
    if (!open) return;

    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          if (images.length >= MAX_IMAGES) {
            toast.error('Maximum 8 images per task');
            return;
          }
          
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              setImages(prev => [...prev, event.target?.result as string]);
              toast.success('Image pasted successfully');
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

  // Sync projectId with selectedProjectId when dialog opens
  useEffect(() => {
    if (open) {
      setProjectId(selectedProjectId || undefined);
    }
  }, [open, selectedProjectId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error('Maximum 8 images per task');
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
          if (files.length > remaining) {
            toast.warning(`Only added ${remaining} images (limit: 8)`);
          } else {
            toast.success(`Added ${filesToAdd.length} image(s)`);
          }
        }
      };
      reader.readAsDataURL(file);
    });
  };
  
  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
    toast.success('Image removed');
  };

  const handleImageClick = (index: number) => {
    setCurrentImageIndex(index);
    setViewerOpen(true);
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Please enter a task title');
      return;
    }

    const newTask: Task = {
      id: crypto.randomUUID(),
      title,
      description,
      priority,
      status,
      startDate,
      endDate,
      dueDate,
      images,
      timer: {
        totalSeconds: 0,
        isRunning: false
      },
      projectId: projectId || selectedProjectId || undefined
    };

    onAddTask(newTask);
    
    // Reset form
    setTitle('');
    setDescription('');
    setPriority('medium');
    setStatus('todo');
    setStartDate(undefined);
    setEndDate(undefined);
    setDueDate(undefined);
    setImages([]);
    setProjectId(selectedProjectId || undefined);
    setOpen(false);
    
    toast.success('Task created successfully');
  };

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
            <Button className="gap-2 border-2 shadow-lg shadow-primary/20" data-task-tour-step="add-task-button">
              <Plus className="h-4 w-4" />
              <span className="hidden md:inline">Add Task</span>
              <span className="md:hidden">Add</span>
            </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto sm:rounded-lg w-full sm:max-w-2xl mx-0 sm:mx-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Task description"
              rows={3}
            />
          </div>

          {/* Project, Priority, Status - 3 columns on mobile */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="project" className="text-xs">Project</Label>
              <Select value={projectId || "none"} onValueChange={(v) => setProjectId(v === "none" ? undefined : v)}>
                <SelectTrigger id="project" className="text-xs h-9">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: project.color }}
                        />
                        <span className="truncate">{project.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="priority" className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger id="priority" className="text-xs h-9">
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

            <div>
              <Label htmlFor="status" className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger id="status" className="text-xs h-9">
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

          {/* Start Date, End Date, Due Date - 3 columns on mobile */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal text-xs h-9 px-2">
                    <CalendarIcon className="mr-1 h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{startDate ? format(startDate, 'MMM d') : 'Pick'}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label className="text-xs">End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal text-xs h-9 px-2">
                    <CalendarIcon className="mr-1 h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{endDate ? format(endDate, 'MMM d') : 'Pick'}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={endDate} onSelect={setEndDate} />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label className="text-xs">Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal text-xs h-9 px-2">
                    <CalendarIcon className="mr-1 h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{dueDate ? format(dueDate, 'MMM d') : 'Pick'}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={dueDate} onSelect={setDueDate} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <Label htmlFor="image">Images (Optional - Max 8)</Label>
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
                id="file-input"
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

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              Create Task
            </Button>
          </div>
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
  </>
  );
};