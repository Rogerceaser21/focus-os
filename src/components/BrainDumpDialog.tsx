import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Loader2, Check, X } from 'lucide-react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TaskListItem } from '@/components/TaskListItem';
import type { Task, TaskPriority } from '@/types/task';

interface BrainDumpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksCreated: (newProjectId: string) => void;
  userId: string;
  onRecordingChange?: (isRecording: boolean) => void;
}

interface ExtractedTask {
  title: string;
  description?: string;
  priority: TaskPriority;
}

interface ExtractedData {
  projectName: string;
  tasks: ExtractedTask[];
}

export const BrainDumpDialog = ({ open, onOpenChange, onTasksCreated, userId, onRecordingChange }: BrainDumpDialogProps) => {
  const { toast } = useToast();
  const { isRecording, audioBlob, startRecording, stopRecording, reset } = useVoiceRecorder();

  // Report recording state changes to parent
  React.useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [editableProjectName, setEditableProjectName] = useState('');
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
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
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
      toast({
        title: 'Error',
        description: 'Failed to transcribe audio. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleExtractTasks = async (text: string) => {
    setIsExtracting(true);
    try {
      const { data, error } = await supabase.functions.focusos-invoke('extract-tasks', {
        body: { transcription: text },
      });

      if (error) throw error;

      setExtractedData(data);
      setEditableProjectName(data.projectName);
      setEditableTasks(data.tasks);
    } catch (error) {
      console.error('Extraction error:', error);
      toast({
        title: 'Error',
        description: 'Failed to extract tasks. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirm = async () => {
    if (!editableProjectName.trim() || editableTasks.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please provide a project name and at least one task.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    console.log('Starting save process...');
    console.log('User ID:', userId);
    console.log('Project Name:', editableProjectName);
    console.log('Tasks:', editableTasks);

    try {
      // Get current user to verify authentication
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        console.error('Auth error:', authError);
        throw new Error('User not authenticated');
      }

      console.log('Authenticated user:', user.id);

      // Create project
      console.log('Creating project...');
      const { data: project, error: projectError } = await (supabase as any)
        .from('focusos_projects')
        .insert({
          name: editableProjectName.trim(),
          user_id: user.id,
          color: '#3b82f6',
        })
        .select()
        .single();

      if (projectError) {
        console.error('Project creation error:', projectError);
        throw projectError;
      }

      console.log('Project created:', project);

      // Create tasks
      console.log('Creating tasks...');
      const tasksToInsert = editableTasks.map(task => ({
        title: task.title.trim(),
        description: task.description?.trim() || null,
        priority: task.priority,
        status: 'todo' as const,
        user_id: user.id,
        project_id: project.id,
        timer_total_seconds: 0,
        timer_is_running: false,
      }));

      console.log('Tasks to insert:', tasksToInsert);

      const { data: insertedTasks, error: tasksError } = await supabase
        .from('tasks')
        .insert(tasksToInsert)
        .select();

      if (tasksError) {
        console.error('Tasks creation error:', tasksError);
        throw tasksError;
      }

      console.log('Tasks created:', insertedTasks);

      toast({
        title: 'Success!',
        description: `Created project "${editableProjectName}" with ${editableTasks.length} task${editableTasks.length > 1 ? 's' : ''}`,
      });

      handleClose();
      onTasksCreated(project.id);
    } catch (error: any) {
      console.error('Save error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save project and tasks. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    reset();
    setTranscription('');
    setExtractedData(null);
    setEditableProjectName('');
    setEditableTasks([]);
    onOpenChange(false);
  };

  const updateTask = (index: number, field: keyof ExtractedTask, value: string) => {
    const updated = [...editableTasks];
    updated[index] = { ...updated[index], [field]: value };
    setEditableTasks(updated);
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
          <DialogTitle>Speak to Create a New Project</DialogTitle>
          <DialogDescription>
            A.I. will listen to your ideas, summarise them, and neatly compile them into plausible tasks within the newly created project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Recording Section */}
          {!extractedData && (
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
          {extractedData && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="projectName">Project Name</Label>
                <Input
                  id="projectName"
                  value={editableProjectName}
                  onChange={(e) => setEditableProjectName(e.target.value)}
                  placeholder="Enter project name"
                />
              </div>

              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <Label>Review & Edit Tasks</Label>
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

                {editableTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No tasks extracted. Try recording again.
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                <Button 
                  onClick={handleConfirm} 
                  className="w-full sm:flex-1"
                  disabled={isSaving || editableTasks.length === 0 || !editableProjectName.trim()}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Save Project & Tasks
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
