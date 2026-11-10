import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Mic, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import {
  useMeetingRecorder,
  pause as pauseMeetingRecording,
  resume as resumeMeetingRecording,
  stop as stopMeetingRecording,
  resumePendingSessions,
} from '@/lib/meetingRecorder';

const formatTimer = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/**
 * Floating meeting-recording pill. The recorder is a module-level singleton
 * (src/lib/meetingRecorder.ts), so a recording survives navigation; this pill is
 * the handle that follows Igor around the app: elapsed time, Pause/Resume, Stop,
 * and a tap on the body goes back to /meetings.
 *
 * z-30: above the dock (20) but BELOW the projects drawer, sheets (50) and dialogs
 * (110), so those cover it and never lose taps to it.
 * Sits just above the bottom dock (left on phones so the record FAB stays clear,
 * centred on wide screens), so it never covers the top bar. Plain div, no Radix
 * layer, pixel radii. Hidden on /meetings itself, where the
 * page's own recording banner shows. Visuals copy that banner (red pulsing dot,
 * mono timer, amber when paused, the same outline / destructive buttons) on the
 * house glass tokens.
 */
const RecordingPill: React.FC = () => {
  const { snap, elapsedSeconds } = useMeetingRecorder();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Unsent chunks left in IndexedDB by an earlier page life (reload, closed tab,
  // sign-out) are uploaded once per signed-in user.
  const userId = user?.id;
  useEffect(() => {
    if (userId) void resumePendingSessions(userId);
  }, [userId]);

  // A save that finished while the Meetings page was not mounted leaves its list
  // cache stale: drop it so the new row shows the moment /meetings is opened.
  const seenSavedSeq = useRef(snap.savedSeq);
  useEffect(() => {
    if (snap.savedSeq === seenSavedSeq.current) return;
    seenSavedSeq.current = snap.savedSeq;
    queryClient.invalidateQueries({ queryKey: ['focusos-meetings'] });
  }, [snap.savedSeq, queryClient]);

  const live = snap.phase === 'recording' || snap.phase === 'paused';
  const saving = !live && (snap.phase === 'saving' || snap.saveJobs > 0);
  // Only for a signed-in user (the pill is mounted outside the auth gates).
  if (!user) return null;
  if (!live && !saving) return null;
  if (location.pathname === '/meetings') return null;
  const left = snap.savePending === 1 ? '1 piece left' : `${snap.savePending} pieces left`;
  const savingLabel = snap.saveWaiting ? 'Saving: waiting for connection' : 'Saving...';

  const paused = snap.phase === 'paused';

  return (
    <div
      role="status"
      aria-live="off"
      data-testid="recording-pill"
      data-phase={saving ? 'saving' : snap.phase}
      data-waiting={saving && snap.saveWaiting ? 'true' : undefined}
      className={`fixed left-3 sm:left-1/2 sm:-translate-x-1/2 z-[30] flex items-center gap-2 border pl-3 pr-2 py-1.5 ${
        paused ? 'border-amber-500/40' : 'border-destructive/40'
      }`}
      style={{
        // Floats just above the bottom dock (62px tall, bottom 10px on phones, 16px
        // on wide screens, --shell-dock-bottom in the iOS shell), never over the top
        // bar. On phones it hugs the left edge so the record FAB (right edge) stays
        // clear; on wide screens it centres over the dock.
        bottom: 'calc(var(--shell-dock-bottom, 10px) + 70px)',
        maxWidth: 'calc(100vw - 100px)',
        borderRadius: 999,
        background: 'var(--gbg)',
        backdropFilter: 'blur(var(--lg-blur)) saturate(var(--lg-sat))',
        WebkitBackdropFilter: 'blur(var(--lg-blur)) saturate(var(--lg-sat))',
        boxShadow: 'var(--gshadow)',
      }}
    >
      <button
        type="button"
        data-testid="recording-pill-open"
        aria-label="Open meeting recording"
        className="flex items-center gap-2 min-w-0 text-left"
        onClick={() => navigate('/meetings')}
      >
        <span className="relative shrink-0">
          {paused ? (
            <Pause className="h-4 w-4 text-amber-500" />
          ) : (
            <>
              <Mic className="h-4 w-4 text-destructive" />
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-destructive rounded-full animate-pulse" />
            </>
          )}
        </span>
        <span className="flex flex-col leading-tight min-w-0">
          <span className={`text-[11px] font-semibold truncate ${paused ? 'text-amber-500' : 'text-destructive'}`}>
            {saving ? savingLabel : paused ? 'Paused' : 'Recording'}
          </span>
          <span data-testid="recording-pill-time" className="text-xs text-muted-foreground font-mono">
            {saving && snap.savePending > 0 ? left : formatTimer(elapsedSeconds)}
          </span>
        </span>
      </button>
      {live && (
        <div className="flex items-center gap-1.5 shrink-0">
          {paused ? (
            <Button
              variant="outline"
              size="sm"
              data-testid="recording-pill-resume"
              className="h-8 px-2.5 gap-1.5 border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
              onClick={resumeMeetingRecording}
            >
              <Play className="h-3.5 w-3.5" />
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              data-testid="recording-pill-pause"
              className="h-8 px-2.5 gap-1.5"
              onClick={pauseMeetingRecording}
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            data-testid="recording-pill-stop"
            className="h-8 px-2.5 gap-1.5"
            onClick={stopMeetingRecording}
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      )}
    </div>
  );
};

export default RecordingPill;
