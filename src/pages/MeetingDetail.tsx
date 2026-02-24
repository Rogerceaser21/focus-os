import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
} from 'lucide-react';
import { format } from 'date-fns';
import { TaskListItem } from '@/components/TaskListItem';
import { Task, TaskPriority, Project as TaskProject } from '@/types/task';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import type { BrainDumpTask, ProjectInfo } from '@/hooks/useBrainDumpLive';

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
}

interface Project {
  id: string;
  name: string;
  color: string;
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
  const [showTranscript, setShowTranscript] = useState(false);

  // Saved tasks from DB (linked by meeting_id)
  const [savedTasks, setSavedTasks] = useState<Task[]>([]);

  // Extraction state
  const [extracting, setExtracting] = useState(false);

  // Brain Dump dialog state for review
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [extractedBrainDumpTasks, setExtractedBrainDumpTasks] = useState<BrainDumpTask[]>([]);

  // Individual expand tracking for TaskListItem
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && id) {
      fetchMeeting();
      fetchProjects();
    }
  }, [user, id]);

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

    // Fetch saved tasks linked to this meeting
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

  const mapDbTaskToTask = (t: any): Task => ({
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
  });

  const fetchTranscript = async () => {
    if (transcript) {
      setShowTranscript(!showTranscript);
      return;
    }

    setTranscriptLoading(true);
    setShowTranscript(true);

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
      // Also include summary for better context
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

      // Convert to BrainDumpTask format for the dialog
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
    // Refresh saved tasks from DB
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

  const toggleExpand = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
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

        {/* Summary */}
        {meeting.summary && (
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                Summary
              </h2>
              <p className="text-sm leading-relaxed">{meeting.summary}</p>
            </CardContent>
          </Card>
        )}

        {/* Saved Action Items - Real Tasks */}
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
                  <TaskListItem
                    key={task.id}
                    task={task}
                    onUpdate={handleSavedTaskUpdate}
                    globalViewMode="compact"
                    isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                    onTaskClick={() => toggleExpand(task.id)}
                    projects={allProjects}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Extract Action Items Button - show when no saved tasks exist */}
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

        {/* Brain Dump Dialog for reviewing extracted action items */}
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

        {/* Transcript */}
        {meeting.transcript_gcs_path && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Transcript
                </h2>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={fetchTranscript}>
                  <FileText className="h-3.5 w-3.5" />
                  {showTranscript ? 'Hide' : 'Show'} Transcript
                </Button>
              </div>
              {showTranscript && (
                <div className="mt-2">
                  {transcriptLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="bg-muted/30 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
                      <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                        {transcript}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* No transcript fallback */}
        {!meeting.transcript_gcs_path && (
          <Card>
            <CardContent className="p-5 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No transcript available for this meeting.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default MeetingDetail;
