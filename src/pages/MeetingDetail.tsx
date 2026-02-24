import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Clock,
  FileText,
  Folder,
  Plus,
  Loader2,
  Calendar,
  Users,
  Sparkles,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';

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

interface ActionItem {
  title: string;
  assignee?: string;
  priority: string;
}

const MeetingDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  // Action item extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ActionItem[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [savingItems, setSavingItems] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user && id) fetchMeeting();
  }, [user, id]);

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

    setMeeting({
      ...data,
      action_items: Array.isArray(data.action_items) ? data.action_items : [],
      participants: Array.isArray((data as any).participants) ? (data as any).participants : [],
    });

    if (data.project_id) {
      const { data: proj } = await supabase
        .from('projects')
        .select('id, name, color')
        .eq('id', data.project_id)
        .single();
      if (proj) setProject(proj);
    }

    setLoading(false);
  };

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
    // First make sure we have the transcript
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
      const { data, error } = await supabase.functions.invoke('extract-tasks', {
        body: {
          transcription: transcriptText,
          mode: 'tasks-only',
        },
      });

      if (error) throw error;

      const tasks = data?.tasks || [];
      setExtractedItems(
        tasks.map((t: any) => ({
          title: t.title || t.description || '',
          assignee: 'Unassigned',
          priority: t.priority || 'medium',
        }))
      );
      setShowReview(true);
    } catch (err) {
      console.error('Extract error:', err);
      toast.error('Failed to extract action items');
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveActionItems = async () => {
    if (!user || !meeting) return;
    setSavingItems(true);

    try {
      // Save each as a task
      const taskInserts = extractedItems.map((item) => ({
        user_id: user.id,
        project_id: meeting.project_id || null,
        title: item.title,
        priority: item.priority || 'medium',
        status: 'todo' as const,
        due_date: new Date().toISOString(),
      }));

      const { error: taskError } = await supabase.from('tasks').insert(taskInserts);
      if (taskError) throw taskError;

      // Update meeting record with action items
      const { error: meetingError } = await supabase
        .from('meetings')
        .update({ action_items: extractedItems as any })
        .eq('id', meeting.id);
      if (meetingError) throw meetingError;

      setMeeting({ ...meeting, action_items: extractedItems });
      setShowReview(false);
      setExtractedItems([]);
      toast.success(`${taskInserts.length} tasks created!`);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save action items');
    } finally {
      setSavingItems(false);
    }
  };

  const updateExtractedItem = (index: number, field: keyof ActionItem, value: string) => {
    setExtractedItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const removeExtractedItem = (index: number) => {
    setExtractedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addExtractedItem = () => {
    setExtractedItems((prev) => [...prev, { title: '', priority: 'medium' }]);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs}s`;
    return `${mins}m ${secs}s`;
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

        {/* Action Items - Saved */}
        {meeting.action_items.length > 0 && !showReview && (
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                Action Items ({meeting.action_items.length})
              </h2>
              <div className="space-y-2">
                {meeting.action_items.map((item: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2.5 border"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {item.priority}
                        </Badge>
                        {item.assignee && item.assignee !== 'Unassigned' && (
                          <Badge variant="secondary" className="text-xs">
                            {item.assignee}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Extract Action Items Button - show when no items exist yet */}
        {meeting.action_items.length === 0 && !showReview && meeting.transcript_gcs_path && (
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

        {/* Brain Dump Review UI */}
        {showReview && (
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Review Action Items ({extractedItems.length})
                </h2>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowReview(false);
                      setExtractedItems([]);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={handleSaveActionItems}
                    disabled={savingItems || extractedItems.length === 0}
                  >
                    {savingItems ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {savingItems ? 'Saving...' : "I'm Ready"}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {extractedItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 bg-muted/30 rounded-lg p-3 border">
                    <div className="flex-1 space-y-2">
                      <Input
                        value={item.title}
                        onChange={(e) => updateExtractedItem(i, 'title', e.target.value)}
                        placeholder="Task title"
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        {['low', 'medium', 'high'].map((p) => (
                          <Badge
                            key={p}
                            variant={item.priority === p ? 'default' : 'outline'}
                            className="cursor-pointer text-xs"
                            onClick={() => updateExtractedItem(i, 'priority', p)}
                          >
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeExtractedItem(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1 text-xs"
                onClick={addExtractedItem}
              >
                <Plus className="h-3 w-3" />
                Add Item
              </Button>
            </CardContent>
          </Card>
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
