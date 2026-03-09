import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, Check, X } from 'lucide-react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TaskListItem } from '@/components/TaskListItem';
import type { Task, TaskPriority } from '@/types/task';

interface TaskOnlyBrainDumpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksCreated: () => void;
  userId: string;
  selectedProjectId: string | null;
  selectedProjectName: string;
  onRecordingChange?: (isRecording: boolean) => void;
}

interface ExtractedTask {
  title: string;
  description?: string;
  priority: TaskPriority;
}

export const TaskOnlyBrainDumpDialog = ({ 
  open, 
  onOpenChange, 
  onTasksCreated, 
  userId,
  selectedProjectId,
  selectedProjectName,
  onRecordingChange
}: TaskOnlyBrainDumpDialogProps) => {
  const { isRecording, audioBlob, startRecording, stopRecording, reset } = useVoiceRecorder();

  // Report recording state changes to parent
  React.useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [editableTasks, setEditableTasks] = useState<ExtractedTask[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleStartRecording = async () => {
    try {
      await startRecording();
    } catch (error: any) {
      console.error('Recording error:', error);
      
      let errorMessage = 'Could not start recording. ';
      
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow microphone access in your browser settings.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No microphone found on this device.';
      } else if (error.name === 'NotSupportedError') {
        errorMessage += 'Recording is not supported on this browser.';
      } else {
        errorMessage += 'Please try again or use a different browser.';
      }
      
      toast.error(errorMessage);
    }
  };

  const handleStopRecording = async () => {
    stopRecording();
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleTranscribe = async () => {
    if (!audioBlob) return;

    setIsTranscribing(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);

      const { data, error } = await supabase.functions.invoke('focusos-focusos-transcribe-audio', {
        body: { audio: base64Audio },
      });

      if (error) throw error;

      setTranscription(data.text);
      await handleExtractTasks(data.text);
    } catch (error) {
      console.error('Transcription error:', error);
      toast.error('Failed to transcribe audio. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleExtractTasks = async (text: string) => {
    setIsExtracting(true);
    try {
      const { data, error } = await supabase.functions.focusos-invoke('extract-tasks', {
        body: { 
          transcription: text,
          mode: 'tasks-only'
        },
      });

      if (error) throw error;

      setEditableTasks(data.tasks);
    } catch (error) {
      console.error('Extraction error:', error);
      toast.error('Failed to extract tasks. Please try again.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedProjectId) {
      toast.error('No project selected');
      return;
    }

    if (editableTasks.length === 0) {
      toast.error('Please add at least one task');
      return;
    }

    setIsSaving(true);
    
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        throw new Error('User not authenticated');
      }

      // Create tasks with selectedProjectId
      const tasksToInsert = editableTasks.map(task => ({
        title: task.title.trim(),
        description: task.description?.trim() || null,
        priority: task.priority,
        status: 'todo' as const,
        user_id: user.id,
        project_id: selectedProjectId,
        timer_total_seconds: 0,
        timer_is_running: false,
      }));

      const { error: tasksError } = await (supabase as any)
        .from('focusos_tasks')
        .insert(tasksToInsert);

      if (tasksError) throw tasksError;

      toast.success(`Added ${editableTasks.length} task${editableTasks.length > 1 ? 's' : ''} to ${selectedProjectName}`);

      handleClose();
      onTasksCreated();
    } catch (error: any) {
      toast.error('Failed to save tasks', {
        description: error.message
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    reset();
    setTranscription('');
    setEditableTasks([]);
    onOpenChange(false);
  };

  const removeTask = (index: number) => {
    setEditableTasks(editableTasks.filter((_, i) => i !== index));
  };

  // Convert extracted tasks to Task objects for preview
  const previewTasks: Task[] = editableTasks.map((task, index) => ({
    id: `preview-${index}`,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: 'todo' as const,
    timer: {
      totalSeconds: 0,
      isRunning: false,
    },
  }));

  const handleTaskUpdate = (updatedTask: Task) => {
    const index = parseInt(updatedTask.id.split('-')[1]);
    const updated = [...editableTasks];
    updated[index] = {
      title: updatedTask.title,
      description: updatedTask.description,
      priority: updatedTask.priority,
    };
    setEditableTasks(updated);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto px-4 sm:px-6">
        <DialogHeader>
          <DialogTitle>Speak to Add Tasks to {selectedProjectName}</DialogTitle>
          <DialogDescription>
            A.I. will listen to your ideas, summarise them, and neatly compile them into plausible tasks within your current project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Project Banner */}
          {selectedProjectId && (
            <div className="px-4 py-3 bg-primary/10 border border-primary/20 rounded-lg">
              <p className="text-sm font-medium text-primary">
                📁 Adding tasks to: <span className="font-bold">{selectedProjectName}</span>
              </p>
            </div>
          )}

          {/* Recording Section */}
          {editableTasks.length === 0 && (
            <div className="flex flex-col items-center space-y-4">
              <div className="flex flex-col sm:flex-row gap-4 w-full">
                {!isRecording && !audioBlob && (
                  <Button onClick={handleStartRecording} size="lg" className="w-full sm:w-auto">
                    <Mic className="mr-2 h-5 w-5" />
                    I'm ready to Speak!
                  </Button>
                )}
                
                {isRecording && (
                  <Button onClick={handleStopRecording} variant="destructive" size="lg" className="w-full sm:w-auto">
                    <MicOff className="mr-2 h-5 w-5" />
                    Stop Listening
                  </Button>
                )}

                {audioBlob && !isTranscribing && !isExtracting && (
                  <>
                    <Button onClick={handleTranscribe} size="lg" className="w-full sm:flex-1">
                      Extract Tasks
                    </Button>
                    <Button onClick={reset} variant="outline" size="lg" className="w-full sm:w-auto">
                      Record Again
                    </Button>
                  </>
                )}
              </div>

              {isRecording && (
                <div className="text-sm text-muted-foreground animate-pulse">
                  Listening
                </div>
              )}

              {(isTranscribing || isExtracting) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isTranscribing ? 'Transcribing audio...' : 'Extracting tasks...'}
                </div>
              )}
            </div>
          )}

          {/* Edit Section */}
          {editableTasks.length > 0 && (
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-sm font-medium">Review & Edit Tasks</span>
                  <span className="text-sm text-muted-foreground">
                    {editableTasks.length} task{editableTasks.length !== 1 ? 's' : ''}
                  </span>
                </div>
                
                <div className="space-y-3">
                  {previewTasks.map((task, index) => (
                    <div key={task.id} className="relative group pb-2">
                      <TaskListItem 
                        task={task}
                        onUpdate={handleTaskUpdate}
                        globalViewMode="full"
                        isIndividuallyExpanded={false}
                        onTaskClick={() => {}}
                      />
                      <Button
                        onClick={() => removeTask(index)}
                        variant="destructive"
                        size="sm"
                        className="absolute bottom-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                <Button 
                  onClick={handleConfirm} 
                  className="w-full sm:flex-1"
                  disabled={isSaving || editableTasks.length === 0}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Save Tasks
                    </>
                  )}
                </Button>
                <Button 
                  onClick={handleClose} 
                  variant="outline" 
                  disabled={isSaving}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};