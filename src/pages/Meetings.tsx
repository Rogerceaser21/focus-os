import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Mic, MicOff, Clock, FileText, ChevronRight, Plus, Folder, Square, Loader2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

interface Meeting {
  id: string;
  title: string;
  duration_seconds: number;
  summary: string | null;
  action_items: any[];
  project_id: string | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  color: string;
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'done';

const Meetings = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const { user, loading: authLoading } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Recording state
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Latest processed meeting
  const [processedMeeting, setProcessedMeeting] = useState<{
    summary: string;
    action_items: any[];
    transcript: string;
  } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchMeetings();
      fetchProjects();
    }
  }, [user, projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const fetchProjects = async () => {
    const { data } = await supabase.from('projects').select('id, name, color');
    if (data) setProjects(data);
  };

  const fetchMeetings = async () => {
    setLoading(true);
    let query = supabase
      .from('meetings')
      .select('*')
      .order('created_at', { ascending: false });

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;
    if (!error && data) {
      setMeetings(
        data.map(m => ({
          ...m,
          action_items: Array.isArray(m.action_items) ? m.action_items : [],
        }))
      );
    }
    setLoading(false);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  /* ─── Recording ────────────────────────────────────────── */

  const handleStartRecording = useCallback(async () => {
    try {
      // Release any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      // CRITICAL: getUserMedia directly in click handler
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        },
      });

      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (blob.size < 1000) {
          toast.error('Recording too short. Please try again.');
          setRecordingState('idle');
          return;
        }

        await processMeeting(blob, mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);

      setRecordingState('recording');
      setRecordingSeconds(0);
      setProcessedMeeting(null);

      timerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);

      toast.success('Recording started');
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') {
        toast.error('Microphone access denied. Check browser permissions.');
      } else {
        toast.error('Failed to start recording. Check your microphone.');
        console.error('Recording error:', error);
      }
    }
  }, []);

  const handleStopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const processMeeting = async (blob: Blob, mimeType: string) => {
    setRecordingState('processing');
    toast.info('Processing your meeting...');

    try {
      // Convert blob to base64
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      const audioBase64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke('process-meeting', {
        body: {
          audioBase64,
          mimeType: mimeType.split(';')[0],
          projectId: projectId || null,
          title: `Meeting ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          durationSeconds: recordingSeconds,
        },
      });

      if (error) throw error;

      setProcessedMeeting({
        summary: data.summary,
        action_items: data.action_items,
        transcript: data.transcript,
      });

      setRecordingState('done');
      toast.success('Meeting processed successfully!');
      fetchMeetings(); // Refresh list
    } catch (error) {
      console.error('Process meeting error:', error);
      toast.error('Failed to process meeting. Please try again.');
      setRecordingState('idle');
    }
  };

  /* ─── Add action item as task ──────────────────────────── */

  const handleAddAsTask = async (item: { title: string; priority?: string }) => {
    if (!user) return;

    const { error } = await supabase.from('tasks').insert({
      user_id: user.id,
      project_id: projectId || null,
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

  const currentProject = projects.find(p => p.id === projectId);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/app')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Meetings</h1>
            {currentProject && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Folder className="h-3.5 w-3.5" style={{ color: currentProject.color }} />
                <span>{currentProject.name}</span>
              </div>
            )}
          </div>
          {recordingState === 'idle' && (
            <Button className="gap-2" onClick={handleStartRecording}>
              <Plus className="h-4 w-4" />
              New Meeting
            </Button>
          )}
        </div>
      </div>

      {/* Recording Banner */}
      {recordingState === 'recording' && (
        <div className="bg-destructive/10 border-b border-destructive/30">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Mic className="h-6 w-6 text-destructive" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-pulse" />
              </div>
              <div>
                <p className="font-semibold text-destructive">Recording...</p>
                <p className="text-sm text-muted-foreground font-mono">
                  {formatDuration(recordingSeconds)}
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={handleStopRecording}
            >
              <Square className="h-4 w-4" />
              Stop Recording
            </Button>
          </div>
        </div>
      )}

      {/* Processing Banner */}
      {recordingState === 'processing' && (
        <div className="bg-primary/10 border-b border-primary/30">
          <div className="max-w-4xl mx-auto px-4 py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
            <p className="font-semibold">Processing your meeting...</p>
            <p className="text-sm text-muted-foreground">
              Transcribing, summarizing, and extracting action items
            </p>
          </div>
        </div>
      )}

      {/* Processed Meeting Result */}
      {recordingState === 'done' && processedMeeting && (
        <div className="bg-success/5 border-b border-success/20">
          <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">Meeting processed!</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setRecordingState('idle');
                  setProcessedMeeting(null);
                }}
              >
                Dismiss
              </Button>
            </div>

            {/* Summary */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-1">Summary</h3>
              <p className="text-sm">{processedMeeting.summary}</p>
            </div>

            {/* Action Items */}
            {processedMeeting.action_items.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                  Action Items ({processedMeeting.action_items.length})
                </h3>
                <div className="space-y-2">
                  {processedMeeting.action_items.map((item: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-card/50 rounded-lg px-3 py-2 border"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <div className="flex gap-2 mt-0.5">
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : meetings.length === 0 && recordingState === 'idle' ? (
          <div className="text-center py-20">
            <Mic className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-semibold mb-1">No meetings yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Record a meeting to get AI-powered transcription, summaries, and action items.
            </p>
            <Button className="gap-2" onClick={handleStartRecording}>
              <Mic className="h-4 w-4" />
              Record Your First Meeting
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {meetings.map(meeting => {
              const project = projects.find(p => p.id === meeting.project_id);
              return (
                <Card
                  key={meeting.id}
                  className="cursor-pointer hover:border-primary/30 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{meeting.title}</h3>
                          {project && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              <Folder className="h-3 w-3 mr-1" style={{ color: project.color }} />
                              {project.name}
                            </Badge>
                          )}
                        </div>
                        {meeting.summary && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {meeting.summary}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {meeting.duration_seconds > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(meeting.duration_seconds)}
                            </span>
                          )}
                          <span>
                            {format(new Date(meeting.created_at), 'MMM d, yyyy · h:mm a')}
                          </span>
                          {meeting.action_items.length > 0 && (
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {meeting.action_items.length} action items
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Meetings;
