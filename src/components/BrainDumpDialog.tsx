import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, MicOff, Loader2, Check, X } from 'lucide-react';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { TaskPriority } from '@/types/task';

interface BrainDumpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTasksCreated: () => void;
  userId: string;
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

export const BrainDumpDialog = ({ open, onOpenChange, onTasksCreated, userId }: BrainDumpDialogProps) => {
  const { toast } = useToast();
  const { isRecording, audioBlob, startRecording, stopRecording, reset } = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [editableProjectName, setEditableProjectName] = useState('');
  const [editableTasks, setEditableTasks] = useState<ExtractedTask[]>([]);

  const handleStartRecording = async () => {
    try {
      await startRecording();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Could not access microphone. Please check permissions.',
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

      const { data, error } = await supabase.functions.invoke('transcribe-audio', {
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
      const { data, error } = await supabase.functions.invoke('extract-tasks', {
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
    if (!editableProjectName || editableTasks.length === 0) return;

    try {
      // Create project
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          name: editableProjectName,
          user_id: userId,
          color: '#3b82f6',
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Create tasks
      const tasksToInsert = editableTasks.map(task => ({
        title: task.title,
        description: task.description || null,
        priority: task.priority,
        status: 'todo' as const,
        user_id: userId,
        project_id: project.id,
        timer_total_seconds: 0,
        timer_is_running: false,
      }));

      const { error: tasksError } = await supabase
        .from('tasks')
        .insert(tasksToInsert);

      if (tasksError) throw tasksError;

      toast({
        title: 'Success',
        description: `Created project "${editableProjectName}" with ${editableTasks.length} tasks`,
      });

      handleClose();
      onTasksCreated();
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: 'Error',
        description: 'Failed to save project and tasks. Please try again.',
        variant: 'destructive',
      });
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Brain Dump - Voice Recording</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Recording Section */}
          {!extractedData && (
            <div className="flex flex-col items-center space-y-4">
              <div className="flex gap-4">
                {!isRecording && !audioBlob && (
                  <Button onClick={handleStartRecording} size="lg">
                    <Mic className="mr-2 h-5 w-5" />
                    Start Recording
                  </Button>
                )}
                
                {isRecording && (
                  <Button onClick={handleStopRecording} variant="destructive" size="lg">
                    <MicOff className="mr-2 h-5 w-5" />
                    Stop Recording
                  </Button>
                )}

                {audioBlob && !isTranscribing && !isExtracting && (
                  <>
                    <Button onClick={handleTranscribe} size="lg">
                      Transcribe & Extract Tasks
                    </Button>
                    <Button onClick={reset} variant="outline" size="lg">
                      Record Again
                    </Button>
                  </>
                )}
              </div>

              {isRecording && (
                <div className="text-sm text-muted-foreground animate-pulse">
                  Recording...
                </div>
              )}

              {(isTranscribing || isExtracting) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isTranscribing ? 'Transcribing audio...' : 'Extracting tasks...'}
                </div>
              )}

              {transcription && !extractedData && (
                <div className="w-full space-y-2">
                  <Label>Transcription</Label>
                  <div className="p-4 bg-muted rounded-md text-sm">
                    {transcription}
                  </div>
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
                />
              </div>

              <div className="space-y-4">
                <Label>Tasks</Label>
                {editableTasks.map((task, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <Input
                        value={task.title}
                        onChange={(e) => updateTask(index, 'title', e.target.value)}
                        placeholder="Task title"
                      />
                      <Button
                        onClick={() => removeTask(index)}
                        variant="ghost"
                        size="sm"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={task.description || ''}
                      onChange={(e) => updateTask(index, 'description', e.target.value)}
                      placeholder="Task description (optional)"
                      rows={2}
                    />
                    <Select
                      value={task.priority}
                      onValueChange={(value) => updateTask(index, 'priority', value as TaskPriority)}
                    >
                      <SelectTrigger>
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
                ))}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleConfirm} className="flex-1">
                  <Check className="mr-2 h-4 w-4" />
                  Create Project & Tasks
                </Button>
                <Button onClick={handleClose} variant="outline" className="flex-1">
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
