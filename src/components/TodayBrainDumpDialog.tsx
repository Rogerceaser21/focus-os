import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TaskCard } from './TaskCard';
import { Task } from '@/types/task';

interface TodayBrainDumpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksCreated: () => void;
  userId: string;
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
}: TodayBrainDumpDialogProps) => {
  const { isRecording, audioBlob, startRecording, stopRecording, reset } = useVoiceRecorder();
  const [transcription, setTranscription] = useState('');
  const [editableTasks, setEditableTasks] = useState<ExtractedTask[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleStartRecording = async () => {
    try {
      await startRecording();
      toast.success('Recording started');
    } catch (error) {
      toast.error('Failed to start recording', {
        description: 'Please check microphone permissions',
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

      const { data, error } = await supabase.functions.invoke('transcribe-audio', {
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
      const { data, error } = await supabase.functions.invoke('extract-tasks', {
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

      const { error: tasksError } = await supabase
        .from('tasks')
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Brain Dump - Add Tasks to Today's To-Do</DialogTitle>
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
              <div className="flex flex-col items-center gap-4 py-8">
                {!isRecording && !audioBlob && (
                  <Button
                    onClick={handleStartRecording}
                    size="lg"
                    className="h-20 w-20 rounded-full"
                    disabled={isTranscribing || isExtracting}
                  >
                    <Mic className="h-8 w-8" />
                  </Button>
                )}

                {isRecording && (
                  <Button
                    onClick={handleStopRecording}
                    size="lg"
                    variant="destructive"
                    className="h-20 w-20 rounded-full animate-pulse"
                  >
                    <Square className="h-8 w-8" />
                  </Button>
                )}

                {audioBlob && !isRecording && (
                  <div className="flex flex-col items-center gap-4">
                    <Button
                      onClick={handleTranscribe}
                      disabled={isTranscribing || isExtracting}
                      size="lg"
                    >
                      {isTranscribing || isExtracting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {isTranscribing ? 'Transcribing...' : 'Extracting tasks...'}
                        </>
                      ) : (
                        'Process Recording'
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        reset();
                        setTranscription('');
                      }}
                      variant="outline"
                      disabled={isTranscribing || isExtracting}
                    >
                      Record Again
                    </Button>
                  </div>
                )}

                <p className="text-sm text-muted-foreground text-center max-w-md">
                  {isRecording
                    ? 'Recording... Click stop when done'
                    : audioBlob
                    ? 'Click "Process Recording" to transcribe and extract tasks'
                    : 'Click the microphone to start recording your tasks'}
                </p>
              </div>

              {/* Show transcription if available */}
              {transcription && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">Transcription:</p>
                  <p className="text-sm">{transcription}</p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Task Review */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Review Tasks</h3>
                  <p className="text-sm text-muted-foreground">
                    {editableTasks.length} task{editableTasks.length !== 1 ? 's' : ''}
                  </p>
                </div>

                {editableTasks.map((task, index) => (
                  <div key={index} className="relative group">
                    <TaskCard
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
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeTask(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleConfirm}
                  disabled={isSaving}
                  className="flex-1"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    `Add Tasks to Today's To-Do`
                  )}
                </Button>
                <Button onClick={handleClose} variant="outline" disabled={isSaving}>
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
