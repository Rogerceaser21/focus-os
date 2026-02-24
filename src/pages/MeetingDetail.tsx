import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Clock,
  FileText,
  Folder,
  Loader2,
  Calendar,
  Users,
  Sparkles,
  Mail,
  Play,
  Pause,
  Download,
  Trash2,
  List,
  AlignLeft,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { TaskListItem } from '@/components/TaskListItem';
import { Task, TaskPriority, Project as TaskProject } from '@/types/task';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import type { BrainDumpTask, ProjectInfo } from '@/hooks/useBrainDumpLive';
import { AssignTaskDialog } from '@/components/AssignTaskDialog';

interface Participant {
  name: string;
  email: string;
}

interface Meeting {
  id: string;
  title: string;
  duration_seconds: number;
  summary: string | null;
  action_items: any[];
  participants: Participant[];
  project_id: string | null;
  created_at: string;
  transcript_gcs_path: string | null;
  recording_gcs_path: string | null;
}

interface Project {
  id: string;
  name: string;
  color: string;
}

interface StructuredSummary {
  overview: string;
  outline: { heading: string; points: string[] }[];
}

const MeetingDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [allProjects, setAllProjects] = useState<TaskProject[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Audio playback
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Saved tasks from DB (linked by meeting_id)
  const [savedTasks, setSavedTasks] = useState<Task[]>([]);

  // Extraction state
  const [extracting, setExtracting] = useState(false);

  // Brain Dump dialog state for review
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [extractedBrainDumpTasks, setExtractedBrainDumpTasks] = useState<BrainDumpTask[]>([]);

  // Individual expand tracking for TaskListItem
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  // Assign task dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [taskToAssign, setTaskToAssign] = useState<Task | null>(null);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && id) {
      fetchMeeting();
      fetchProjects();
    }
  }, [user, id]);

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const fetchProjects = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('projects')
      .select('id, name, color')
      .eq('user_id', user.id);
    if (data) {
      setAllProjects(data.map(p => ({
        ...p,
        timer: { totalSeconds: 0, isRunning: false },
      })));
    }
  };

  const fetchMeeting = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      toast.error('Meeting not found');
      navigate('/meetings');
      return;
    }

    const meetingData: Meeting = {
      ...data,
      action_items: Array.isArray(data.action_items) ? data.action_items : [],
      participants: Array.isArray((data as any).participants) ? (data as any).participants : [],
    };
    setMeeting(meetingData);

    if (data.project_id) {
      const { data: proj } = await supabase
        .from('projects')
        .select('id, name, color')
        .eq('id', data.project_id)
        .single();
      if (proj) setProject(proj);
    }

    await fetchSavedTasks();
    setLoading(false);
  };

  const fetchSavedTasks = async () => {
    if (!user || !id) return;
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('meeting_id', id);

    if (tasks) {
      setSavedTasks(tasks.map(mapDbTaskToTask));
    }
  };

  const mapDbTaskToTask = (t: any): Task & { assignedToEmail?: string } => ({
    id: t.id,
    title: t.title,
    description: t.description || undefined,
    priority: (t.priority || 'medium') as TaskPriority,
    status: t.status as any,
    dueDate: t.due_date ? new Date(t.due_date) : undefined,
    startDate: t.start_date ? new Date(t.start_date) : undefined,
    endDate: t.end_date ? new Date(t.end_date) : undefined,
    images: Array.isArray(t.images) ? t.images as string[] : [],
    timer: {
      totalSeconds: t.timer_total_seconds || 0,
      isRunning: t.timer_is_running || false,
      startTime: t.timer_start_time || undefined,
    },
    projectId: t.project_id || undefined,
    sortOrder: t.sort_order || 0,
    assignedToEmail: t.assigned_to_email || undefined,
  });

  const parseSummary = (raw: string | null): StructuredSummary => {
    if (!raw) return { overview: '', outline: [] };
    try {
      const parsed = JSON.parse(raw);
      if (parsed.overview) return parsed;
    } catch {}
    // Legacy plain text summary
    return { overview: raw, outline: [] };
  };

  const fetchTranscript = async () => {
    if (transcript) return;
    setTranscriptLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-meeting-transcript', {
        body: { meetingId: id },
      });
      if (error) throw error;
      setTranscript(data.transcript || 'No transcript available.');
    } catch (err) {
      console.error('Transcript error:', err);
      toast.error('Failed to load transcript');
      setTranscript('Failed to load transcript.');
    } finally {
      setTranscriptLoading(false);
    }
  };

  const fetchAudio = async () => {
    if (audioUrl) return;
    setAudioLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-meeting-audio`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ meetingId: id }),
        }
      );
      if (!response.ok) throw new Error('Failed to fetch audio');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      console.error('Audio fetch error:', err);
      toast.error('Failed to load audio');
    } finally {
      setAudioLoading(false);
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${meeting?.title || 'meeting'}-recording.webm`;
    a.click();
  };

  /* ─── Extract Action Items ─── */

  const handleExtractActionItems = async () => {
    let transcriptText = transcript;
    if (!transcriptText) {
      setExtracting(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-meeting-transcript', {
          body: { meetingId: id },
        });
        if (error) throw error;
        transcriptText = data.transcript || '';
        setTranscript(transcriptText);
      } catch (err) {
        toast.error('Failed to load transcript for extraction');
        setExtracting(false);
        return;
      }
    }

    if (!transcriptText) {
      toast.error('No transcript available to extract from');
      return;
    }

    setExtracting(true);

    try {
      const fullText = meeting?.summary
        ? `Meeting Summary:\n${meeting.summary}\n\nFull Transcript:\n${transcriptText}`
        : transcriptText;

      const { data, error } = await supabase.functions.invoke('extract-tasks', {
        body: {
          transcription: fullText,
          mode: 'tasks-only',
        },
      });

      if (error) throw error;

      const tasks = data?.tasks || [];
      if (tasks.length === 0) {
        toast.info('No action items found in the transcript');
        return;
      }

      const brainDumpTasks: BrainDumpTask[] = tasks.map((t: any, i: number) => ({
        id: `meeting-extract-${Date.now()}-${i}`,
        title: t.title || '',
        description: t.description || undefined,
        priority: (t.priority || 'medium') as TaskPriority,
        destination: meeting?.project_id ? 'existing-project' as const : 'today' as const,
        projectId: meeting?.project_id || undefined,
        projectName: project?.name || undefined,
      }));

      setExtractedBrainDumpTasks(brainDumpTasks);
      setBrainDumpOpen(true);
    } catch (err) {
      console.error('Extract error:', err);
      toast.error('Failed to extract action items');
    } finally {
      setExtracting(false);
    }
  };

  const handleBrainDumpTasksCreated = () => {
    fetchSavedTasks();
  };

  const handleSavedTaskUpdate = async (updatedTask: Task) => {
    const { error } = await supabase
      .from('tasks')
      .update({
        title: updatedTask.title,
        description: updatedTask.description || null,
        priority: updatedTask.priority,
        status: updatedTask.status,
        due_date: updatedTask.dueDate ? updatedTask.dueDate.toISOString() : null,
        project_id: updatedTask.projectId || null,
        timer_total_seconds: updatedTask.timer.totalSeconds,
        timer_is_running: updatedTask.timer.isRunning,
        timer_start_time: updatedTask.timer.startTime || null,
      })
      .eq('id', updatedTask.id);

    if (error) {
      toast.error('Failed to update task');
      return;
    }

    setSavedTasks((prev) =>
      prev.map((t) => (t.id === updatedTask.id ? updatedTask : t))
    );
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const handleAssignTask = (task: Task) => {
    setTaskToAssign(task);
    setAssignDialogOpen(true);
  };

  const handleTaskAssigned = (taskId: string, email: string) => {
    fetchSavedTasks();
  };

  const toggleExpand = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleDeleteMeeting = async (deleteTasks: boolean) => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('delete-meeting', {
        body: { meetingId: id, deleteTasks },
      });
      if (error) throw error;
      toast.success('Meeting deleted');
      navigate('/meetings');
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete meeting');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded" />
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!meeting) return null;

  const summary = parseSummary(meeting.summary);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/meetings')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{meeting.title}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {format(new Date(meeting.created_at), 'MMM d, yyyy · h:mm a')}
              </span>
              {meeting.duration_seconds > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDuration(meeting.duration_seconds)}
                </span>
              )}
              {project && (
                <span className="flex items-center gap-1">
                  <Folder className="h-3.5 w-3.5" style={{ color: project.color }} />
                  {project.name}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Participants */}
        {meeting.participants.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                <Users className="h-4 w-4" />
                Participants ({meeting.participants.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {meeting.participants.map((p, i) => (
                  <Badge key={i} variant="secondary" className="text-sm py-1 px-3">
                    {p.name}
                    {p.email && (
                      <span className="text-muted-foreground ml-1.5 text-xs">({p.email})</span>
                    )}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabbed Content: Meeting Overview / Transcript & Recording */}
        <Tabs defaultValue="overview" onValueChange={(val) => {
          if (val === 'transcript') {
            fetchTranscript();
            if (meeting.recording_gcs_path) fetchAudio();
          }
        }}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview" className="gap-1.5">
              <AlignLeft className="h-3.5 w-3.5" />
              Meeting Overview
            </TabsTrigger>
            <TabsTrigger value="transcript" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Transcript & Recording
            </TabsTrigger>
          </TabsList>

          {/* Meeting Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Overview */}
            {summary.overview && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                    <AlignLeft className="h-4 w-4" />
                    Overview
                  </h2>
                  <p className="text-sm leading-relaxed">{summary.overview}</p>
                </CardContent>
              </Card>
            )}

            {/* Outline */}
            {summary.outline.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                    <List className="h-4 w-4" />
                    Outline
                  </h2>
                  <div className="space-y-4">
                    {summary.outline.map((section, i) => (
                      <div key={i}>
                        <h3 className="font-semibold text-sm mb-2">{section.heading}</h3>
                        <ul className="space-y-1.5 ml-1">
                          {section.points.map((point, j) => (
                            <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action Items */}
            {savedTasks.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Action Items ({savedTasks.length})
                    </h2>
                    {meeting.transcript_gcs_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleExtractActionItems}
                        disabled={extracting}
                      >
                        {extracting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Re-extract
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {savedTasks.map((task) => (
                      <div key={task.id} className="relative group/task">
                        <TaskListItem
                          task={task}
                          onUpdate={handleSavedTaskUpdate}
                          globalViewMode="compact"
                          isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                          onTaskClick={() => toggleExpand(task.id)}
                          projects={allProjects}
                        />
                        <div className="flex items-center gap-2 mt-1 ml-8">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-primary"
                            onClick={() => handleAssignTask(task)}
                          >
                            <Mail className="h-3 w-3" />
                            Assign
                          </Button>
                          {(task as any).assignedToEmail && (
                            <Badge variant="secondary" className="text-xs py-0">
                              <Mail className="h-2.5 w-2.5 mr-1" />
                              {(task as any).assignedToEmail}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Extract Action Items Button */}
            {savedTasks.length === 0 && meeting.transcript_gcs_path && (
              <Card>
                <CardContent className="p-5 text-center">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 text-primary/60" />
                  <p className="text-sm text-muted-foreground mb-3">
                    Extract action items from the transcript using AI
                  </p>
                  <Button
                    className="gap-2"
                    onClick={handleExtractActionItems}
                    disabled={extracting}
                  >
                    {extracting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {extracting ? 'Extracting...' : 'Extract Action Items'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Transcript & Recording Tab */}
          <TabsContent value="transcript" className="space-y-4 mt-4">
            {/* Audio Player */}
            {meeting.recording_gcs_path && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                    <Play className="h-4 w-4" />
                    Recording
                  </h2>
                  {audioLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading audio...
                    </div>
                  ) : audioUrl ? (
                    <div className="space-y-3">
                      <audio
                        ref={audioRef}
                        src={audioUrl}
                        onEnded={() => setIsPlaying(false)}
                        onPause={() => setIsPlaying(false)}
                        onPlay={() => setIsPlaying(true)}
                        className="w-full"
                        controls
                      />
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadAudio}>
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No audio available.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Transcript */}
            <Card>
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Transcript
                </h2>
                {transcriptLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : transcript ? (
                  <div className="bg-muted/30 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                      {transcript}
                    </pre>
                  </div>
                ) : !meeting.transcript_gcs_path ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No transcript available for this meeting.</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Brain Dump Dialog */}
        {user && (
          <BrainDumpLiveDialog
            open={brainDumpOpen}
            onOpenChange={setBrainDumpOpen}
            userId={user.id}
            projects={allProjects.map(p => ({ id: p.id, name: p.name }))}
            onTasksCreated={handleBrainDumpTasksCreated}
            initialTasks={extractedBrainDumpTasks}
            meetingId={meeting.id}
          />
        )}

        {/* Assign Task Dialog */}
        <AssignTaskDialog
          task={taskToAssign}
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          onAssigned={handleTaskAssigned}
        />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Meeting</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the meeting recording, transcript, and all metadata.
                What would you like to do with associated action items/tasks?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => handleDeleteMeeting(false)}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Keep Tasks & Delete Meeting
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={() => handleDeleteMeeting(true)}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Delete Everything
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default MeetingDetail;
