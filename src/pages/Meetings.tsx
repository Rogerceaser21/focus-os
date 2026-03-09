import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Mic, MicOff, Clock, FileText, ChevronRight, Plus, Folder, Square, Loader2, X, UserPlus, Trash2, Pause, Play, RefreshCw } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';

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
  updated_at?: string;
  processing_status?: string;
  processing_error?: string | null;
}

interface Project {
  id: string;
  name: string;
  color: string;
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'done';

const PROCESSING_LABELS: Record<string, { label: string; progress: number }> = {
  uploading: { label: 'Uploading audio to AI...', progress: 20 },
  transcribing: { label: 'Transcribing your meeting...', progress: 50 },
  summarizing: { label: 'Generating summary...', progress: 80 },
  done: { label: 'Complete!', progress: 100 },
  error: { label: 'Processing failed', progress: 0 },
};

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

  // Async processing polling state
  const [processingMeetingId, setProcessingMeetingId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('uploading');

  // Orphaned session recovery
  const [orphanedSession, setOrphanedSession] = useState<{ id: string; chunkCount: number; createdAt: string; gcsFolder: string; mimeType: string } | null>(null);
  const [recoveringSession, setRecoveringSession] = useState(false);
  const failedSessionRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      checkOrphanedSessions();
    }
  }, [user, projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (chunkUploadIntervalRef.current) clearInterval(chunkUploadIntervalRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Polling for async processing
  useEffect(() => {
    if (!processingMeetingId) return;

    const poll = async () => {
      const { data, error } = await (supabase as any)
        .from('focusos_meetings')
        .select('processing_status, processing_error')
        .eq('id', processingMeetingId)
        .single();

      if (error || !data) return;

      const status = (data as any).processing_status as string;
      const procError = (data as any).processing_error as string | null;

      setProcessingStatus(status);

      if (status === 'done') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        toast.success('Meeting processed successfully!');
        navigate(`/meetings/${processingMeetingId}`);
        setProcessingMeetingId(null);
        setRecordingState('idle');
      } else if (status === 'error') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        toast.error(`Processing failed: ${procError || 'Unknown error'}`);
        setProcessingMeetingId(null);
        setRecordingState('idle');
        fetchMeetings();
      }
    };

    pollingRef.current = setInterval(poll, 5000);
    // Initial poll
    poll();

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [processingMeetingId, navigate]);

  const fetchProjects = async () => {
    const { data } = await (supabase as any).from('focusos_projects').select('id, name, color');
    if (data) setProjects(data);
  };

  const checkOrphanedSessions = async () => {
    try {
      const { data: sessions } = await (supabase as any)
        .from('focusos_recording_sessions')
        .select('id, chunk_count, created_at, gcs_folder_path, mime_type, status')
        .in('status', ['processing', 'recording'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (sessions && sessions.length > 0) {
        const session = sessions[0];
        // Only show recovery if session has chunks and is older than 2 minutes
        const ageMs = Date.now() - new Date(session.created_at).getTime();
        if (session.chunk_count > 0 && ageMs > 120000) {
          setOrphanedSession({
            id: session.id,
            chunkCount: session.chunk_count,
            createdAt: session.created_at,
            gcsFolder: session.gcs_folder_path,
            mimeType: session.mime_type,
          });
        }
      }
    } catch (err) {
      console.error('Error checking orphaned sessions:', err);
    }
  };

  const recoverOrphanedSession = async () => {
    if (!orphanedSession) return;
    setRecoveringSession(true);
    toast.info('Recovering your recording...');

    try {
      const validParticipants = participantsRef.current.filter(p => p.name.trim());

      const { data, error } = await supabase.functions.invoke('focusos-process-meeting', {
        body: {
          sessionId: orphanedSession.id,
          mimeType: orphanedSession.mimeType.split(';')[0],
          projectId: projectId || null,
          title: meetingNameRef.current.trim() || `Recovered Meeting ${new Date(orphanedSession.createdAt).toLocaleDateString()} ${new Date(orphanedSession.createdAt).toLocaleTimeString()}`,
          durationSeconds: orphanedSession.chunkCount * 30, // approximate
          participants: validParticipants,
        },
      });

      if (error) throw error;

      setOrphanedSession(null);

      if (data.processing_status && data.processing_status !== 'done') {
        setProcessingMeetingId(data.id);
        setProcessingStatus(data.processing_status);
        setRecordingState('processing');
        triggerTranscription(data);
      } else {
        toast.success('Meeting recovered successfully!');
        navigate(`/meetings/${data.id}`);
      }
    } catch (err) {
      console.error('Recovery error:', err);
      toast.error('Failed to recover recording. Please try again.');
    } finally {
      setRecoveringSession(false);
    }
  };

  const dismissOrphanedSession = async () => {
    if (!orphanedSession) return;
    // Mark the session as failed so it won't show again
      await (supabase as any)
        .from('focusos_recording_sessions')
        .update({ status: 'failed' })
        .eq('id', orphanedSession.id);
    setOrphanedSession(null);
  };

  const fetchMeetings = async () => {
    setLoading(true);
    let query = (supabase as any)
      .from('focusos_meetings')
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
          processing_status: (m as any).processing_status || 'done',
          processing_error: (m as any).processing_error || null,
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
      chunksRef.current = [];

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

      const { error } = await supabase.functions.invoke('focusos-upload-audio-chunk', {
        body: { sessionId: sessionIdRef.current, chunkIndex: currentIndex, audioBase64 },
      });

      if (error) {
        console.error(`Chunk ${currentIndex} upload failed:`, error);
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

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

      const { data: sessionData, error: sessionError } = await supabase.functions.invoke('focusos-start-recording-session', {
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
        if (chunkUploadIntervalRef.current) {
          clearInterval(chunkUploadIntervalRef.current);
          chunkUploadIntervalRef.current = null;
        }

        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;

        await flushChunksToGcs();

        await processSessionMeeting(mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);

      setRecordingState('recording');
      setRecordingSeconds(0);
      setIsPaused(false);

      chunkUploadIntervalRef.current = setInterval(() => {
        flushChunksToGcs();
      }, 30000);

      timerRef.current = setInterval(() => {
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
    setProcessingStatus('uploading');
    toast.info('Uploading and processing your meeting...');

    try {
      const validParticipants = participantsRef.current.filter(p => p.name.trim());

      const { data, error } = await supabase.functions.invoke('focusos-process-meeting', {
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

      // Check if this is the new async flow
      if (data.processing_status && data.processing_status !== 'done') {
        // Start polling
        setProcessingMeetingId(data.id);
        setProcessingStatus(data.processing_status);

        // Frontend triggers transcribe-meeting directly (no more fire-and-forget)
        triggerTranscription(data);
      } else {
        // Legacy sync flow - navigate directly
        toast.success('Meeting processed successfully!');
        navigate(`/meetings/${data.id}`);
        setRecordingState('idle');
      }
    } catch (error) {
      console.error('Process meeting error:', error);
      // Save sessionId so we can offer recovery
      if (sessionIdRef.current) {
        failedSessionRef.current = sessionIdRef.current;
        // Re-check for orphaned sessions to show the recovery banner
        checkOrphanedSessions();
      }
      toast.error('Failed to process meeting. Your recording is saved — use the recovery banner to retry.');
      setRecordingState('idle');
    }
  };

  const triggerTranscription = async (meetingData: any) => {
    try {
      console.log('Frontend triggering transcribe-meeting for:', meetingData.id);
      // Don't await - let it run in background while we poll
      supabase.functions.invoke('focusos-transcribe-meeting', {
        body: {
          meetingId: meetingData.id,
          geminiFileUri: meetingData.geminiFileUri,
          mimeType: meetingData.mimeType,
          participantNames: meetingData.participantNames || [],
          durationSeconds: meetingData.durationSeconds || 0,
          gcsBucket: meetingData.gcsBucket,
          gcsFolder: meetingData.gcsFolder,
        },
      }).catch(err => {
        // This may "fail" due to timeout but the function keeps running server-side
        console.log('transcribe-meeting invoke completed or timed out (expected):', err?.message);
      });
    } catch (err) {
      console.error('Failed to trigger transcription:', err);
    }
  };

  const handleRetryMeeting = async (e: React.MouseEvent, meeting: Meeting) => {
    e.stopPropagation();
    toast.info('Retrying meeting processing...');

    try {
      // Fetch full meeting data for retry
      const { data: meetingData, error } = await (supabase as any)
        .from('focusos_meetings')
        .select('*')
        .eq('id', meeting.id)
        .single();

      if (error || !meetingData) throw new Error('Could not fetch meeting data');

      const geminiFileUri = (meetingData as any).gemini_file_uri;
      const recordingGcsPath = (meetingData as any).recording_gcs_path as string;

      if (!recordingGcsPath) {
        toast.error('No recording found for this meeting. Cannot retry.');
        return;
      }

      // If we still have a Gemini file URI, try transcribe-meeting directly
      if (geminiFileUri) {
        // Extract bucket and folder from recording_gcs_path (gs://bucket/folder/recording.webm)
        const gcsMatch = recordingGcsPath.match(/gs:\/\/([^/]+)\/(.+)\/recording\./);
        if (!gcsMatch) {
          toast.error('Could not parse recording path for retry.');
          return;
        }

        // Update status to transcribing
        await (supabase as any)
          .from('focusos_meetings')
          .update({ processing_status: 'transcribing', processing_error: null })
          .eq('id', meeting.id);

        setProcessingMeetingId(meeting.id);
        setProcessingStatus('transcribing');
        setRecordingState('processing');

        triggerTranscription({
          id: meeting.id,
          geminiFileUri,
          mimeType: 'audio/webm',
          participantNames: [],
          durationSeconds: meeting.duration_seconds || 0,
          gcsBucket: gcsMatch[1],
          gcsFolder: gcsMatch[2],
        });
      } else {
        toast.error('Gemini file expired. This meeting needs to be re-recorded.');
      }
    } catch (err) {
      console.error('Retry error:', err);
      toast.error('Failed to retry processing.');
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

  const processingInfo = PROCESSING_LABELS[processingStatus] || PROCESSING_LABELS.uploading;

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

      {/* Processing Banner with Progress */}
      {recordingState === 'processing' && (
        <div className="bg-primary/10 border-b border-primary/30">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">{processingInfo.label}</p>
                <p className="text-sm text-muted-foreground">
                  This may take a few minutes for long recordings
                </p>
              </div>
            </div>
            {processingStatus !== 'error' && (
              <Progress value={processingInfo.progress} className="h-2" />
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Orphaned session recovery banner */}
        {orphanedSession && recordingState === 'idle' && (
          <Card className="mb-4 border-amber-500/50 bg-amber-500/10">
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-amber-500" />
                  Unprocessed Recording Found
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  A {orphanedSession.chunkCount * 30}s recording from {new Date(orphanedSession.createdAt).toLocaleString()} wasn't fully processed. Your audio is safe.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={dismissOrphanedSession}
                  disabled={recoveringSession}
                >
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={recoverOrphanedSession}
                  disabled={recoveringSession}
                >
                  {recoveringSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Recover
                </Button>
              </div>
            </div>
          </Card>
        )}
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
              const updatedAt = new Date(meeting.updated_at || meeting.created_at).getTime();
              const isStale = (Date.now() - updatedAt) > 5 * 60 * 1000; // 5 minutes
              const isProcessing = meeting.processing_status && meeting.processing_status !== 'done' && meeting.processing_status !== 'error' && !isStale;
              const hasError = meeting.processing_status === 'error' || (isStale && meeting.processing_status !== 'done');
              return (
                <Card
                  key={meeting.id}
                  className={`cursor-pointer hover:border-primary/30 transition-colors ${isProcessing ? 'opacity-70' : ''} ${hasError ? 'border-destructive/30' : ''}`}
                  onClick={() => {
                    if (isProcessing) {
                      toast.info('This meeting is still being processed...');
                      return;
                    }
                    navigate(`/meetings/${meeting.id}`);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{meeting.title}</h3>
                          {isProcessing && (
                            <Badge variant="secondary" className="text-xs shrink-0 gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Processing
                            </Badge>
                          )}
                          {hasError && (
                            <Badge variant="destructive" className="text-xs shrink-0">
                              Failed
                            </Badge>
                          )}
                          {project && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              <Folder className="h-3 w-3 mr-1" style={{ color: project.color }} />
                              {project.name}
                            </Badge>
                          )}
                        </div>
                        {hasError && meeting.processing_error && (
                          <p className="text-sm text-destructive mb-2">{meeting.processing_error}</p>
                        )}
                        {meeting.summary && !isProcessing && (() => {
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
                        {(hasError || isProcessing) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={(e) => handleRetryMeeting(e, meeting)}
                            title="Retry processing"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
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
