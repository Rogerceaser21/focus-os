import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, Check, X, AlertCircle, Calendar, FolderPlus, FolderOpen } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TaskListItem } from '@/components/TaskListItem';
import { useBrainDumpLive, BrainDumpTask, ProjectInfo } from '@/hooks/useBrainDumpLive';
import { motion, AnimatePresence } from 'framer-motion';
import type { Task, TaskPriority } from '@/types/task';


interface BrainDumpLiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  projects: ProjectInfo[];
  onProjectCreated?: (newProjectId: string) => void;
  onTasksCreated: () => void;
  onRecordingChange?: (isRecording: boolean) => void;
}

export const BrainDumpLiveDialog = ({
  open,
  onOpenChange,
  userId,
  projects,
  onProjectCreated,
  onTasksCreated,
  onRecordingChange,
}: BrainDumpLiveDialogProps) => {
  const { tasks, connectionState, silenceCountdown, start, stop, setAutoStopCallback, updateTask, removeTask, resetTasks } = useBrainDumpLive();
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);

  // Wire auto-stop: when VAD detects 30s silence, treat it as "I'm Done"
  useEffect(() => {
    setAutoStopCallback(() => {
      stop();
      setIsDone(true);
      toast.info('Stopped listening — no speech detected for 30 seconds');
    });
    return () => setAutoStopCallback(null);
  }, [setAutoStopCallback, stop]);

  // Report recording state changes to parent
  React.useEffect(() => {
    onRecordingChange?.(connectionState === 'listening');
  }, [connectionState, onRecordingChange]);

  // Group tasks by destination
  const groupedTasks = useMemo(() => {
    const groups: Record<string, { label: string; icon: 'today' | 'existing' | 'new'; tasks: BrainDumpTask[] }> = {};

    for (const task of tasks) {
      let key: string;
      let label: string;
      let icon: 'today' | 'existing' | 'new';

      if (task.destination === 'today') {
        key = '__today__';
        label = "Today's To-Do";
        icon = 'today';
      } else if (task.destination === 'existing-project') {
        key = `existing:${task.projectId}`;
        label = task.projectName || 'Project';
        icon = 'existing';
      } else {
        key = `new:${(task.projectName || '').toLowerCase().trim()}`;
        label = task.projectName || 'New Project';
        icon = 'new';
      }

      if (!groups[key]) {
        groups[key] = { label, icon, tasks: [] };
      }
      groups[key].tasks.push(task);
    }

    return groups;
  }, [tasks]);

  const handleStart = async () => {
    try {
      await start(projects);
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

  const handleKeepTalking = async () => {
    setIsDone(false);
    try {
      await start(projects);
    } catch (error: any) {
      let errorMessage = 'Could not restart listening. ';
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow microphone access in your browser settings.';
      } else {
        errorMessage += error.message || 'Please try again.';
      }
      toast.error(errorMessage);
      setIsDone(true);
    }
  };

  const handleClose = () => {
    stop();
    resetTasks();
    setIsDone(false);
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (tasks.length === 0) {
      toast.error('No tasks to save');
      return;
    }

    setIsSaving(true);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('User not authenticated');

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Collect unique new project names to create
      const newProjectNames = new Map<string, string>();
      for (const task of tasks) {
        if (task.destination === 'new-project' && task.projectName) {
          const key = task.projectName.toLowerCase().trim();
          if (!newProjectNames.has(key)) {
            newProjectNames.set(key, task.projectName);
          }
        }
      }

      // Create new projects
      const newProjectIds = new Map<string, string>(); // normalized name -> id
      for (const [key, name] of newProjectNames) {
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .insert({ name: name.trim(), user_id: user.id, color: '#3b82f6' })
          .select()
          .single();
        if (projectError) throw projectError;
        newProjectIds.set(key, project.id);
      }

      // Build task inserts
      const tasksToInsert = tasks.map(task => {
        let projectId: string | null = null;

        if (task.destination === 'existing-project' && task.projectId) {
          projectId = task.projectId;
        } else if (task.destination === 'new-project' && task.projectName) {
          projectId = newProjectIds.get(task.projectName.toLowerCase().trim()) || null;
        }

        // Dates: explicit Gemini-extracted dates take priority; fall back to today for today-tasks
        const explicitDueDate = task.dueDate ? new Date(task.dueDate).toISOString() : null;
        const fallbackDueDate = task.destination === 'today' && !explicitDueDate ? today.toISOString() : null;

        return {
          title: task.title.trim(),
          description: task.description?.trim() || null,
          priority: task.priority,
          status: 'todo' as const,
          user_id: user.id,
          project_id: projectId,
          due_date: explicitDueDate || fallbackDueDate,
          ...(task.startDate ? { start_date: new Date(task.startDate).toISOString() } : {}),
          ...(task.endDate ? { end_date: new Date(task.endDate).toISOString() } : {}),
          timer_total_seconds: 0,
          timer_is_running: false,
        };
      });

      const { error: tasksError } = await supabase.from('tasks').insert(tasksToInsert);
      if (tasksError) throw tasksError;

      toast.success(`Added ${tasks.length} task${tasks.length > 1 ? 's' : ''}`);

      // Notify parent about new projects
      for (const [, projectId] of newProjectIds) {
        onProjectCreated?.(projectId);
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
        ...(updatedTask.startDate ? { startDate: updatedTask.startDate.toISOString().split('T')[0] } : { startDate: undefined }),
        ...(updatedTask.endDate ? { endDate: updatedTask.endDate.toISOString().split('T')[0] } : { endDate: undefined }),
        ...(updatedTask.dueDate ? { dueDate: updatedTask.dueDate.toISOString().split('T')[0] } : { dueDate: undefined }),
      });
    }
  };

  // Convert BrainDumpTasks to Task objects for TaskListItem preview
  const toPreviewTask = (t: BrainDumpTask): Task => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: 'todo' as const,
    timer: { totalSeconds: 0, isRunning: false },
  });

  const getGroupIcon = (icon: 'today' | 'existing' | 'new') => {
    switch (icon) {
      case 'today': return <Calendar className="h-4 w-4 text-primary" />;
      case 'existing': return <FolderOpen className="h-4 w-4 text-primary" />;
      case 'new': return <FolderPlus className="h-4 w-4 text-accent-foreground" />;
    }
  };

  const isListening = connectionState === 'listening';
  const isConnecting = connectionState === 'connecting';
  const isError = connectionState === 'error';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto px-4 sm:px-6">
        <DialogHeader className="sr-only">
          <DialogTitle>Brain Dump</DialogTitle>
          <DialogDescription>Just start talking. AI will listen, extract tasks, and route them automatically.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Header Cards — shown when not done, OR when done but user wants to keep talking */}
          {!isDone && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Card: Title + Controls */}
              <div className="glass-card rounded-2xl p-5 flex flex-col justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Brain Dump</h2>
                  <p className="text-sm text-muted-foreground mt-1">Just start talking. AI will listen, extract tasks, and route them automatically.</p>
                </div>
                <div>
                  {connectionState === 'idle' && (
                    <Button onClick={handleStart} size="lg" className="w-full">
                      <Mic className="mr-2 h-5 w-5" />
                      I'm Ready
                    </Button>
                  )}
                  {isConnecting && (
                    <Button disabled size="lg" className="w-full">
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Connecting...
                    </Button>
                  )}
                  {isListening && (
                    <Button onClick={handleDone} variant="destructive" size="lg" className="w-full">
                      <MicOff className="mr-2 h-5 w-5" />
                      I'm Done
                    </Button>
                  )}
                  {isError && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        Connection failed
                      </div>
                      <Button onClick={handleStart} size="lg" className="w-full">
                        <Mic className="mr-2 h-5 w-5" />
                        Try Again
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Card: Listening Animation */}
              <div className="glass-card rounded-2xl p-5 flex flex-col items-center justify-center min-h-[140px]">
                {isListening ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                        <motion.div
                          key={i}
                          className="w-1 rounded-full bg-primary"
                          animate={{ height: [6, 28, 6] }}
                          transition={{
                            duration: 0.7,
                            repeat: Infinity,
                            delay: i * 0.08,
                            ease: 'easeInOut',
                          }}
                        />
                      ))}
                    </div>
                    {silenceCountdown !== null ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-sm text-destructive font-medium animate-pulse">
                          Auto-stopping in {silenceCountdown}s…
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Speak to continue
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground animate-pulse">
                        Listening… speak freely
                      </span>
                    )}
                    {tasks.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {tasks.length} task{tasks.length !== 1 ? 's' : ''} extracted so far
                      </span>
                    )}
                  </div>
                ) : isConnecting ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Setting up…</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground/40">
                    <Mic className="h-10 w-10" />
                    <span className="text-sm">Waiting to start…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Grouped Task List */}
          {tasks.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {isDone ? 'Review & Edit Tasks' : 'Tasks Found'}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                </span>
              </div>

              {Object.entries(groupedTasks).map(([groupKey, group]) => (
                <div key={groupKey} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    {getGroupIcon(group.icon)}
                    <span className="text-sm font-medium text-muted-foreground">
                      {group.icon === 'new' && '🆕 '}
                      {group.label}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      ({group.tasks.length})
                    </span>
                  </div>

                  <div className="space-y-2 pl-2 border-l-2 border-muted/30">
                    <AnimatePresence initial={false}>
                      {group.tasks.map((task) => (
                        <motion.div
                          key={task.id}
                          initial={{ opacity: 0, y: 20, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, x: -100 }}
                          transition={{ duration: 0.3, ease: 'easeOut' }}
                          className="relative group pb-1"
                        >
                          <TaskListItem
                            task={toPreviewTask(task)}
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
                              className="absolute bottom-1 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Save Controls (after stopping) */}
          {isDone && tasks.length > 0 && (
            <div className="flex flex-col gap-3 pt-4 border-t">
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleSave}
                  className="w-full sm:flex-1"
                  disabled={isSaving || tasks.length === 0}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Save All Tasks
                    </>
                  )}
                </Button>
                <Button onClick={handleClose} variant="outline" disabled={isSaving} className="w-full sm:w-auto">
                  Cancel
                </Button>
              </div>
              {/* Keep Talking button */}
              <Button
                onClick={handleKeepTalking}
                variant="ghost"
                disabled={isSaving}
                className="w-full text-muted-foreground hover:text-foreground"
              >
                <Mic className="mr-2 h-4 w-4" />
                Keep Talking — add more tasks
              </Button>
            </div>
          )}

          {/* Empty state after stopping with no tasks */}
          {isDone && tasks.length === 0 && (
            <div className="text-center py-8 space-y-4">
              <p className="text-sm text-muted-foreground">
                No tasks were extracted. Try speaking more clearly about specific tasks.
              </p>
              <Button onClick={handleKeepTalking}>
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
