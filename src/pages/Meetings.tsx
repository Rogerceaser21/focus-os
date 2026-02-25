import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Mic, MicOff, Clock, FileText, ChevronRight, Plus, Folder, Square, Loader2, X, UserPlus, Trash2, Pause, Play } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

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
  const [isPaused, setIsPaused] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Chunked upload state
  const sessionIdRef = useRef<string | null>(null);
  const chunkIndexRef = useRef(0);
  const chunkUploadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUploadingChunkRef = useRef(false);

  // Refs for values needed inside recorder.onstop closure
  const meetingNameRef = useRef('');
  const participantsRef = useRef<Participant[]>([{ name: '', email: '' }, { name: '', email: '' }]);
  const recordingSecondsRef = useRef(0);

  // Participants
  const [participants, setParticipants] = useState<Participant[]>([
    { name: '', email: '' },
    { name: '', email: '' },
  ]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [meetingName, setMeetingName] = useState('');

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Keep refs in sync with state
  useEffect(() => { meetingNameRef.current = meetingName; }, [meetingName]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { recordingSecondsRef.current = recordingSeconds; }, [recordingSeconds]);

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
      if (chunkUploadIntervalRef.current) clearInterval(chunkUploadIntervalRef.current);
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

  /* ─── Chunk upload helper ──────────────────────────────── */

  const flushChunksToGcs = useCallback(async () => {
    if (isUploadingChunkRef.current || chunksRef.current.length === 0 || !sessionIdRef.current) return;
    isUploadingChunkRef.current = true;

    try {
      const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
      chunksRef.current = []; // Clear buffer immediately

      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      const batchSize = 8192;
      for (let i = 0; i < uint8Array.length; i += batchSize) {
        const slice = uint8Array.subarray(i, i + batchSize);
        binary += String.fromCharCode(...slice);
      }
      const audioBase64 = btoa(binary);

      const currentIndex = chunkIndexRef.current;
      chunkIndexRef.current += 1;

      const { error } = await supabase.functions.invoke('upload-audio-chunk', {
        body: { sessionId: sessionIdRef.current, chunkIndex: currentIndex, audioBase64 },
      });

      if (error) {
        console.error(`Chunk ${currentIndex} upload failed:`, error);
        // Don't crash the recording - next flush will try again
      } else {
        console.log(`Chunk ${currentIndex} uploaded (${uint8Array.length} bytes)`);
      }
    } catch (err) {
      console.error('Chunk flush error:', err);
    } finally {
      isUploadingChunkRef.current = false;
    }
  }, []);

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

      // Start a recording session on the backend
      const { data: sessionData, error: sessionError } = await supabase.functions.invoke('start-recording-session', {
        body: { mimeType: mimeType.split(';')[0] },
      });

      if (sessionError || !sessionData?.sessionId) {
        throw new Error('Failed to start recording session');
      }

      sessionIdRef.current = sessionData.sessionId;
      chunkIndexRef.current = 0;
      console.log('Recording session started:', sessionData.sessionId);

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop chunk upload interval
        if (chunkUploadIntervalRef.current) {
          clearInterval(chunkUploadIntervalRef.current);
          chunkUploadIntervalRef.current = null;
        }

        // Stop all tracks
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;

        // Final flush of remaining chunks
        await flushChunksToGcs();

        // Now process the meeting using sessionId (no huge payload!)
        await processSessionMeeting(mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // Collect data every 1 second

      setRecordingState('recording');
      setRecordingSeconds(0);
      setIsPaused(false);

      // Flush chunks to GCS every 30 seconds
      chunkUploadIntervalRef.current = setInterval(() => {
        flushChunksToGcs();
      }, 30000);

      timerRef.current = setInterval(() => {
        // Only increment when not paused
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          setRecordingSeconds(s => s + 1);
        }
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
  }, [flushChunksToGcs]);

  const handlePauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      // Flush current chunks before pausing
      flushChunksToGcs();
    }
  }, [flushChunksToGcs]);

  const handleResumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const handleStopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPaused(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const processSessionMeeting = async (mimeType: string) => {
    setRecordingState('processing');
    toast.info('Processing your meeting...');

    try {
      const validParticipants = participantsRef.current.filter(p => p.name.trim());

      const { data, error } = await supabase.functions.invoke('process-meeting', {
        body: {
          sessionId: sessionIdRef.current,
          mimeType: mimeType.split(';')[0],
          projectId: projectId || null,
          title: meetingNameRef.current.trim() || `Meeting ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          durationSeconds: recordingSecondsRef.current,
          participants: validParticipants,
        },
      });

      if (error) throw error;

      sessionIdRef.current = null;
      toast.success('Meeting processed successfully!');
      navigate(`/meetings/${data.id}`);
    } catch (error) {
      console.error('Process meeting error:', error);
      toast.error('Failed to process meeting. Please try again.');
      setRecordingState('idle');
    }
  };

  const currentProject = projects.find(p => p.id === projectId);

  const handleDeleteMeeting = async (deleteTasks: boolean) => {
    if (!meetingToDelete) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-meeting', {
        body: { meetingId: meetingToDelete, deleteTasks },
      });
      if (error) throw error;
      toast.success('Meeting deleted');
      fetchMeetings();
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete meeting');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setMeetingToDelete(null);
    }
  };

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
          {recordingState === 'idle' && !showParticipants && (
            <Button className="gap-2" onClick={() => setShowParticipants(true)}>
              <Plus className="h-4 w-4" />
              New Meeting
            </Button>
          )}
          {recordingState === 'idle' && showParticipants && (
            <Button variant="ghost" size="sm" onClick={() => setShowParticipants(false)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Participant Setup */}
      {showParticipants && recordingState === 'idle' && (
        <div className="border-b bg-card/50">
          <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Meeting Name
              </h3>
              <Input
                placeholder="Enter meeting name (required)"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
                className="max-w-md"
              />
            </div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Meeting Participants
            </h3>
            {participants.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder={`Name ${i + 1}`}
                  value={p.name}
                  onChange={(e) => {
                    const updated = [...participants];
                    updated[i] = { ...updated[i], name: e.target.value };
                    setParticipants(updated);
                  }}
                  className="flex-1"
                />
                <Input
                  placeholder="Email (optional)"
                  type="email"
                  value={p.email}
                  onChange={(e) => {
                    const updated = [...participants];
                    updated[i] = { ...updated[i], email: e.target.value };
                    setParticipants(updated);
                  }}
                  className="flex-1"
                />
                {participants.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setParticipants(participants.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setParticipants([...participants, { name: '', email: '' }])}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add Participant
              </Button>
              <div className="flex-1" />
              <Button
                className="gap-2"
                onClick={() => {
                  if (!meetingName.trim()) {
                    toast.error('Please enter a meeting name');
                    return;
                  }
                  setShowParticipants(false);
                  handleStartRecording();
                }}
              >
                <Mic className="h-4 w-4" />
                Start Recording
              </Button>
            </div>
          </div>
        </div>
      )}

      {recordingState === 'recording' && (
        <div className={`border-b ${isPaused ? 'bg-amber-500/10 border-amber-500/30' : 'bg-destructive/10 border-destructive/30'}`}>
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                {isPaused ? (
                  <Pause className="h-6 w-6 text-amber-500" />
                ) : (
                  <>
                    <Mic className="h-6 w-6 text-destructive" />
                    <span className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full animate-pulse" />
                  </>
                )}
              </div>
              <div>
                <p className={`font-semibold ${isPaused ? 'text-amber-500' : 'text-destructive'}`}>
                  {isPaused ? 'Paused' : 'Recording...'}
                </p>
                <p className="text-sm text-muted-foreground font-mono">
                  {formatDuration(recordingSeconds)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isPaused ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
                  onClick={handleResumeRecording}
                >
                  <Play className="h-4 w-4" />
                  Resume
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handlePauseRecording}
                >
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={handleStopRecording}
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </div>
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
              Transcribing and summarizing your meeting...
            </p>
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
                  onClick={() => navigate(`/meetings/${meeting.id}`)}
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
                        {meeting.summary && (() => {
                          let displaySummary = meeting.summary;
                          try {
                            const parsed = JSON.parse(meeting.summary);
                            if (parsed.overview) displaySummary = parsed.overview;
                          } catch {}
                          return (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                              {displaySummary}
                            </p>
                          );
                        })()}
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
                      <div className="flex items-center gap-1 shrink-0 mt-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMeetingToDelete(meeting.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

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
  );
};

export default Meetings;
