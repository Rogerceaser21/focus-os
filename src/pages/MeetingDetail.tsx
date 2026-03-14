import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  ClipboardList,
  Mail,
  Play,
  Pause,
  Download,
  Trash2,
  List,
  AlignLeft,
  RefreshCw,
  Minus,
  Plus,
  Pencil,
  Check,
  X,
  Share2,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
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
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { ShareItemDialog } from '@/components/ShareItemDialog';
import { ShareStatusPopover, SharedRecipient } from '@/components/ShareStatusPopover';
import { SendMeetingSummaryDialog } from '@/components/SendMeetingSummaryDialog';
import { EditTaskDialog } from '@/components/EditTaskDialog';

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
  const { preferences } = useUserPreferences(user?.id);

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

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [taskToShare, setTaskToShare] = useState<Task | null>(null);
  const [shareMeetingDialogOpen, setShareMeetingDialogOpen] = useState(false);

  // Sharing badge state
  const [meetingSharedWith, setMeetingSharedWith] = useState<SharedRecipient[]>([]); // sender sees this
  const [meetingSharedBy, setMeetingSharedBy] = useState<string | null>(null); // receiver sees this
  const [taskSharedWithMap, setTaskSharedWithMap] = useState<Record<string, SharedRecipient[]>>({}); // taskId -> recipients

  // Edit task dialog state
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Re-summarize state
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>('concise');
  const [resummarizing, setResummarizing] = useState(false);

  // Inline title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showSendSummaryDialog, setShowSendSummaryDialog] = useState(false);

  // Summary/Outline editing
  const [editingSummary, setEditingSummary] = useState(false);
  const [editOverview, setEditOverview] = useState('');
  const [editOutline, setEditOutline] = useState<{ heading: string; points: string[] }[]>([]);
  const [savingSummary, setSavingSummary] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && id) {
      fetchMeeting();
      fetchProjects();
      fetchSharingInfo();
    }
  }, [user, id]);

  // Realtime subscription for task updates (e.g. external completion via email)
  useEffect(() => {
    if (!user || !id) return;
    const channel = supabase
      .channel(`meeting-tasks-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'focusos_tasks',
          filter: `meeting_id=eq.${id}`,
        },
        () => {
          fetchSavedTasks();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, id]);

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const fetchProjects = async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from('focusos_projects')
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
    const { data, error } = await (supabase as any)
      .from('focusos_meetings')
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
      const { data: proj } = await (supabase as any)
        .from('focusos_projects')
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
    const { data: tasks } = await (supabase as any)
      .from('focusos_tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('meeting_id', id);

    if (tasks) {
      setSavedTasks(tasks.map(mapDbTaskToTask));
    }
  };

  const resolveName = (profile: { first_name?: string | null; last_name?: string | null; user_email?: string | null } | null, fallbackEmail: string) => {
    if (!profile) return fallbackEmail;
    const parts = [profile.first_name, profile.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : fallbackEmail;
  };

  const fetchSharingInfo = async () => {
    if (!user || !id) return;
    try {
      // Fetch meeting sharing records
      const { data: meetingShares } = await (supabase as any)
        .from('focusos_shared_items')
        .select('*')
        .eq('item_type', 'meeting')
        .eq('item_id', id);

      if (meetingShares && meetingShares.length > 0) {
        // Separate sender shares from receiver shares
        const senderShares = meetingShares.filter((s: any) => s.sender_user_id === user.id);
        const receiverShare = meetingShares.find((s: any) => s.recipient_user_id === user.id);

        if (senderShares.length > 0) {
          // Sender view - resolve all recipient names
          const recipientIds = [...new Set(senderShares.filter((s: any) => s.recipient_user_id).map((s: any) => s.recipient_user_id))] as string[];
          const profileMap: Record<string, any> = {};
          if (recipientIds.length > 0) {
            const { data: profiles } = await (supabase as any)
              .from('focusos_profiles')
              .select('user_id, first_name, last_name, user_email')
              .in('user_id', recipientIds);
            if (profiles) {
              profiles.forEach((p: any) => { profileMap[p.user_id] = p; });
            }
          }
          const recipients: SharedRecipient[] = senderShares.map((s: any) => ({
            email: s.recipient_email,
            name: s.recipient_user_id && profileMap[s.recipient_user_id]
              ? resolveName(profileMap[s.recipient_user_id], s.recipient_email)
              : s.recipient_email,
            status: s.status,
          }));
          setMeetingSharedWith(recipients);
        }

        if (receiverShare) {
          const { data: profile } = await (supabase as any)
            .from('focusos_profiles')
            .select('first_name, last_name, user_email')
            .eq('user_id', receiverShare.sender_user_id)
            .single();
          setMeetingSharedBy(resolveName(profile, receiverShare.sender_email));
        }
      }

      // Fetch task sharing records for tasks in this meeting
      const { data: taskShares } = await (supabase as any)
        .from('focusos_shared_items')
        .select('*')
        .eq('item_type', 'task')
        .eq('sender_user_id', user.id);

      if (taskShares && taskShares.length > 0) {
        // Collect unique recipient user IDs
        const recipientIds = [...new Set(taskShares.filter((s: any) => s.recipient_user_id).map((s: any) => s.recipient_user_id))] as string[];
        const profileMap: Record<string, any> = {};
        if (recipientIds.length > 0) {
          const { data: profiles } = await (supabase as any)
            .from('focusos_profiles')
            .select('user_id, first_name, last_name, user_email')
            .in('user_id', recipientIds);
          if (profiles) {
            profiles.forEach((p: any) => { profileMap[p.user_id] = p; });
          }
        }
        const map: Record<string, SharedRecipient[]> = {};
        taskShares.forEach((s: any) => {
          const name = s.recipient_user_id && profileMap[s.recipient_user_id]
            ? resolveName(profileMap[s.recipient_user_id], s.recipient_email)
            : s.recipient_email;
          if (!map[s.item_id]) map[s.item_id] = [];
          map[s.item_id].push({ email: s.recipient_email, name, status: s.status });
        });
        setTaskSharedWithMap(map);
      }
    } catch (err) {
      console.error('Failed to fetch sharing info:', err);
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
    completedByEmail: t.completed_by_email || undefined,
  });

  const stripMarkdown = (text: string): string => {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/`([^`]+)`/g, '$1');
  };

  const parseSummary = (raw: string | null): StructuredSummary => {
    if (!raw) return { overview: '', outline: [] };
    try {
      const parsed = JSON.parse(raw);
      if (parsed.overview) {
        return {
          overview: stripMarkdown(parsed.overview),
          outline: (parsed.outline || []).map((s: any) => ({
            heading: stripMarkdown(s.heading || ''),
            points: (s.points || []).map((p: string) => stripMarkdown(p)),
          })),
        };
      }
    } catch {}
    return { overview: stripMarkdown(raw), outline: [] };
  };

  const handleResummarize = async (level?: 'concise' | 'standard' | 'detailed') => {
    const targetLevel = level || detailLevel;
    setResummarizing(true);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-process-meeting', {
        body: {
          resummarize: true,
          meetingId: id,
          detailLevel: targetLevel,
          transcript: transcript || undefined,
          durationSeconds: meeting?.duration_seconds || 0,
        },
      });
      if (error) throw error;

      // Update local meeting state with new summary
      if (data?.summary && meeting) {
        setMeeting({ ...meeting, summary: data.summary });
      }
      if (level) setDetailLevel(level);
      toast.success(`Summary regenerated (${targetLevel})`);
    } catch (err) {
      console.error('Re-summarize error:', err);
      toast.error('Failed to re-summarize meeting');
    } finally {
      setResummarizing(false);
    }
  };

  const handleDetailChange = (direction: 'less' | 'more') => {
    const levels: ('concise' | 'standard' | 'detailed')[] = ['concise', 'standard', 'detailed'];
    const currentIdx = levels.indexOf(detailLevel);
    const newIdx = direction === 'less' ? Math.max(0, currentIdx - 1) : Math.min(2, currentIdx + 1);
    if (newIdx !== currentIdx) {
      const newLevel = levels[newIdx];
      setDetailLevel(newLevel);
      handleResummarize(newLevel);
    }
  };

  const fetchTranscript = async () => {
    if (transcript) return;
    setTranscriptLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-get-meeting-transcript', {
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
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/focusos-get-meeting-audio`,
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
        const { data, error } = await supabase.functions.invoke('focusos-get-meeting-transcript', {
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

      const { data, error } = await supabase.functions.invoke('focusos-extract-tasks', {
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
    const { error } = await (supabase as any)
      .from('focusos_tasks')
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
    setTaskToShare(task);
    setShareDialogOpen(true);
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

  const startEditingTitle = () => {
    if (!meeting) return;
    setEditTitle(meeting.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  };

  const saveTitle = async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || !meeting) {
      setEditingTitle(false);
      return;
    }
    if (trimmed === meeting.title) {
      setEditingTitle(false);
      return;
    }
    const { error } = await (supabase as any)
      .from('focusos_meetings')
      .update({ title: trimmed })
      .eq('id', meeting.id);
    if (error) {
      toast.error('Failed to rename meeting');
    } else {
      setMeeting({ ...meeting, title: trimmed });
    }
    setEditingTitle(false);
  };

  const startEditingSummary = () => {
    const s = parseSummary(meeting?.summary || null);
    setEditOverview(s.overview);
    setEditOutline(s.outline.map(sec => ({ heading: sec.heading, points: [...sec.points] })));
    setEditingSummary(true);
  };

  const cancelEditingSummary = () => {
    setEditingSummary(false);
  };

  const saveSummaryEdits = async () => {
    if (!meeting) return;
    setSavingSummary(true);
    try {
      const newSummary = JSON.stringify({ overview: editOverview.trim(), outline: editOutline });
      const { error } = await (supabase as any)
        .from('focusos_meetings')
        .update({ summary: newSummary })
        .eq('id', meeting.id);
      if (error) throw error;
      setMeeting({ ...meeting, summary: newSummary });
      setEditingSummary(false);
      toast.success('Summary updated');
    } catch (err) {
      toast.error('Failed to save summary');
    } finally {
      setSavingSummary(false);
    }
  };

  const updateOutlineHeading = (idx: number, value: string) => {
    setEditOutline(prev => prev.map((s, i) => i === idx ? { ...s, heading: value } : s));
  };

  const updateOutlinePoint = (sectionIdx: number, pointIdx: number, value: string) => {
    setEditOutline(prev => prev.map((s, i) =>
      i === sectionIdx ? { ...s, points: s.points.map((p, j) => j === pointIdx ? value : p) } : s
    ));
  };

  const removeOutlinePoint = (sectionIdx: number, pointIdx: number) => {
    setEditOutline(prev => prev.map((s, i) =>
      i === sectionIdx ? { ...s, points: s.points.filter((_, j) => j !== pointIdx) } : s
    ));
  };

  const addOutlinePoint = (sectionIdx: number) => {
    setEditOutline(prev => prev.map((s, i) =>
      i === sectionIdx ? { ...s, points: [...s.points, ''] } : s
    ));
  };

  const removeOutlineSection = (idx: number) => {
    setEditOutline(prev => prev.filter((_, i) => i !== idx));
  };

  const addOutlineSection = () => {
    setEditOutline(prev => [...prev, { heading: '', points: [''] }]);
  };

  const handleDeleteMeeting = async (deleteTasks: boolean) => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('focusos-delete-meeting', {
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
            {editingTitle ? (
              <Input
                ref={titleInputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                className="text-xl font-bold h-auto py-0.5 px-1 -ml-1"
              />
            ) : (
              <h1
                className="text-xl font-bold truncate cursor-pointer hover:text-primary/80 transition-colors"
                onClick={startEditingTitle}
                title="Click to rename"
              >
                {meeting.title}
              </h1>
            )}
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
            {meetingSharedBy && (
              <Badge variant="outline" className="bg-purple-600/15 text-purple-400 border-purple-600/30 text-xs inline-flex items-center gap-1 w-fit mt-1">
                <Share2 className="h-3 w-3 shrink-0" />
                <span className="break-words">Meeting shared by {meetingSharedBy}</span>
              </Badge>
            )}
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
            {/* Save / Cancel controls (only shown when editing) */}
            {editingSummary && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={cancelEditingSummary} disabled={savingSummary}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={saveSummaryEdits} disabled={savingSummary}>
                  {savingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                  Save
                </Button>
              </div>
            )}

            {/* Overview */}
            {(summary.overview || editingSummary) && (
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <AlignLeft className="h-4 w-4" />
                      Overview
                    </h2>
                    {!editingSummary && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={startEditingSummary}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={() => handleResummarize()}
                          disabled={resummarizing}
                        >
                          {resummarizing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Re-summarize
                        </Button>
                      </div>
                    )}
                  </div>
                  {editingSummary ? (
                    <Textarea
                      value={editOverview}
                      onChange={(e) => setEditOverview(e.target.value)}
                      className="min-h-[100px] text-sm"
                    />
                  ) : (
                    <p className="text-sm leading-relaxed">{summary.overview}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Outline */}
            {(summary.outline.length > 0 || editingSummary) && (
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <List className="h-4 w-4" />
                      Outline
                    </h2>
                    {!editingSummary && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleDetailChange('less')}
                          disabled={resummarizing || detailLevel === 'concise'}
                        >
                          <Minus className="h-3 w-3 mr-1" />
                          Detail
                        </Button>
                        <span className="text-xs text-muted-foreground min-w-[60px] text-center capitalize">
                          {resummarizing ? <Loader2 className="h-3 w-3 animate-spin inline" /> : detailLevel}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleDetailChange('more')}
                          disabled={resummarizing || detailLevel === 'detailed'}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Detail
                        </Button>
                      </div>
                    )}
                  </div>

                  {editingSummary ? (
                    <div className="space-y-4">
                      {editOutline.map((section, i) => (
                        <div key={i} className="space-y-2 border border-border rounded-lg p-3">
                          <div className="flex items-center gap-2">
                            <Input
                              value={section.heading}
                              onChange={(e) => updateOutlineHeading(i, e.target.value)}
                              placeholder="Section heading"
                              className="text-sm font-semibold"
                            />
                            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-destructive" onClick={() => removeOutlineSection(i)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {section.points.map((point, j) => (
                            <div key={j} className="flex items-start gap-2 ml-2">
                              <span className="mt-3 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                              <Textarea
                                value={point}
                                onChange={(e) => updateOutlinePoint(i, j, e.target.value)}
                                placeholder="Bullet point"
                                className="text-sm min-h-0 resize-none overflow-hidden"
                                rows={1}
                                onInput={(e) => {
                                  const target = e.target as HTMLTextAreaElement;
                                  target.style.height = 'auto';
                                  target.style.height = target.scrollHeight + 'px';
                                }}
                                ref={(el) => {
                                  if (el) {
                                    el.style.height = 'auto';
                                    el.style.height = el.scrollHeight + 'px';
                                  }
                                }}
                              />
                              <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground" onClick={() => removeOutlinePoint(i, j)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" className="text-xs ml-2" onClick={() => addOutlinePoint(i)}>
                            <Plus className="h-3 w-3 mr-1" /> Add point
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" className="text-xs" onClick={addOutlineSection}>
                        <Plus className="h-3 w-3 mr-1" /> Add section
                      </Button>
                    </div>
                  ) : (
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
                  )}
                </CardContent>
              </Card>
            )}

            {/* Share Summary via Email */}
            {(summary.overview || summary.outline.length > 0) && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setShowSendSummaryDialog(true)}
                  >
                    <Mail className="h-4 w-4" />
                    Share Summary via Email
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setShareMeetingDialogOpen(true)}
                  >
                    <Share2 className="h-4 w-4" />
                    Share Meeting
                  </Button>
                </div>
                {meetingSharedWith.length > 0 && (
                  <ShareStatusPopover recipients={meetingSharedWith} itemType="Meeting" />
                )}
              </div>
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
                          <ClipboardList className="h-3.5 w-3.5" />
                        )}
                        Re-extract
                      </Button>
                    )}
                  </div>

                  <Tabs defaultValue="all" className="mb-3">
                    <TabsList className="w-full">
                      <TabsTrigger value="all" className="flex-1">All({savedTasks.length})</TabsTrigger>
                      <TabsTrigger value="todo" className="flex-1">To Do({savedTasks.filter(t => t.status === 'todo').length})</TabsTrigger>
                      <TabsTrigger value="in-progress" className="flex-1">Progress({savedTasks.filter(t => t.status === 'in-progress').length})</TabsTrigger>
                      <TabsTrigger value="completed" className="flex-1">Done({savedTasks.filter(t => t.status === 'completed').length})</TabsTrigger>
                    </TabsList>
                    {['all', 'todo', 'in-progress', 'completed'].map((filterValue) => (
                      <TabsContent key={filterValue} value={filterValue}>
                        <div className="space-y-2">
                          {savedTasks
                            .filter(t => filterValue === 'all' || t.status === filterValue)
                            .map((task) => (
                              <div key={task.id} className="relative group/task">
                                <TaskListItem
                                  task={task}
                                  onUpdate={handleSavedTaskUpdate}
                                  onEditTask={setEditingTask}
                                  onAssignTask={(t) => handleAssignTask(t)}
                                  globalViewMode={preferences?.default_task_card_view ?? 'full'}
                                  isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                                  onTaskClick={() => toggleExpand(task.id)}
                                  projects={allProjects}
                                />
                                {taskSharedWithMap[task.id] && taskSharedWithMap[task.id].length > 0 && (
                                  <div className="mt-1 ml-8">
                                    <ShareStatusPopover recipients={taskSharedWithMap[task.id]} itemType="Task" />
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            )}

            {/* Extract Action Items Button */}
            {savedTasks.length === 0 && meeting.transcript_gcs_path && (
              <Card>
                <CardContent className="p-5 text-center">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 text-primary/60" />
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
                      <ClipboardList className="h-4 w-4" />
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

        {/* Edit Task Dialog */}
        {editingTask && (
          <EditTaskDialog
            task={editingTask}
            open={!!editingTask}
            onOpenChange={(open) => { if (!open) setEditingTask(null); }}
            onUpdateTask={(updated) => {
              handleSavedTaskUpdate(updated);
              setEditingTask(null);
            }}
            projects={allProjects}
            onAssigned={(taskId, email) => handleTaskAssigned(taskId, email)}
          />
        )}

        {/* Share Task Dialog */}
        <ShareItemDialog
          itemType="task"
          itemId={taskToShare?.id || null}
          itemTitle={taskToShare?.title}
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          onShared={() => { fetchSavedTasks(); fetchSharingInfo(); }}
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
      {meeting && (
        <SendMeetingSummaryDialog
          meetingId={meeting.id}
          meetingTitle={meeting.title}
          hasRecording={!!meeting.recording_gcs_path}
          open={showSendSummaryDialog}
          onOpenChange={setShowSendSummaryDialog}
        />
      )}
      {meeting && (
        <ShareItemDialog
          itemType="meeting"
          itemId={meeting.id}
          itemTitle={meeting.title}
          open={shareMeetingDialogOpen}
          onOpenChange={(open) => {
            setShareMeetingDialogOpen(open);
            if (!open) fetchSharingInfo();
          }}
        />
      )}
    </div>
  );
};

export default MeetingDetail;
