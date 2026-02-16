import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Loader2, Check, X, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TaskListItem } from '@/components/TaskListItem';
import { useBrainDumpLive, BrainDumpTask } from '@/hooks/useBrainDumpLive';
import { motion, AnimatePresence } from 'framer-motion';
import type { Task, TaskPriority } from '@/types/task';

type BrainDumpMode = 'new-project' | 'existing-project' | 'today';

interface BrainDumpLiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BrainDumpMode;
  userId: string;
  // For new-project mode
  onProjectCreated?: (newProjectId: string) => void;
  // For existing-project mode
  selectedProjectId?: string | null;
  selectedProjectName?: string;
  // For all modes
  onTasksCreated: () => void;
  onRecordingChange?: (isRecording: boolean) => void;
}

export const BrainDumpLiveDialog = ({
  open,
  onOpenChange,
  mode,
  userId,
  onProjectCreated,
  selectedProjectId,
  selectedProjectName,
  onTasksCreated,
  onRecordingChange,
}: BrainDumpLiveDialogProps) => {
  const { tasks, connectionState, start, stop, updateTask, removeTask, resetTasks } = useBrainDumpLive();
  const [projectName, setProjectName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);

  // Report recording state changes to parent
  React.useEffect(() => {
    onRecordingChange?.(connectionState === 'listening');
  }, [connectionState, onRecordingChange]);

  const handleStart = async () => {
    try {
      await start(mode);
    } catch (error: any) {
      let errorMessage = 'Could not start Brain Dump. ';
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow microphone access in your browser settings.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No microphone found on this device.';
      } else {
        errorMessage += error.message || 'Please try again.';
      }
      toast.error(errorMessage);
    }
  };

  const handleDone = () => {
    stop();
    setIsDone(true);
  };

  const handleClose = () => {
    stop();
    resetTasks();
    setProjectName('');
    setIsDone(false);
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (tasks.length === 0) {
      toast.error('No tasks to save');
      return;
    }

    if (mode === 'new-project' && !projectName.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    if (mode === 'existing-project' && !selectedProjectId) {
      toast.error('No project selected');
      return;
    }

    setIsSaving(true);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('User not authenticated');

      let projectId: string | null = null;

      if (mode === 'new-project') {
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .insert({ name: projectName.trim(), user_id: user.id, color: '#3b82f6' })
          .select()
          .single();
        if (projectError) throw projectError;
        projectId = project.id;
      } else if (mode === 'existing-project') {
        projectId = selectedProjectId!;
      }
      // mode === 'today' → projectId stays null

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasksToInsert = tasks.map(task => ({
        title: task.title.trim(),
        description: task.description?.trim() || null,
        priority: task.priority,
        status: 'todo' as const,
        user_id: user.id,
        project_id: projectId,
        ...(mode === 'today' ? { due_date: today.toISOString() } : {}),
        timer_total_seconds: 0,
        timer_is_running: false,
      }));

      const { error: tasksError } = await supabase.from('tasks').insert(tasksToInsert);
      if (tasksError) throw tasksError;

      const targetName = mode === 'new-project'
        ? `"${projectName.trim()}"`
        : mode === 'today'
        ? "Today's To-Do"
        : selectedProjectName || 'project';

      toast.success(`Added ${tasks.length} task${tasks.length > 1 ? 's' : ''} to ${targetName}`);

      if (mode === 'new-project' && projectId && onProjectCreated) {
        onProjectCreated(projectId);
      }

      handleClose();
      onTasksCreated();
    } catch (error: any) {
      toast.error('Failed to save tasks', { description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTaskUpdate = (updatedTask: Task) => {
    const bdTask = tasks.find(t => t.id === updatedTask.id);
    if (bdTask) {
      updateTask(updatedTask.id, {
        title: updatedTask.title,
        description: updatedTask.description,
        priority: updatedTask.priority,
      });
    }
  };

  // Convert BrainDumpTasks to Task objects for TaskListItem preview
  const previewTasks: Task[] = tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: 'todo' as const,
    timer: { totalSeconds: 0, isRunning: false },
  }));

  const getTitle = () => {
    switch (mode) {
      case 'new-project': return 'Brain Dump — New Project';
      case 'existing-project': return `Brain Dump — ${selectedProjectName || 'Project'}`;
      case 'today': return "Brain Dump — Today's To-Do";
    }
  };

  const getDescription = () => {
    return 'Just start talking. AI will listen and extract tasks in real-time as you speak.';
  };

  const getBannerText = () => {
    switch (mode) {
      case 'new-project': return '🆕 Creating a new project with tasks';
      case 'existing-project': return `📁 Adding tasks to: ${selectedProjectName}`;
      case 'today': return "📅 Adding tasks to: Today's To-Do";
    }
  };

  const isListening = connectionState === 'listening';
  const isConnecting = connectionState === 'connecting';
  const isError = connectionState === 'error';
  const showRecording = !isDone && (connectionState === 'idle' || isListening || isConnecting || isError);
  const showReview = isDone || (tasks.length > 0 && connectionState === 'idle' && !isConnecting);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto px-4 sm:px-6">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Banner */}
          <div className="px-4 py-3 bg-primary/10 border border-primary/20 rounded-lg">
            <p className="text-sm font-medium text-primary">{getBannerText()}</p>
          </div>

          {/* Project Name Input (new-project mode only) */}
          {mode === 'new-project' && isDone && (
            <div className="space-y-2">
              <Label htmlFor="projectName">Project Name</Label>
              <Input
                id="projectName"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name"
              />
            </div>
          )}

          {/* Recording Controls */}
          {!isDone && (
            <div className="flex flex-col items-center space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 w-full">
                {connectionState === 'idle' && (
                  <Button onClick={handleStart} size="lg" className="w-full sm:w-auto">
                    <Mic className="mr-2 h-5 w-5" />
                    Start Brain Dump
                  </Button>
                )}

                {isConnecting && (
                  <Button disabled size="lg" className="w-full sm:w-auto">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Connecting...
                  </Button>
                )}

                {isListening && (
                  <Button onClick={handleDone} variant="destructive" size="lg" className="w-full sm:w-auto">
                    <MicOff className="mr-2 h-5 w-5" />
                    I'm Done
                  </Button>
                )}

                {isError && (
                  <div className="flex flex-col sm:flex-row gap-4 w-full items-center">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      Connection failed
                    </div>
                    <Button onClick={handleStart} size="lg" className="w-full sm:w-auto">
                      <Mic className="mr-2 h-5 w-5" />
                      Try Again
                    </Button>
                  </div>
                )}
              </div>

              {/* Listening indicator */}
              {isListening && (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3, 4].map(i => (
                        <motion.div
                          key={i}
                          className="w-1 bg-primary rounded-full"
                          animate={{
                            height: [8, 20, 8],
                          }}
                          transition={{
                            duration: 0.6,
                            repeat: Infinity,
                            delay: i * 0.1,
                            ease: 'easeInOut',
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-sm text-muted-foreground animate-pulse">
                      Listening... speak freely
                    </span>
                  </div>
                  {tasks.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {tasks.length} task{tasks.length !== 1 ? 's' : ''} extracted so far
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Live Task List */}
          {tasks.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-sm font-medium">
                  {isDone ? 'Review & Edit Tasks' : 'Tasks Found'}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {previewTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -100 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="relative group pb-2"
                    >
                      <TaskListItem
                        task={task}
                        onUpdate={handleTaskUpdate}
                        globalViewMode="full"
                        isIndividuallyExpanded={false}
                        onTaskClick={() => {}}
                      />
                      {isDone && (
                        <Button
                          onClick={() => removeTask(task.id)}
                          variant="destructive"
                          size="sm"
                          className="absolute bottom-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Save Controls (after stopping) */}
          {isDone && tasks.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
              <Button
                onClick={handleSave}
                className="w-full sm:flex-1"
                disabled={isSaving || tasks.length === 0 || (mode === 'new-project' && !projectName.trim())}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    {mode === 'new-project' ? 'Save Project & Tasks' : 'Save Tasks'}
                  </>
                )}
              </Button>
              <Button onClick={handleClose} variant="outline" disabled={isSaving} className="w-full sm:w-auto">
                Cancel
              </Button>
            </div>
          )}

          {/* Empty state after stopping with no tasks */}
          {isDone && tasks.length === 0 && (
            <div className="text-center py-8 space-y-4">
              <p className="text-sm text-muted-foreground">
                No tasks were extracted. Try speaking more clearly about specific tasks.
              </p>
              <Button onClick={() => { setIsDone(false); handleStart(); }}>
                <Mic className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
