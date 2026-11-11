import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchProjects as fetchProjectsShared, appDataKeys, APP_DATA_STALE_TIME, APP_DATA_GC_TIME } from '@/lib/appDataFetchers';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Mic, MicOff, Clock, FileText, ChevronRight, Plus, Folder, Square, Loader2, X, UserPlus, Trash2, Pause, Play, RefreshCw, Share2 } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { ProjectsDrawerHost } from '@/components/ProjectsDrawerHost';
import RecordFAB from '@/components/RecordFAB';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import { MeetingsTour } from '@/components/MeetingsTour';
import { DEMO_MEETING_ID } from '@/lib/demoMeeting';
import { useUserPreferences } from '@/hooks/useUserPreferences';
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
import {
  useMeetingRecorder,
  start as startMeetingRecording,
  pause as pauseMeetingRecording,
  resume as resumeMeetingRecording,
  stop as stopMeetingRecording,
  triggerTranscription as triggerMeetingTranscription,
  readPersistedRecording,
  clearPersistedRecording,
  persistedDurationSeconds,
  isSessionInFlight,
  hasUnsentChunks,
  isLiveInAnotherTab,
  discardSessionData,
  getSnapshot as getRecorderSnapshot,
} from '@/lib/meetingRecorder';

interface Participant {
  name: string;
  email: string;
}

/**
 * The segmented transcriber's progress ledger (focusos_meetings.transcript_segments).
 * Written segment by segment while the worker runs: `total` is the planned segment
 * count, `texts` holds one entry per finished segment keyed by its index. Either half
 * can be missing — the column is null until the worker has planned the run.
 */
interface TranscriptSegments {
  total?: number;
  texts?: Record<string, string>;
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
  transcript_segments?: TranscriptSegments | null;
}

/**
 * done/total for a transcript_segments blob, or null when the run has no plan yet
 * (column null/absent, no `total`, or a nonsense total: non-numeric, NaN, <= 0).
 * `done` counts the segments that already carry text, so it is 0 on a freshly
 * planned run rather than null, and it is CLAMPED to the plan: a ledger that
 * carries more texts than `total` (a re-planned run, a retry that re-segmented
 * the audio) renders "8/8", never "9/8".
 */
const segmentProgress = (segments: unknown): { done: number; total: number } | null => {
  if (!segments || typeof segments !== 'object') return null;
  const { total, texts } = segments as TranscriptSegments;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  const counted = texts && typeof texts === 'object' ? Object.keys(texts).length : 0;
  return { done: Math.min(counted, total), total };
};

interface Project {
  id: string;
  name: string;
  color: string;
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'done';

const PROCESSING_LABELS: Record<string, { label: string; progress: number }> = {
  uploading: { label: 'Uploading audio to AI...', progress: 20 },
  transcribing: { label: 'Transcribing...', progress: 50 },
  summarizing: { label: 'Generating summary...', progress: 80 },
  done: { label: 'Complete!', progress: 100 },
  error: { label: 'Processing failed', progress: 0 },
};

// The two processing_status values a meeting never leaves once reached.
const TERMINAL_PROCESSING_STATUSES = new Set(['done', 'error']);

const Meetings = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const shouldOpenNew = searchParams.get('new') === 'true';
  const tourParam = searchParams.get('tour');
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { preferences, markMeetingsTourComplete } = useUserPreferences(user?.id);

  // Projects drawer, opened OVER this page by the dock (never navigates on open).
  const [projectsDrawerOpen, setProjectsDrawerOpen] = useState(false);

  // Tour state — open if explicitly requested OR auto-launch for first-time users once preferences load
  const [tourOpen, setTourOpen] = useState(false);
  const hasAutoLaunchedMeetingsTourRef = useRef(false);
  useEffect(() => {
    if (tourParam === 'meetings') {
      setTourOpen(true);
      return;
    }
    if (hasAutoLaunchedMeetingsTourRef.current) return;
    if (preferences && !preferences.has_completed_meetings_tour) {
      hasAutoLaunchedMeetingsTourRef.current = true;
      // Auto-launch once for new users — small delay so the page paints first
      const t = setTimeout(() => setTourOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [tourParam, preferences]);
  // Synchronous warm start: read the shared meetings cache DURING the first render so a
  // cache-hit visit never paints the skeleton (loading=true + post-paint effect used to
  // flash it on every visit). Computed once — useState initializer, not per-render.
  const [warmMeetings] = useState<Meeting[] | null>(() => {
    if (!user || projectId) return null;
    const cached = queryClient.getQueryData(['focusos-meetings', user.id]) as any[] | undefined;
    if (!cached) return null;
    return cached.map((m: any) => ({
      ...m,
      action_items: Array.isArray(m.action_items) ? m.action_items : [],
      processing_status: m.processing_status || 'done',
      processing_error: m.processing_error || null,
      transcript_segments: m.transcript_segments ?? null,
    }));
  });
  const [meetings, setMeetings] = useState<Meeting[]>(warmMeetings ?? []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(warmMeetings === null);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);

  // Recording state. The recorder itself is the module-level singleton in
  // src/lib/meetingRecorder.ts (it outlives this page); this page only reads it.
  // localRecordingState covers what happens AFTER the save: processing / idle.
  const { snap: recSnap, elapsedSeconds: recordingSeconds } = useMeetingRecorder();
  const [localRecordingState, setRecordingState] = useState<RecordingState>('idle');
  const isPaused = recSnap.phase === 'paused';
  // A save that just finished and is still processing server-side is ADOPTED by
  // this page (banner + status poll). The displayed state is derived from the
  // recorder snapshot DURING RENDER, so the saving -> processing hand-over never
  // paints an idle frame (render-phase law); the effect below only records that
  // the save has been handled and starts the poll.
  // Only the save THIS page's own Stop started is adopted, and only while no new
  // recording is live: a background or resumed save finishing later never hijacks
  // the page (or navigates away from a recording in progress).
  // A save already in the foreground when the page mounts (Stop pressed on the pill,
  // then /meetings opened) counts as this page's to adopt too.
  const ownStopSessionRef = useRef<string | null>(recSnap.phase === 'saving' ? recSnap.sessionId : null);
  const [handledSavedSeq, setHandledSavedSeq] = useState(recSnap.savedSeq);
  const adoptingSave =
    recSnap.savedSeq !== handledSavedSeq &&
    !!recSnap.saved?.id &&
    recSnap.saved.sessionId === ownStopSessionRef.current &&
    recSnap.phase !== 'recording' &&
    recSnap.phase !== 'paused';
  const recordingState: RecordingState =
    recSnap.phase === 'recording' || recSnap.phase === 'paused'
      ? 'recording'
      : recSnap.phase === 'saving' || adoptingSave
      ? 'processing'
      : localRecordingState;

  // Refs for values needed inside async closures
  const meetingNameRef = useRef('');
  const participantsRef = useRef<Participant[]>([{ name: '', email: '' }, { name: '', email: '' }]);

  // Participants
  const [participants, setParticipants] = useState<Participant[]>([
    { name: '', email: '' },
    { name: '', email: '' },
  ]);
  const [showParticipants, setShowParticipants] = useState(shouldOpenNew);
  const [meetingName, setMeetingName] = useState('');

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Async processing polling state
  const [processingMeetingId, setProcessingMeetingId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('uploading');
  // done/total for the in-flight transcription, or null while the segment plan is
  // unknown — the banner falls back to the count-less label then.
  const [processingProgress, setProcessingProgress] = useState<{ done: number; total: number } | null>(null);

  // Orphaned session recovery
  const [orphanedSession, setOrphanedSession] = useState<{ id: string; chunkCount: number; createdAt: string; gcsFolder: string; mimeType: string } | null>(null);
  const [recoveringSession, setRecoveringSession] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The status poll asks for transcript_segments, which the live table does not carry
  // until the server half of this wave migrates it. PostgREST answers an unknown
  // column with HTTP 400 / code 42703, and a swallowed 400 means the poll never sees
  // 'done' or 'error': no navigate, no toast, the banner spins for ever (Retry, a
  // fresh recording and orphan recovery alike). So the FIRST 42703 downgrades to the
  // two-column select and is remembered here, and every later tick asks the narrow
  // question directly - one 400 per mount, never one per tick. Once the column exists
  // the wide select simply succeeds and this stays false.
  const noSegmentsColumnRef = useRef(false);
  // Ids the status poll has itself confirmed 'done' or 'error' for, in THIS
  // session — so a racing/stale list refetch (a react-query cache serving
  // stale-while-fresh, a network read that started before the poll's own
  // patch landed) can never resurrect that exact row back to a "processing"
  // pill (MT8). Cleared the moment a NEW poll cycle starts for the same id
  // (fresh recording, Retry, orphan recovery), so a genuine restart is never
  // blocked by an earlier completion.
  const pollConfirmedTerminalRef = useRef<Set<string>>(new Set());
  // Mirrors processingMeetingId for read access from applyMeetings, which is a
  // plain closure that can run from a fetchMeetings call whose own closure was
  // captured on an earlier render (the mount effect, in particular) — a stale
  // `processingMeetingId` read there would never see a poll started afterwards.
  // Skeptic finding (2026-09-12): a row already 'transcribing'/'summarizing'
  // when the list loads (page reload, or an /app -> /meetings mount that reuses
  // a cached list within APP_DATA_STALE_TIME) had NO client poll adopt it —
  // only the server-side safety net below, which never touches this tab's UI —
  // so the card sat frozen until a hard reload ran a fresh mount. This ref lets
  // applyMeetings always read the CURRENT value.
  const processingMeetingIdRef = useRef<string | null>(null);

  // Meeting sharing info: receiverMeetingId -> { sender name }
  const [meetingSharingMap, setMeetingSharingMap] = useState<Record<string, { name: string }>>({});

  // Keep refs in sync with state
  useEffect(() => { meetingNameRef.current = meetingName; }, [meetingName]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { processingMeetingIdRef.current = processingMeetingId; }, [processingMeetingId]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      // Try warm cache first for meetings and projects
      const cachedMeetings = queryClient.getQueryData(['focusos-meetings', user.id]) as any[] | undefined;
      const cachedProjects = queryClient.getQueryData(['focusos-projects', user.id]) as any[] | undefined;

      if (cachedMeetings && !projectId) {
        setMeetings(
          cachedMeetings.map((m: any) => ({
            ...m,
            action_items: Array.isArray(m.action_items) ? m.action_items : [],
            processing_status: m.processing_status || 'done',
            processing_error: m.processing_error || null,
            transcript_segments: m.transcript_segments ?? null,
          }))
        );
        setLoading(false);
        // Cached list painted instantly; refresh it quietly behind the render. Within
        // staleTime the fetchQuery serves cache (zero network); past it this refetches
        // so a long-lived (60-min gcTime) entry can never show old meetings for long.
        fetchMeetings({ quiet: true });
      } else {
        fetchMeetings();
      }

      if (cachedProjects) {
        setProjects(cachedProjects.map((p: any) => ({ id: p.id, name: p.name, color: p.color })));
      } else {
        fetchProjects();
      }

      checkOrphanedSessions();
      fetchMeetingSharingInfo();
    }
  }, [user, projectId]);

  const fetchMeetingSharingInfo = async () => {
    if (!user) return;
    try {
      // Only receiver-side accepted meeting shares should appear on this page
      const { data: sharedItems } = await (supabase as any)
        .from('focusos_shared_items')
        .select('recipient_task_id, sender_email, item_title, created_at, updated_at')
        .eq('item_type', 'meeting')
        .eq('recipient_user_id', user.id)
        .eq('status', 'accepted');

      if (!sharedItems || sharedItems.length === 0) {
        setMeetingSharingMap({});
        return;
      }

      // Resolve sender names
      const senderEmails = [...new Set(sharedItems.map((item: any) => item.sender_email).filter(Boolean))];
      const { data: profiles } = await (supabase as any)
        .from('focusos_profiles')
        .select('user_email, first_name, last_name')
        .in('user_email', senderEmails);

      const profileMap: Record<string, string> = {};
      (profiles || []).forEach((p: any) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.user_email;
        if (p.user_email) profileMap[p.user_email] = name;
      });

      // Get receiver meetings for fallback matching (legacy rows without recipient_task_id)
      const { data: receiverMeetings } = await (supabase as any)
        .from('focusos_meetings')
        .select('id, title, created_at')
        .eq('user_id', user.id);

      const map: Record<string, { name: string }> = {};
      const usedMeetingIds = new Set<string>();

      // Primary mapping: direct by cloned meeting id saved in recipient_task_id
      sharedItems.forEach((item: any) => {
        if (!item.recipient_task_id) return;
        const senderName = profileMap[item.sender_email] || item.sender_email;
        map[item.recipient_task_id] = { name: senderName };
        usedMeetingIds.add(item.recipient_task_id);
      });

      // Fallback mapping: legacy accepted shares where recipient_task_id is null
      const legacyShares = sharedItems.filter((item: any) => !item.recipient_task_id && item.item_title);
      const meetingCandidatesByTitle: Record<string, Array<{ id: string; created_at: string }>> = {};

      (receiverMeetings || []).forEach((meeting: any) => {
        if (!meeting.title) return;
        if (!meetingCandidatesByTitle[meeting.title]) meetingCandidatesByTitle[meeting.title] = [];
        meetingCandidatesByTitle[meeting.title].push({ id: meeting.id, created_at: meeting.created_at });
      });

      Object.values(meetingCandidatesByTitle).forEach((list) => {
        list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });

      legacyShares.forEach((item: any) => {
        const candidates = (meetingCandidatesByTitle[item.item_title] || []).filter((m) => !usedMeetingIds.has(m.id));
        if (candidates.length === 0) return;

        const referenceTime = new Date(item.created_at).getTime();
        let bestMatch: { id: string; diff: number } | null = null;

        candidates.forEach((candidate) => {
          const diff = Math.abs(new Date(candidate.created_at).getTime() - referenceTime);
          if (!bestMatch || diff < bestMatch.diff) {
            bestMatch = { id: candidate.id, diff };
          }
        });

        // Safety window to avoid incorrect title-only matches
        const MAX_MATCH_WINDOW_MS = 10 * 60 * 1000;
        if (bestMatch && bestMatch.diff <= MAX_MATCH_WINDOW_MS) {
          const senderName = profileMap[item.sender_email] || item.sender_email;
          map[bestMatch.id] = { name: senderName };
          usedMeetingIds.add(bestMatch.id);
        }
      });

      setMeetingSharingMap(map);
    } catch (err) {
      console.error('Error fetching meeting sharing info:', err);
    }
  };

  // Cleanup on unmount (page-local polling only)
  useEffect(() => {
    return () => {
      // The recording itself is NOT stopped here: it lives in the module-level
      // recorder and keeps going across routes.
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Polling for async processing
  useEffect(() => {
    if (!processingMeetingId) return;
    // A fresh poll cycle (new recording, Retry, orphan recovery) always trusts
    // the server again — drop any earlier "this id is done/error" mark so a
    // genuine restart is never blocked by the applyMeetings guard below.
    pollConfirmedTerminalRef.current.delete(processingMeetingId);

    const poll = async () => {
      const read = (withSegments: boolean) =>
        (supabase as any)
          .from('focusos_meetings')
          .select(
            withSegments
              ? 'processing_status, processing_error, transcript_segments, summary, duration_seconds'
              : 'processing_status, processing_error, summary, duration_seconds',
          )
          .eq('id', processingMeetingId)
          .maybeSingle();

      let { data, error } = await read(!noSegmentsColumnRef.current);

      // Pre-migration backend tolerance: the column is not there yet, so re-ask the
      // same question without it and carry on with no segment counts.
      if (
        error &&
        !noSegmentsColumnRef.current &&
        (error.code === '42703' ||
          String(error.message ?? '').includes('transcript_segments'))
      ) {
        noSegmentsColumnRef.current = true;
        ({ data, error } = await read(false));
      }

      // maybeSingle() never errors on "0 rows" — a real error (network, RLS, an
      // unexpected 4xx/5xx) is logged instead of silently stalling forever: a
      // swallowed tick used to look identical to a healthy one with nothing new
      // to say, and the banner/card just spun for good (MT8).
      if (error) {
        console.warn('[Meetings] status poll failed for', processingMeetingId, error);
        return;
      }
      if (!data) {
        console.warn('[Meetings] status poll found no row for', processingMeetingId);
        return;
      }

      // One narrow cast for the whole payload instead of one `as any` per field
      // (keeps this tick no worse on @typescript-eslint/no-explicit-any than
      // before the fix).
      const row = data as {
        processing_status: string;
        processing_error: string | null;
        transcript_segments?: TranscriptSegments | null;
        summary?: string | null;
        duration_seconds?: number;
      };
      const status = row.processing_status;
      const procError = row.processing_error;
      // Segment ledger -> "Transcribing 3/8". Null whenever the worker has not
      // planned the run yet, which is also what clears the count on the way out
      // of 'transcribing'.
      const progress = segmentProgress(row.transcript_segments);

      setProcessingStatus(status);
      setProcessingProgress(progress);

      // The LIST CARD's own pill reads meeting.processing_status /
      // meeting.transcript_segments straight off the `meetings` array — never
      // off the two banner-only state variables above — so every tick must
      // patch this meeting's row too, or the card stays frozen at whatever
      // fetchMeetings last saw until a page reload (MT8's "stuck at 8/8").
      // summary/duration_seconds ride along so a 'done' tick flips the row
      // straight to its normal finished-card shape, with nothing extra to wait on.
      patchMeetingRow(processingMeetingId, {
        processing_status: status,
        processing_error: procError,
        transcript_segments: row.transcript_segments ?? null,
        summary: row.summary ?? null,
        duration_seconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : 0,
      });

      if (status === 'done') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        pollConfirmedTerminalRef.current.add(processingMeetingId);
        toast.success('Meeting ready');
        setProcessingMeetingId(null);
        setProcessingProgress(null);
        setRecordingState('idle');
        // Igor's word, 2026-09-12: stay on the list — the row above already
        // flipped to its finished state this same tick. fresh:true so this
        // truing-up (exact summary shape, action items) can never serve a
        // stale cached snapshot back over the row the poll just patched.
        fetchMeetings({ quiet: true, fresh: true });
      } else if (status === 'error') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        pollConfirmedTerminalRef.current.add(processingMeetingId);
        toast.error(`Processing failed: ${procError || 'Unknown error'}`);
        setProcessingMeetingId(null);
        setProcessingProgress(null);
        setRecordingState('idle');
        fetchMeetings({ fresh: true });
      }
    };

    pollingRef.current = setInterval(poll, 5000);
    // Initial poll
    poll();

    // Warm-return: a hidden tab's setInterval is throttled (sometimes to a
    // crawl) by the browser, so a poll due while backgrounded can land
    // arbitrarily late. Poll immediately the moment the tab is visible again
    // instead of waiting up to 5s for the next tick (MT8, hidden-tab case).
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [processingMeetingId]);

  // Route through the shared projects cache so an /app <-> /meetings switch within
  // staleTime serves from cache instead of re-hitting the network. The shared fetcher
  // returns full own+shared rows; map to the id/name/color shape this page uses.
  const fetchProjects = async () => {
    if (!user) return;
    try {
      const rows = await fetchProjectsShared(queryClient, user.id);
      setProjects(rows.map((p: any) => ({ id: p.id, name: p.name, color: p.color })));
    } catch (error) {
      console.error('[Meetings] fetchProjects failed:', error);
    }
  };

  const checkOrphanedSessions = async () => {
    try {
      const { data: sessions } = await (supabase as any)
        .from('focusos_recording_sessions')
        .select('id, chunk_count, created_at, updated_at, gcs_folder_path, mime_type, status')
        .in('status', ['processing', 'recording'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (sessions && sessions.length > 0) {
        const session = sessions[0];
        // Never offer recovery for the recording that is live (or being saved) right now.
        // A session that still has unsent audio on this device is being finished by
        // the recorder (the status line shows it): Recover would save half and close it.
        if (
          isSessionInFlight(session.id) ||
          isLiveInAnotherTab(session.id) ||
          (await hasUnsentChunks(session.id))
        )
          return;
        // Another DEVICE may still be recording it: Recover would close the session
        // and the phone's remaining audio could never upload. Skip a session that
        // received audio in the last 10 minutes, and an iPhone-app (AAC) session
        // younger than 12 hours (a locked phone can hold its pieces until reopened).
        const nowMs = Date.now();
        const lastTouchMs = new Date(session.updated_at ?? session.created_at).getTime();
        if (nowMs - lastTouchMs < 10 * 60_000) return;
        if (
          String(session.mime_type || '').startsWith('audio/aac') &&
          nowMs - new Date(session.created_at).getTime() < 12 * 3600_000
        )
          return;
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
      // The recorder mirrors {sessionId, startedAt, title, pausedMs, ...} to
      // localStorage; when it is THIS session, recover with the real title and
      // the real duration instead of the old "chunks x 30 s" guess.
      const mine = readPersistedRecording(orphanedSession.id);
      const realDuration = mine ? persistedDurationSeconds(mine) : null;
      const fallbackTitle = `Recovered Meeting ${new Date(orphanedSession.createdAt).toLocaleDateString()} ${new Date(orphanedSession.createdAt).toLocaleTimeString()}`;

      const { data, error } = await supabase.functions.invoke('focusos-process-meeting', {
        body: {
          sessionId: orphanedSession.id,
          mimeType: orphanedSession.mimeType.split(';')[0],
          projectId: projectId || null,
          title: meetingNameRef.current.trim() || mine?.title?.trim() || fallbackTitle,
          durationSeconds: realDuration ?? orphanedSession.chunkCount * 30, // approximate when unknown
          participants: validParticipants,
        },
      });

      if (error) throw error;

      if (mine) clearPersistedRecording(orphanedSession.id);
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
    await discardSessionData(orphanedSession.id); // record + any unsent chunks
    setOrphanedSession(null);
  };

  // Patch a single row of the rendered meetings list in place (MT8). The
  // card's pill reads meeting.processing_status / meeting.transcript_segments
  // straight off this array, so the status poll writes here every tick — not
  // just its own standalone banner state. No-ops when the row is not in the
  // list yet (a brand-new meeting from a live recording this page has never
  // fetched: only the top banner shows for that one, no card to patch).
  const patchMeetingRow = (id: string, patch: Partial<Meeting>) => {
    setMeetings(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  // Map raw meeting rows into state and, if any are still processing, arm the stuck-meeting
  // poller. Shared by the cached (unfiltered) and the direct (project-filtered) read paths.
  //
  // Guard (MT8): a list refetch can race the status poll and resolve with an
  // OLDER snapshot (a react-query cache serving stale-while-fresh, a network
  // read that started before the poll's own 'done'/'error' patch landed). For
  // any row the poll has itself confirmed done/error in this session
  // (pollConfirmedTerminalRef), such a refetch must never resurrect it back to
  // a "processing" pill — keep the already-patched row instead. Every other
  // row is untouched: plain overwrite, same as before.
  const applyMeetings = (data: any[] | null | undefined) => {
    if (!data) return;
    setMeetings(prev => {
      const prevById = new Map(prev.map(m => [m.id, m]));
      return data.map(m => {
        const incoming = {
          ...m,
          action_items: Array.isArray(m.action_items) ? m.action_items : [],
          processing_status: (m as any).processing_status || 'done',
          processing_error: (m as any).processing_error || null,
          // Kept explicitly (select('*') returns it) so an in-flight row's card pill
          // can count segments without waiting for the single-row poll.
          transcript_segments: (m as any).transcript_segments ?? null,
        };
        const existing = prevById.get(m.id);
        if (
          existing &&
          pollConfirmedTerminalRef.current.has(m.id) &&
          TERMINAL_PROCESSING_STATUSES.has(existing.processing_status) &&
          !TERMINAL_PROCESSING_STATUSES.has(incoming.processing_status)
        ) {
          return existing;
        }
        return incoming;
      });
    });

    // Safety net: if any meetings are still in-flight, ping the poller
    // so it picks back up if its chain ever died.
    const inFlight = data.some((m: any) =>
      m.processing_status === 'transcribing' || m.processing_status === 'summarizing'
    );
    if (inFlight) {
      supabase.functions
        .invoke('focusos-poll-stuck-meetings', { body: { chainCount: 0 } })
        .catch((e) => console.warn('arm-on-load poller invoke failed:', e?.message));
    }

    // Adopt an in-flight row with no client poll of its own (skeptic finding,
    // 2026-09-12): a page reload, or an /app -> /meetings mount that lands
    // after the poll's previous owner unmounted, can serve a list whose top
    // row is already 'transcribing'/'summarizing' while processingMeetingId
    // is still null in THIS mount — the ping above only reaches the server,
    // never this tab's poll effect. Only ever adopt when nothing is already
    // being polled, and never re-adopt a row this session already confirmed
    // done/error (a stale cached list re-served after this tab moved on).
    // Rows are already newest-first, so the first match is the most recent.
    if (!processingMeetingIdRef.current) {
      const toAdopt = data.find(
        (m) =>
          (m.processing_status === 'transcribing' || m.processing_status === 'summarizing') &&
          !pollConfirmedTerminalRef.current.has(m.id)
      );
      if (toAdopt) {
        setProcessingMeetingId(toAdopt.id);
      }
    }
  };

  const fetchMeetings = async (opts?: { fresh?: boolean; quiet?: boolean }) => {
    // quiet: background refresh behind an already-rendered cached list — never
    // flip the skeleton back on.
    if (!opts?.quiet) setLoading(true);

    // A project-filtered view is a strict subset of the full list, so it is read directly
    // and never cached under the shared meetings key (a later unfiltered read would
    // otherwise serve the subset).
    if (projectId) {
      const { data, error } = await (supabase as any)
        .from('focusos_meetings')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (!error) applyMeetings(data);
      setLoading(false);
      return;
    }

    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Single-flight through the shared cache: within staleTime this serves the cached rows
      // with no network (the /app <-> /meetings visit path); `fresh` forces a refetch for the
      // post-mutation callers (processing-error, delete) that must not read the stale snapshot.
      const data = await queryClient.fetchQuery({
        queryKey: appDataKeys.meetings(user.id),
        queryFn: async () => {
          const { data, error } = await (supabase as any)
            .from('focusos_meetings')
            .select('*')
            .order('created_at', { ascending: false });
          if (error) throw error;
          return data || [];
        },
        staleTime: opts?.fresh ? 0 : APP_DATA_STALE_TIME,
        gcTime: APP_DATA_GC_TIME,
      });
      applyMeetings(data);
    } catch (err) {
      console.error('[Meetings] fetchMeetings failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  /* ─── Recording (singleton in src/lib/meetingRecorder.ts) ─── */

  const handleStartRecording = useCallback(async () => {
    await startMeetingRecording({
      title: meetingNameRef.current.trim(),
      projectId: projectId || null,
      participants: participantsRef.current,
    });
  }, [projectId]);

  const handlePauseRecording = useCallback(() => pauseMeetingRecording(), []);
  const handleResumeRecording = useCallback(() => resumeMeetingRecording(), []);
  const handleStopRecording = useCallback(() => {
    ownStopSessionRef.current = getRecorderSnapshot().sessionId;
    stopMeetingRecording();
  }, []);

  // A save that finished (from this page's Stop or the floating pill's) adopts
  // the same processing banner + status poll this page always had. A save that
  // finished while this page was NOT mounted is picked up by the list fetch,
  // which adopts any row already transcribing.
  useEffect(() => {
    if (recSnap.savedSeq === handledSavedSeq) return;
    setHandledSavedSeq(recSnap.savedSeq);
    const saved = recSnap.saved;
    if (!saved?.id) return;
    // ANY finished save (own, background or resumed) puts a new meeting in the list.
    fetchMeetings({ quiet: true, fresh: true });
    const live = recSnap.phase === 'recording' || recSnap.phase === 'paused';
    if (saved.sessionId !== ownStopSessionRef.current || live) return; // not this page's save
    ownStopSessionRef.current = null;
    if (saved.processingStatus && saved.processingStatus !== 'done') {
      setProcessingMeetingId(saved.id);
      setProcessingStatus(saved.processingStatus);
      setRecordingState('processing');
    } else {
      navigate(`/meetings/${saved.id}`);
      setRecordingState('idle');
    }
  }, [recSnap.savedSeq, recSnap.saved, recSnap.phase, handledSavedSeq, navigate]);

  // A failed save leaves the session on the server: re-check for the recovery banner.
  const handledFailedSeqRef = useRef(recSnap.failedSeq);
  useEffect(() => {
    if (recSnap.failedSeq === handledFailedSeqRef.current) return;
    handledFailedSeqRef.current = recSnap.failedSeq;
    checkOrphanedSessions();
  }, [recSnap.failedSeq]);

  /**
   * Kick the segmented transcriber. Its whole contract is the meeting id: the worker
   * reads the recording path, the participants and the segment plan off the row
   * itself, and ignores every other field. `retry: true` is the only extra.
   */
  const triggerTranscription = (
    meetingData: { id: string },
    opts?: { retry?: boolean },
  ) => {
    triggerMeetingTranscription(meetingData.id, opts);
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

      const recordingGcsPath = (meetingData as any).recording_gcs_path as string;

      // The recording in GCS is the only thing a retry needs. There is no expiring
      // upload handle any more, so a row that still has its audio is ALWAYS retryable.
      if (!recordingGcsPath) {
        toast.error('No recording found for this meeting. Cannot retry.');
        return;
      }

      // Reset status + retry counter so the new transcribe call gets a fresh budget,
      // and PROVE it landed: on 2026-09-09 a Retry left gemini_transcribe_attempts at
      // 4, so the worker refused the run it had just been asked to make. A failed
      // reset means no invoke at all.
      //
      // The proof has to be the STORED ROW. An update().eq() with no .select() writes
      // zero rows for a meeting that has vanished or that RLS filters out, answers 204,
      // and supabase-js reports no error at all - "it worked" was being taken on trust.
      // .select(...).single() brings the written values back in the same round trip.
      const { data: resetRow, error: resetError } = await (supabase as any)
        .from('focusos_meetings')
        .update({
          processing_status: 'transcribing',
          processing_error: null,
          gemini_transcribe_attempts: 0,
        })
        .eq('id', meeting.id)
        .select('processing_status, gemini_transcribe_attempts')
        .single();

      if (
        resetError ||
        !resetRow ||
        resetRow.processing_status !== 'transcribing' ||
        resetRow.gemini_transcribe_attempts !== 0
      ) {
        console.error('Retry reset failed:', resetError ?? resetRow);
        toast.error('Could not reset the meeting for retry');
        return;
      }

      setProcessingMeetingId(meeting.id);
      setProcessingStatus('transcribing');
      setProcessingProgress(null);
      setRecordingState('processing');

      triggerTranscription({ id: meeting.id }, { retry: true });
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
      const { data, error } = await supabase.functions.invoke('focusos-delete-meeting', {
        body: { meetingId: meetingToDelete, deleteTasks },
      });
      if (error) throw error;
      toast.success('Meeting deleted');
      fetchMeetings({ fresh: true });
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

  // Displayed status derived from the recorder while it is saving / being adopted,
  // never corrected after paint.
  const displayedStatus =
    recSnap.phase === 'saving'
      ? 'uploading'
      : adoptingSave
      ? (recSnap.saved?.processingStatus as string)
      : processingStatus;
  const processingInfo = PROCESSING_LABELS[displayedStatus] || PROCESSING_LABELS.uploading;
  // "Transcribing 3/8" the moment the worker has a segment plan, the count-less
  // label until then. Every other status keeps its own wording.
  const piecesLeft = recSnap.savePending === 1 ? '1 piece left' : `${recSnap.savePending} pieces left`;
  const processingBannerLabel =
    recSnap.phase === 'saving' && recSnap.saveWaiting
      ? `Saving: waiting for ${recSnap.saveWaitReason === 'signin' ? 'sign-in refresh' : 'connection'} (${piecesLeft})`
      : recSnap.phase === 'saving' && recSnap.savePending > 0
      ? `Uploading audio (${piecesLeft})`
      : displayedStatus === 'transcribing' && processingProgress
      ? `Transcribing ${processingProgress.done}/${processingProgress.total}`
      : processingInfo.label;

  return (
    <>
    <div className="min-h-screen bg-background pb-20">
      {/* Header — floating glass pill (lg-pagehead) */}
      <div className="sticky top-0 z-10 lg-pagehead" data-meetings-tour-step="page">
        <div className="max-w-4xl mx-auto lg-gutter py-3 flex items-center gap-3">
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
            <Button className="gap-2" onClick={() => setShowParticipants(true)} data-meetings-tour-step="new-meeting">
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

      {/* Participant Setup — floating glass card, same material as the sidebar.
          Persistently mounted + grid-rows reveal: the frost layer is born once
          at page mount, never dies (white-flash law). data-state derives from
          state during render; inert + pointer-events keep it untabbable closed. */}
      <div
        className="lg-reveal max-w-4xl mx-auto lg-gutter w-full"
        data-state={showParticipants && recordingState === 'idle' ? 'open' : 'closed'}
        aria-hidden={!(showParticipants && recordingState === 'idle')}
        {...(showParticipants && recordingState === 'idle' ? {} : ({ inert: '' } as Record<string, string>))}
      >
        <div className="lg-reveal-clip">
        <div className="lg-reveal-content">
          <div className="lg-glasscard px-5 py-4 space-y-3 mb-1">
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
        </div>
      </div>

      {recordingState === 'recording' && (
        <div className={`lg-banner-in border-b ${isPaused ? 'bg-amber-500/10 border-amber-500/30' : 'bg-destructive/10 border-destructive/30'}`}>
          <div className="max-w-4xl mx-auto lg-gutter py-4 flex items-center justify-between">
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
                  {isPaused ? (recSnap.interrupted ? (recSnap.interruptReason === 'call' || !recSnap.interruptReason ? 'Interrupted (call or alarm)' : 'Interrupted (microphone stopped)') : 'Paused') : 'Recording...'}
                </p>
                {/* Same colour as the status line: muted grey vanished into the wallpaper on the phone. */}
                <p className={`text-sm font-mono font-semibold ${isPaused ? 'text-amber-500' : 'text-destructive'}`}>
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
        <div className="lg-banner-in bg-primary/10 border-b border-primary/30">
          <div className="max-w-4xl mx-auto lg-gutter py-6">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
              <div className="flex-1">
                <p className="font-semibold" data-processing-banner-label>{processingBannerLabel}</p>
                <p className="text-sm text-muted-foreground">
                  This may take a few minutes for long recordings
                </p>
              </div>
            </div>
            {displayedStatus !== 'error' && (
              <Progress value={processingInfo.progress} className="h-2" />
            )}
          </div>
        </div>
      )}

      {/* Background saves (a Stop that is waiting for the connection): a small status
          line, never the full processing screen, so New Meeting stays usable. */}
      {recSnap.saveJobs > 0 && recordingState !== 'processing' && (
        <div className="max-w-4xl mx-auto lg-gutter pt-2" data-bg-save-status>
          <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
            <span>
              {recSnap.saveWaiting
                ? `${recSnap.saveJobs} meeting${recSnap.saveJobs === 1 ? '' : 's'} waiting to upload${recSnap.saveWaitReason === 'signin' ? ' (open the app to refresh sign-in)' : ''}, ${piecesLeft}`
                : `Saving ${recSnap.saveJobs} meeting${recSnap.saveJobs === 1 ? '' : 's'} in the background, ${piecesLeft}`}
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-4xl mx-auto lg-gutter pb-6">
        {/* Orphaned session recovery banner */}
        {orphanedSession && recordingState === 'idle' && (
          <Card className="mb-4 border-amber-500/50 bg-amber-500/10">
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-amber-500" />
                  Unprocessed Recording Found
                </h3>
                <p className="text-xs text-muted-foreground mt-1" data-orphan-summary>
                  {(() => {
                    // Real title + duration from the recorder's localStorage mirror
                    // when it is this very session; otherwise the old chunk-count guess.
                    const mine = readPersistedRecording(orphanedSession.id);
                    const secs = mine ? persistedDurationSeconds(mine) : null;
                    const dur = secs !== null ? formatDuration(secs) : `${orphanedSession.chunkCount * 30}s`;
                    const name = mine?.title?.trim();
                    return `A ${dur} recording${name ? ` "${name}"` : ''} from ${new Date(orphanedSession.createdAt).toLocaleString()} wasn't fully processed. Your audio is safe.`;
                  })()}
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
          <div className="text-center py-20" data-meetings-tour-step="list">
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
          <div className="space-y-3" data-meetings-tour-step="list">
            {meetings.map(meeting => {
              const project = projects.find(p => p.id === meeting.project_id);
              const updatedAt = new Date(meeting.updated_at || meeting.created_at).getTime();
              // Only mark "Failed" when the backend has explicitly set status to error.
              // Stuck rows (no recent update) stay as "Processing" — the poller will retry
              // up to 3 times before flipping the status to error.
              const hasError = meeting.processing_status === 'error';
              const isProcessing =
                !!meeting.processing_status &&
                meeting.processing_status !== 'done' &&
                meeting.processing_status !== 'error';
              const minutesSinceUpdate = Math.floor((Date.now() - updatedAt) / 60000);
              const isLong = isProcessing && minutesSinceUpdate >= 2;
              // The row's own segment ledger, so an in-flight card counts progress
              // without the single-row poll (which only follows ONE meeting).
              const rowProgress = segmentProgress(meeting.transcript_segments);
              const processingLabel =
                meeting.processing_status === 'summarizing'
                  ? 'Summarizing'
                  : meeting.processing_status === 'transcribing'
                    ? rowProgress
                      ? `Transcribing ${rowProgress.done}/${rowProgress.total}`
                      : (isLong ? `Transcribing (${minutesSinceUpdate}m)` : 'Transcribing...')
                    : 'Processing';
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
                            <Badge
                              variant="secondary"
                              data-processing-pill
                              className={`text-xs shrink-0 gap-1 ${isLong ? 'bg-amber-500/15 text-amber-600 border-amber-500/30' : ''}`}
                              title={isLong ? 'Transcription is taking longer than usual. Will auto-retry up to 3 times.' : undefined}
                            >
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {processingLabel}
                            </Badge>
                          )}
                          {hasError && (
                            <Badge
                              variant="destructive"
                              className="text-xs shrink-0"
                              title={meeting.processing_error || 'Processing failed'}
                            >
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
                        {meetingSharingMap[meeting.id] && (
                          <Badge 
                            variant="outline" 
                            className="bg-purple-600/15 text-purple-400 border-purple-600/30 text-xs inline-flex items-center gap-1 w-fit mt-1"
                          >
                            <Share2 className="h-3 w-3 shrink-0" />
                            <span>Meeting shared by {meetingSharingMap[meeting.id].name}</span>
                          </Badge>
                        )}
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
            {/* Plain buttons, not AlertDialogAction (either choice keeps the
                dialog's own close path) — given the house pill classes so the
                three-action row matches every other confirm. */}
            <Button
              variant="outline"
              className="lg-btn"
              disabled={deleting}
              onClick={() => handleDeleteMeeting(false)}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Keep Tasks & Delete Meeting
            </Button>
            <Button
              variant="destructive"
              className="lg-btn danger"
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
    {/* Radial FAB — hidden behind every modal surface, the Projects drawer
        included (same guard shape as /app: the FAB is not portalled and sits at
        z-100, so without this it paints over, and stays clickable through, an
        open drawer). */}
    {!projectsDrawerOpen && (
      <RecordFAB onBrainDump={() => navigate('/home?braindump=1')} />
    )}
    {user && (
      <BrainDumpLiveDialog
        open={brainDumpOpen}
        onOpenChange={setBrainDumpOpen}
        userId={user.id}
        projects={projects.map(p => ({ id: p.id, name: p.name }))}
        onTasksCreated={(createdRows) => {
          const n = createdRows?.length ?? 0;
          toast.success(n > 0 ? `${n} task${n === 1 ? '' : 's'} added` : 'Tasks added');
        }}
      />
    )}
    <BottomNav onOpenProjectsDrawer={() => setProjectsDrawerOpen((o) => !o)} />

    {/* Projects drawer: PERMANENTLY mounted, closed by default (white-flash
        law). Opens over /meetings; only a pick inside it navigates. */}
    <ProjectsDrawerHost
      open={projectsDrawerOpen}
      onOpenChange={setProjectsDrawerOpen}
      userId={user?.id}
    />
    <MeetingsTour
      isOpen={tourOpen}
      phase="list"
      onComplete={async () => {
        setTourOpen(false);
        hasAutoLaunchedMeetingsTourRef.current = true;
        await markMeetingsTourComplete();
      }}
      onAdvanceToDetail={() => {
        navigate(`/meetings/${DEMO_MEETING_ID}?tour=meetings&phase=detail`);
      }}
    />
    </>
  );
};

export default Meetings;
