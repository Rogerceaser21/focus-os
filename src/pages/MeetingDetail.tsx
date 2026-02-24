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
  Plus,
  Loader2,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import { format } from 'date-fns';

interface Meeting {
  id: string;
  title: string;
  duration_seconds: number;
  summary: string | null;
  action_items: any[];
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
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

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

  const handleAddAsTask = async (item: { title: string; priority?: string }) => {
    if (!user) return;

    const { error } = await supabase.from('tasks').insert({
      user_id: user.id,
      project_id: meeting?.project_id || null,
      title: item.title,
      priority: item.priority || 'medium',
      status: 'todo',
      due_date: new Date().toISOString(),
    });

    if (error) {
      toast.error('Failed to create task');
    } else {
      toast.success('Task created!');
    }
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

        {/* Action Items */}
        {meeting.action_items.length > 0 && (
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 shrink-0 gap-1 text-xs"
                      onClick={() => handleAddAsTask(item)}
                    >
                      <Plus className="h-3 w-3" />
                      Add as Task
                    </Button>
                  </div>
                ))}
              </div>
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
