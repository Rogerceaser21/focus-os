import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, Check, X } from 'lucide-react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TaskListItem } from '@/components/TaskListItem';
import { Task } from '@/types/task';

interface TodayBrainDumpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksCreated: () => void;
  userId: string;
  onRecordingChange?: (isRecording: boolean) => void;
}

interface ExtractedTask {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export const TodayBrainDumpDialog = ({
  open,
  onOpenChange,
  onTasksCreated,
  userId,
  onRecordingChange,
}: TodayBrainDumpDialogProps) => {
  const { isRecording, audioBlob, startRecording, stopRecording, reset } = useVoiceRecorder();

  // Report recording state changes to parent
  React.useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);
  const [transcription, setTranscription] = useState('');
  const [editableTasks, setEditableTasks] = useState<ExtractedTask[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleStartRecording = async () => {
    try {
      await startRecording();
      toast.success('Recording started');
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
      
      toast.error('Failed to start recording', {
        description: errorMessage,
      });
    }
  };

  const handleStopRecording = () => {
    stopRecording();
    toast.success('Recording stopped');
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleTranscribe = async () => {
    if (!audioBlob) {
      toast.error('No recording found');
      return;
    }

    setIsTranscribing(true);

    try {
      const base64Audio = await blobToBase64(audioBlob);

      const { data, error } = await supabase.functions.invoke('focusos-focusos-transcribe-audio', {
        body: { audio: base64Audio },
      });

      if (error) throw error;

      const transcribedText = data.text;
      setTranscription(transcribedText);

      await handleExtractTasks(transcribedText);
    } catch (error: any) {
      console.error('Transcription error:', error);
      toast.error('Failed to transcribe audio', {
        description: error.message,
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleExtractTasks = async (text: string) => {
    setIsExtracting(true);

    try {
      const { data, error } = await supabase.functions.invoke('focusos-extract-tasks', {
        body: { 
          transcription: text,
          mode: 'tasks-only'
        },
      });

      if (error) throw error;

      setEditableTasks(data.tasks);
      toast.success(`Extracted ${data.tasks.length} task${data.tasks.length > 1 ? 's' : ''}`);
    } catch (error: any) {
      console.error('Task extraction error:', error);
      toast.error('Failed to extract tasks', {
        description: error.message,
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirm = async () => {
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

      // Get today's date at start of day
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Create tasks with today's due date and no project_id
      const tasksToInsert = editableTasks.map(task => ({
        title: task.title.trim(),
        description: task.description?.trim() || null,
        priority: task.priority,
        status: 'todo' as const,
        user_id: user.id,
        project_id: null,
        due_date: today.toISOString(),
        timer_total_seconds: 0,
        timer_is_running: false,
      }));

      const { error: tasksError } = await (supabase as any)
        .from('focusos_tasks')
        .insert(tasksToInsert);

      if (tasksError) throw tasksError;

      toast.success(`Added ${editableTasks.length} task${editableTasks.length > 1 ? 's' : ''} to Today's To-Do`);

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
    setTranscription('');
    setEditableTasks([]);
    reset();
    onOpenChange(false);
  };

  const removeTask = (index: number) => {
    setEditableTasks(prev => prev.filter((_, i) => i !== index));
  };

  const handleTaskUpdate = (index: number, updatedTask: ExtractedTask) => {
    setEditableTasks(prev => 
      prev.map((task, i) => i === index ? updatedTask : task)
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto px-4 sm:px-6">
        <DialogHeader>
          <DialogTitle>Speak to Add Tasks to Today's To-Do</DialogTitle>
          <p className="text-sm text-muted-foreground">
            A.I. will listen to your ideas, summarise them, and neatly compile them into plausible tasks for today.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Banner showing target */}
          <div className="px-4 py-3 bg-primary/10 border border-primary/20 rounded-lg">
            <p className="text-sm font-medium text-primary">
              📅 Adding tasks to: <span className="font-bold">Today's To-Do</span>
            </p>
          </div>

          {editableTasks.length === 0 ? (
            <>
              {/* Recording Controls */}
              <div className="flex flex-col sm:flex-row gap-4 w-full">
                {!isRecording && !audioBlob && (
                  <Button
                    onClick={handleStartRecording}
                    size="lg"
                    className="w-full sm:w-auto"
                    disabled={isTranscribing || isExtracting}
                  >
                    <Mic className="mr-2 h-4 w-4" />
                    I'm ready to Speak!
                  </Button>
                )}

                {isRecording && (
                  <Button
                    onClick={handleStopRecording}
                    size="lg"
                    variant="destructive"
                    className="w-full sm:w-auto"
                  >
                    <MicOff className="mr-2 h-4 w-4" />
                    Stop Listening
                  </Button>
                )}

                {audioBlob && !isRecording && (
                  <>
                    <Button
                      onClick={handleTranscribe}
                      disabled={isTranscribing || isExtracting}
                      size="lg"
                      className="w-full sm:flex-1"
                    >
                      {isTranscribing || isExtracting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {isTranscribing ? 'Transcribing...' : 'Extracting tasks...'}
                        </>
                      ) : (
                        'Extract Tasks'
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        reset();
                        setTranscription('');
                      }}
                      variant="outline"
                      disabled={isTranscribing || isExtracting}
                      className="w-full sm:w-auto"
                    >
                      Record Again
                    </Button>
                  </>
                )}
              </div>

              {isRecording && (
                <p className="text-sm text-muted-foreground text-center">
                  Listening
                </p>
              )}
            </>
          ) : (
            <>
              {/* Task Review */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <h3 className="text-lg font-semibold">Review & Edit Tasks</h3>
                  <p className="text-sm text-muted-foreground">
                    {editableTasks.length} task{editableTasks.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {editableTasks.map((task, index) => (
                  <div key={index} className="relative group pb-2">
                    <TaskListItem
                      task={{
                        id: `temp-${index}`,
                        title: task.title,
                        description: task.description,
                        priority: task.priority,
                        status: 'todo',
                        timer: { totalSeconds: 0, isRunning: false },
                      }}
                      onUpdate={(updatedTask) => {
                        handleTaskUpdate(index, {
                          title: updatedTask.title,
                          description: updatedTask.description,
                          priority: updatedTask.priority,
                        });
                      }}
                      globalViewMode="full"
                      isIndividuallyExpanded={false}
                      onTaskClick={() => {}}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute bottom-2 right-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-10 h-8 w-8"
                      onClick={() => removeTask(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                <Button
                  onClick={handleConfirm}
                  disabled={isSaving}
                  className="w-full sm:flex-1"
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
                <Button onClick={handleClose} variant="outline" disabled={isSaving} className="w-full sm:w-auto">
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
