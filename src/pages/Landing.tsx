/*
DIRECTION CONTRACT (impeccable new-work, extension of the established world)
THESIS: the film IS the landing. The page extends the approved promo film into a
  scrollable product story; refused: the generic SaaS hero + screenshot card grid.
OWN-WORLD: liquid-glass, film grammar. Dark smoke bookends (#11141f with teal and
  coral washes), light frost product act, deep teal accent #0f7490, glass frames
  with specular borders, dark device bezels, system font stack, radius 26/20/999.
STORY: the visitor is asked the film's two questions, watches the film answer
  them, reads the five features in the film's own voice, and starts free.
FIRST VIEWPORT: dark act. The product name as display type, the benefit line
  as the small line beneath, the film playing in a glass frame capped to keep
  Start Free Today above the fold. Portrait viewports get the portrait cut,
  chosen before load. Nav carries the compact "Start Here" (no Sign In: the
  footer link and the dialog's own toggle cover returning users).
FORM: single scroll, film order: film, five feature acts, dark close. Concept
  roll not run: owner-pinned structure (precisely specified brief inside the
  established liquid-glass world; new-work extension rule). The five film
  labels above the feature heads are a committed-world quotation of the
  approved film, kept over the craft-floor kicker default by the owner's brief.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
  finish review, the verdict, and DESIGN.md.
*/
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { AppBootSkeleton } from '@/components/AppSkeletons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AuthCard, { type AuthMode } from '@/components/AuthCard';
import { useAuth } from '@/hooks/useAuth';

const BASE = import.meta.env.BASE_URL;

/* itms-beta:// deep-links straight into the TestFlight app, skipping Apple's
   join web page — but it is a dead click anywhere TestFlight can't exist, so
   only iOS devices get it (modern iPads report a Mac UA, hence the touch probe). */
const IS_IOS_DEVICE =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const TESTFLIGHT_JOIN = IS_IOS_DEVICE
  ? 'itms-beta://testflight.apple.com/join/7jkBSvhA'
  : 'https://testflight.apple.com/join/7jkBSvhA';

/* The film's own spring register: critically damped, no overshoot (apple-design:
   damping 1.0, response ~0.5). One authored moment: surfaces MATERIALIZE
   (blur + rise together), they never just fade. */
const materialize = {
  hidden: { opacity: 0, y: 28, filter: 'blur(14px)' },
  shown: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, bounce: 0, duration: 0.7 },
  },
};
const quiet = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.45 } },
};

type Feature = {
  id: string;
  label: string;
  head: string;
  body: string;
  alt: string;
  /* clip: scene re-rendered screen-only at 780x1688, fills PhoneFrame's screen
     via object-cover. panel: authored product-styled JSX, laid out on its own
     390x844 canvas and scaled to the frame (see McpPanel). Every feature now
     shares the one PhoneFrame; there is no bezel path left to pick. */
  clip?: string;
  panel?: 'mcp';
};

/* Copy law: the film's narration and Igor's approved benefit lines only.
   No invented claims, no em dashes. */
const FEATURES: Feature[] = [
  {
    id: 'braindump',
    label: 'Brain Dump',
    head: 'Speak your todo list into existence!',
    body:
      'Press a button and talk. Everything you say appears on screen as you speak, in order, grouped into projects. No typing. No sorting. No cleanup. Just works!',
    clip: 'braindump',
    alt: 'Focus OS listening while spoken tasks appear grouped into projects',
  },
  {
    id: 'handoff',
    label: 'AI Handoff',
    head: 'Hand the work to your AI',
    body:
      'See a task you think an AI can do for you? Press a button and it is transferred to your favourite AI. Once received, the AI already knows exactly what to do!',
    clip: 'handoff',
    alt: 'Hand off to AI sheet with the generated prompt ready to send',
  },
  {
    id: 'mcp',
    label: 'MCP Server',
    head: 'Plug your AI straight into your tasks',
    body:
      'Focus OS speaks MCP, the open standard AI assistants use. Connect once and your assistant can read your task list, add new tasks and tick things off, right from the chat you already live in.',
    panel: 'mcp',
    alt: 'An AI assistant connected to Focus OS listing and creating tasks over MCP',
  },
  {
    id: 'meetings',
    label: 'Meetings',
    head: 'Never lose an action item again',
    body:
      'Have a meeting? Record it, get the transcript and the summary, and send it to your team. Then turn any action item into a task and choose what to focus on. Easy work!',
    clip: 'meetings',
    alt: 'A recorded meeting with its overview, outline and action items',
  },
  {
    id: 'sharing',
    label: 'Sharing',
    head: 'Delegate to anyone. Watch it get done',
    body:
      'Who is best for this task? Share it with Sarah or Steve, even whole projects, by email or calendar invite. When the task is complete, you get notified. Now that is collaboration!',
    clip: 'sharing',
    alt: 'Share Task dialog sending a task to a teammate by email',
  },
  {
    id: 'collab',
    label: 'Collaboration',
    head: 'One project. Everyone in it.',
    body:
      'Invite your people into a project as collaborators or viewers. Everyone works on the same tasks, live. No copies, no versions, no forwarding. Sharing hands one task out; collaboration brings the whole team in.',
    clip: 'collab',
    alt: 'A shared project with its members and tasks being completed together',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    head: 'Your plan lands on your calendar',
    body:
      'One tap sends your plan to a dedicated calendar, with real invites and a free/busy availability picker.',
    clip: 'calendar',
    alt: 'Free/busy availability picker over a day grid',
  },
  {
    id: 'timelines',
    label: 'Timelines',
    head: 'See the whole project on one line',
    body:
      'Every task becomes a bar on the month, next to everything else on the plan. Drag a bar to move its dates and the plan reshapes itself. Planning is just dragging.',
    clip: 'gantt',
    alt: 'A project timeline with task bars laid across the month',
  },
  {
    id: 'time',
    label: 'Time Tracking',
    head: 'Know where your time went',
    body:
      'Every task has a play button. Press it and Focus OS counts the minutes, flips the task into progress, and charts your hours by project and task. The proof of a day of work, drawn for you.',
    clip: 'time',
    alt: 'Tracked hours charted per project and task',
  },
];

/* Ratio is decided BEFORE the video element ever renders, so exactly one file
   downloads per device (Igor's matchMedia law). */
const pickRatio = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(orientation: portrait), (max-width: 767px)').matches
    ? 'portrait'
    : 'landscape';

const FilmPlayer = () => {
  const [ratio] = useState<'portrait' | 'landscape'>(pickRatio);
  const [withSound, setWithSound] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const portrait = ratio === 'portrait';

  /* The narration carries the whole pitch: a persistent sound TOGGLE in the
     world's own glass, alongside the familiar native controls. Unmuting
     restarts from the top so the pitch is heard whole; muting just mutes.
     The button never unmounts (Igor, 2026-08-09: a control that vanishes
     after its first click reads as a bug). */
  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    if (withSound) {
      v.muted = true;
      setWithSound(false);
    } else {
      v.muted = false;
      v.currentTime = 0;
      void v.play();
      setWithSound(true);
    }
  };

  /* iPhone Safari has no requestFullscreen on video; webkitEnterFullscreen
     opens the system player (sound + controls). Everything else gets the
     standard API. */
  const enterFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    const wk = v as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (typeof v.requestFullscreen === 'function') {
      v.requestFullscreen().catch(() => wk.webkitEnterFullscreen?.());
    } else {
      wk.webkitEnterFullscreen?.();
    }
  };

  return (
    <div
      className={
        'relative overflow-hidden rounded-[26px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] bg-black/40 ' +
        (portrait
          ? 'w-full max-w-[min(380px,34svh)]'
          : 'w-full max-w-[min(1024px,96svh)]')
      }
      style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}
    >
      {/* scale-[1.01]: the picture reaches past any sub-pixel inset Safari
          gives the video layer, so no dark ring can show inside the edge.
          The specular border is the overlay ring below, drawn ABOVE the video. */}
      <video
        ref={videoRef}
        className="block h-auto w-full scale-[1.01] rounded-[26px]"
        style={{ aspectRatio: portrait ? '9 / 16' : '16 / 9' }}
        controls
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster={`${BASE}media/poster-${ratio}.jpg`}
      >
        <source src={`${BASE}media/focus-os-promo-${ratio}.mp4`} type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[26px] border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
      />
      <button
        onClick={enterFullscreen}
        aria-label="Watch full screen"
        title="Watch full screen"
        className="absolute right-3 top-3 rounded-full border border-white/15 bg-[#141925]/85 p-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-colors hover:bg-[#1d2433]/90 active:scale-[0.97]"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
      <button
        onClick={toggleSound}
        aria-label={withSound ? 'Mute' : 'Watch with sound'}
        title={withSound ? 'Mute' : 'Watch with sound'}
        className="absolute right-14 top-3 rounded-full border border-white/15 bg-[#141925]/85 p-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-colors hover:bg-[#1d2433]/90 active:scale-[0.97]"
      >
        {withSound ? (
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
            <line x1="15" y1="9" x2="21" y2="15" />
            <line x1="21" y1="9" x2="15" y2="15" />
          </svg>
        ) : (
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
    </div>
  );
};

/* Authored product-styled panels for features the film never staged. Demo
   persona data (Ivy, Sarah Chen); real capabilities only. Decorative: the
   surrounding figure carries the alt text. Blocks stagger in on scroll, in
   the page's spring register. */
const panelStagger = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.16, delayChildren: 0.1 } },
};
const panelItem = {
  hidden: { opacity: 0, y: 14 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, bounce: 0, duration: 0.5 },
  },
};

/* Native phone metrics: the panel is laid out once on a fixed 390x844 canvas
   (390pt = a real phone screen) and CSS-scaled to the screen's MEASURED width.
   Measured, not per-breakpoint constants: the frame clamps to its grid column
   below 1024 (max-w-full), so the screen can sit anywhere under its breakpoint
   width. ResizeObserver fires after layout, before paint; the initial value
   only carries the very first frame. */
const McpPanel = () => {
  const reduce = useReducedMotion();
  const V = reduce ? undefined : panelItem;
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(309 / 390);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 390));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={hostRef} className="h-full w-full">
      <div className="origin-top-left" style={{ width: 390, height: 844, transform: `scale(${scale})` }}>
        <McpPanelBody reduce={reduce} V={V} />
      </div>
    </div>
  );
};

const McpPanelBody = ({ reduce, V }: { reduce: boolean | null; V?: typeof panelItem }) => (
    <motion.div
        aria-hidden
        className="flex h-full w-full flex-col gap-4 bg-[#f4f5f7] p-5 text-[#1b1f24]"
        variants={reduce ? undefined : panelStagger}
        initial={reduce ? false : 'hidden'}
        whileInView={reduce ? undefined : 'shown'}
        viewport={{ once: true, amount: 0.3 }}
      >
        <motion.div variants={V} className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm">
          <span className="flex items-center gap-2 text-[16px] font-semibold">
            <span className="h-2.5 w-2.5 rounded-full bg-[#34c759]" />
            Assistant connected
          </span>
          <span className="rounded-full bg-[#0f7490]/10 px-3 py-1 text-[13px] font-bold text-[#0f7490]">
            MCP
          </span>
        </motion.div>
        <motion.div variants={V} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#11141f] px-5 py-3 text-[16px] leading-relaxed text-white">
          What is on my plate today?
        </motion.div>
        <motion.div variants={V} className="mr-auto max-w-[92%] rounded-2xl rounded-bl-md bg-white px-5 py-3 text-[16px] leading-relaxed shadow-sm">
          Three tasks today: homepage mockups for Sarah (high), the pricing page
          copy, and booking the photographer.
        </motion.div>
        <motion.div variants={V} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#11141f] px-5 py-3 text-[16px] leading-relaxed text-white">
          Add one: send Sarah the final logo files.
        </motion.div>
        <motion.div variants={V} className="mr-auto flex max-w-[92%] items-center gap-2 rounded-2xl border border-[#34c759]/30 bg-[#34c759]/10 px-5 py-3 text-[15px] font-medium text-[#1b6f3d]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Task created · Website Redesign
        </motion.div>
        <motion.div variants={V} className="mt-auto flex flex-wrap items-center gap-2 text-[13px] font-medium text-[#22303a]/60">
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">Claude</span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">ChatGPT</span>
          <span className="rounded-full bg-white px-3 py-1.5 shadow-sm">any MCP client</span>
        </motion.div>
    </motion.div>
);

const PHONE_SHADOW =
  'shadow-[0_34px_70px_-28px_rgba(15,40,52,0.55),inset_0_1px_0_rgba(255,255,255,0.14)]';

/* Unified CSS phone frame: every feature section renders through this one
   frame (sample-approved on braindump, now the only path). The frame owns
   bezel + screen geometry; screen radius = outer radius minus padding, so
   the ring reads as one continuous edge. Media just fills the screen via
   object-cover — no bezel baked into the pixels here, so no scale-[1.01] is
   needed to hide a sub-pixel seam. */
/* Sizes are ~21% under the first shipped cut (Igor, 2026-08-09, two rounds:
   "too large on desktop", then "still too tall — 10% smaller and we move
   on"). max-w-full is the overflow law: the two-column act
   grid starts at 640px where a fixed-width frame can exceed its column and
   punch out of the viewport — the frame must clamp to whatever its cell
   gives it, never clip. Radii stay concentric: inner = outer - padding. */
const PhoneFrame = ({ children }: { children: ReactNode }) => (
  <div
    data-testid="phone-frame"
    className={`relative mx-auto w-[min(238px,78vw)] max-w-full rounded-[38px] bg-[#1d232c] p-[8px] ${PHONE_SHADOW} sm:w-[301px] sm:rounded-[49px] sm:p-[10px] lg:w-[331px] lg:rounded-[53px] lg:p-[11px]`}
  >
    <div
      data-testid="phone-frame-screen"
      className="overflow-hidden rounded-[30px] sm:rounded-[39px] lg:rounded-[42px]"
      style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', aspectRatio: '390 / 844' }}
    >
      {children}
    </div>
  </div>
);

/* Each phone plays its scene from the approved film (Igor: the animations we
   already have), or the mcp panel. Muted loop, plays only while on screen,
   poster = the clip's own first frame so nothing jumps at load. Reduced
   motion gets the poster. Clips are re-rendered screen-only at 780x1688
   (390:844) and just fill the frame's screen edge to edge. */
const ScenePhone = ({ feature }: { feature: Feature }) => {
  const reduce = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || reduce || feature.panel) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduce, feature.panel]);

  const media =
    feature.panel === 'mcp' ? (
      <McpPanel />
    ) : reduce ? (
      <img
        src={`${BASE}media/clips/${feature.clip}-poster.jpg`}
        alt={feature.alt}
        loading="lazy"
        decoding="async"
        width={780}
        height={1688}
        className="block h-full w-full object-cover"
      />
    ) : (
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="none"
        width={780}
        height={1688}
        poster={`${BASE}media/clips/${feature.clip}-poster.jpg`}
        aria-label={feature.alt}
        className="block h-full w-full object-cover"
      >
        <source src={`${BASE}media/clips/${feature.clip}.mp4`} type="video/mp4" />
      </video>
    );

  return <PhoneFrame>{media}</PhoneFrame>;
};

/* One card behind both entrances: the landing dialog renders the SAME
   AuthCard as /auth, in the theme's own light glass (DialogContent default).
   On success the card closes and the landing's user-redirect effect carries
   the session to /home. */
const AuthDialog = ({
  open,
  mode,
  onOpenChange,
  onModeChange,
}: {
  open: boolean;
  mode: AuthMode;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: AuthMode) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[min(92vw,420px)]">
      {/* a11y names for the dialog; the visible header lives in AuthCard */}
      <DialogTitle className="sr-only">Focus OS</DialogTitle>
      <DialogDescription className="sr-only">
        Sign in or create your Focus OS account
      </DialogDescription>
      <AuthCard mode={mode} onModeChange={onModeChange} onAuthed={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
);

const Landing = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      // Forward the query string: the Pages 404 fallback strips deep-link paths,
      // so params (?fakedump, future deep-link args) arrive on the ROOT url and
      // would otherwise die in this redirect.
      navigate('/home' + window.location.search);
    }
  }, [user, loading, navigate]);

  // Auth restoring OR logged-in (about to bounce to /home): show the boot
  // skeleton instead of a one-frame marketing flash.
  if (loading || user) {
    return <AppBootSkeleton />;
  }

  const enter = reduce ? quiet : materialize;
  const openAuth = (m: AuthMode) => {
    setAuthMode(m);
    setAuthOpen(true);
  };
  const toTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div
      ref={scrollRef}
      data-landing-scroll
      className="h-[100dvh] overflow-y-auto overflow-x-hidden overscroll-y-none bg-[#11141f] text-white"
    >
      {/* ==== NAV: one dark glass pill, legible over both grounds ==== */}
      <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-6">
        <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-white/15 bg-[#141925]/90 py-1.5 pl-3 pr-1.5 shadow-[0_14px_36px_-14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md sm:gap-5 sm:pl-5">
          <button
            type="button"
            onClick={toTop}
            aria-label="Back to top"
            className="whitespace-nowrap text-[16px] font-semibold tracking-[-0.01em] text-white/95 transition-opacity hover:opacity-80 active:scale-[0.98]"
          >
            Focus OS
          </button>
          <div className="flex items-center gap-1.5">
            {/* Opens the TestFlight-first install dialog: without the TestFlight
                app, the join link dead-ends on an itms-beta:// error in Safari. */}
            <Button
              variant="ghost"
              onClick={() => setIosOpen(true)}
              className="h-9 rounded-full px-2.5 text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.97] sm:px-4"
            >
              <svg viewBox="0 0 384 512" className="h-4 w-4 fill-current" aria-hidden>
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
              </svg>
              <span>iOS App</span>
            </Button>
            <Button
              onClick={() => openAuth('signup')}
              className="h-9 rounded-full bg-white px-3 text-[#11141f] hover:bg-white/90 active:scale-[0.97] sm:px-5"
            >
              Start Here
            </Button>
          </div>
        </div>
      </header>

      {/* ============================== HERO ============================= */}
      <section className="relative overflow-hidden px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-24">
        {/* the film's dark ground: same two washes as the smoke act */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 60% at 12% 6%, rgba(15,116,144,0.24) 0%, transparent 60%), radial-gradient(80% 55% at 92% 92%, rgba(255,122,92,0.10) 0%, transparent 60%)',
          }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
          <motion.h1
            variants={enter}
            initial="hidden"
            animate="shown"
            className="whitespace-nowrap text-[clamp(1.6rem,7vw,2.55rem)] font-bold leading-[1.05] tracking-[-0.025em] text-white sm:whitespace-normal sm:text-[clamp(2.3rem,6vw,4.2rem)]"
          >
            Focus OS, stress less!
          </motion.h1>
          <motion.p
            variants={enter}
            initial="hidden"
            animate="shown"
            transition={{ delay: 0.12 }}
            className="mt-4 text-[clamp(1.05rem,2.2vw,1.3rem)] font-medium text-white/60"
          >
            Your day, back in order.
          </motion.p>

          <motion.div
            variants={enter}
            initial="hidden"
            animate="shown"
            transition={{ delay: 0.22 }}
            className="mt-6 flex w-full justify-center"
          >
            <FilmPlayer />
          </motion.div>

          <motion.div
            variants={enter}
            initial="hidden"
            animate="shown"
            transition={{ delay: 0.34 }}
            className="mt-6 flex flex-col items-center gap-2.5"
          >
            <Button
              size="lg"
              onClick={() => openAuth('signup')}
              className="rounded-full bg-[#0f7490] px-9 py-6 text-lg font-semibold text-white shadow-[0_18px_40px_-12px_rgba(15,116,144,0.55)] hover:bg-[#0d6580] active:scale-[0.97]"
            >
              Start Free Today
            </Button>
            <p className="text-sm text-white/50">No credit card required</p>
          </motion.div>
        </div>
      </section>

      {/* ========================= THE FIVE ACTS ========================= */}
      <section className="relative bg-[#f4f5f7] text-[#22303a]">
        {/* the light act's washes: the product's own plain-wallpaper ground */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 40% at 12% 0%, rgba(15,116,144,0.10) 0%, transparent 60%), radial-gradient(80% 45% at 92% 100%, rgba(255,122,92,0.08) 0%, transparent 60%)',
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="space-y-24 sm:space-y-32">
            {FEATURES.map((f, i) => {
              const flip = i % 2 === 1;
              return (
                <motion.article
                  key={f.id}
                  initial={reduce ? 'hidden' : { opacity: 0, y: 22 }}
                  whileInView={
                    reduce
                      ? 'shown'
                      : {
                          opacity: 1,
                          y: 0,
                          transition: { type: 'spring', bounce: 0, duration: 0.65 },
                        }
                  }
                  variants={reduce ? quiet : undefined}
                  viewport={{ once: true, amount: 0.05, margin: '0px 0px -8% 0px' }}
                  className={
                    'grid items-center gap-10 sm:grid-cols-2 sm:gap-16 ' +
                    (flip ? 'sm:[&>*:first-child]:order-2' : '')
                  }
                >
                  {/* min-w-0 + the frame's own max-w-full: a justify-self cell
                      sizes fit-content, which clamps at the 1fr column — the
                      frame then fills the clamped cell instead of clipping */}
                  <div className={'min-w-0 max-w-full ' + (flip ? 'sm:justify-self-start' : 'sm:justify-self-end')}>
                    <ScenePhone feature={f} />
                  </div>
                  <div className="max-w-[46ch]">
                    <p className="mb-3 flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.22em] text-[#0f7490]">
                      <span aria-hidden className="h-[2px] w-6 bg-[#0f7490]/70" />
                      {f.label}
                    </p>
                    <h2 className="text-[clamp(1.9rem,4.4vw,3rem)] font-bold leading-[1.08] tracking-[-0.022em]">
                      {f.head}
                    </h2>
                    <p className="mt-4 text-[1.075rem] leading-[1.65] text-[#22303a]/70">
                      {f.body}
                    </p>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============================ CLOSE ============================== */}
      <section className="relative overflow-hidden px-4 py-24 text-center sm:py-32">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 60% at 12% 6%, rgba(15,116,144,0.20) 0%, transparent 60%), radial-gradient(80% 55% at 92% 92%, rgba(255,122,92,0.10) 0%, transparent 60%)',
          }}
        />
        <motion.div
          initial={reduce ? 'hidden' : { opacity: 0, y: 30, filter: 'blur(12px)' }}
          whileInView={
            reduce
              ? 'shown'
              : {
                  opacity: 1,
                  y: 0,
                  filter: 'blur(0px)',
                  transition: { type: 'spring', bounce: 0, duration: 0.8 },
                }
          }
          variants={reduce ? quiet : undefined}
          viewport={{ once: true, amount: 0.5 }}
          className="relative mx-auto flex max-w-3xl flex-col items-center"
        >
          <h2 className="max-w-[16ch] text-[clamp(2.2rem,6vw,4rem)] font-bold leading-[1.06] tracking-[-0.025em] text-white">
            Speak your mind. Tasks write themselves.
          </h2>
          <p className="mt-4 text-xl font-medium text-white/65">
            All done. Focus OS. Stress less.
          </p>
          <Button
            size="lg"
            onClick={() => openAuth('signup')}
            className="mt-9 rounded-full bg-[#0f7490] px-9 py-6 text-lg font-semibold text-white shadow-[0_18px_40px_-12px_rgba(15,116,144,0.55)] hover:bg-[#0d6580] active:scale-[0.97]"
          >
            Start Free Today
          </Button>
          <p className="mt-3 text-sm text-white/50">No credit card required</p>
        </motion.div>
      </section>

      {/* ============================ FOOTER ============================= */}
      <footer className="border-t border-white/10 px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-sm text-white/45 sm:flex-row">
          <span>Focus OS</span>
          <div className="flex items-center gap-6">
            <a
              href={`${import.meta.env.BASE_URL}privacy.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 hover:text-white/80 hover:underline"
            >
              Privacy<span className="sr-only"> (opens in new tab)</span>
            </a>
            <button
              onClick={() => openAuth('signin')}
              className="underline-offset-4 hover:text-white/80 hover:underline"
            >
              Sign in
            </button>
          </div>
        </div>
      </footer>

      <AuthDialog
        open={authOpen}
        mode={authMode}
        onOpenChange={setAuthOpen}
        onModeChange={setAuthMode}
      />

      <Dialog open={iosOpen} onOpenChange={setIosOpen}>
        {/* inline style, deliberately: DialogContent's glass-card CSS out-cascades
            Tailwind utilities on the marketing surface (same as AuthDialog). */}
        <DialogContent
          className="max-h-[85dvh] w-[min(92vw,440px)] overflow-y-auto border p-6 text-white"
          style={{
            background:
              'linear-gradient(180deg, rgba(24,30,44,0.97) 0%, rgba(17,20,31,0.97) 100%)',
            borderColor: 'rgba(255,255,255,0.16)',
            borderRadius: 26,
            boxShadow:
              '0 40px 90px -30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.12)',
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-bold tracking-[-0.02em]">
              Install Focus OS on your iPhone
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Focus OS installs through Apple&apos;s TestFlight. Tap the two
              links below, in order.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <a
              href="https://apps.apple.com/app/testflight/id899247664"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-4 rounded-2xl border border-white/20 bg-white/[0.12] p-4 transition-colors hover:bg-white/[0.16] active:scale-[0.99]"
            >
              <img
                src={`${BASE}images/testflight-appstore-icon.jpg`}
                alt=""
                className="h-14 w-14 flex-shrink-0 rounded-2xl sm:h-16 sm:w-16"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wide text-white/50">
                  Step 1
                </span>
                <span className="block text-base font-semibold">
                  Install TestFlight
                </span>
                <span className="block text-sm text-white/60">
                  Free, from the Apple App Store
                </span>
              </span>
            </a>

            {/* No target="_blank" on the itms-beta form: a custom scheme in a
                new tab leaves a dead blank tab behind in Safari. */}
            <a
              href={TESTFLIGHT_JOIN}
              target={IS_IOS_DEVICE ? undefined : '_blank'}
              rel={IS_IOS_DEVICE ? undefined : 'noopener noreferrer'}
              className="flex min-w-0 items-center gap-4 rounded-2xl border border-white/[0.12] bg-white/[0.06] p-4 transition-colors hover:bg-white/10 active:scale-[0.99]"
            >
              <img
                src={`${BASE}images/focusos-app-icon.png`}
                alt=""
                className="h-14 w-14 flex-shrink-0 rounded-2xl sm:h-16 sm:w-16"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wide text-white/50">
                  Step 2
                </span>
                <span className="block text-base font-semibold">
                  Install Focus OS
                </span>
                <span className="block text-sm text-white/60">
                  Opens in TestFlight
                </span>
              </span>
            </a>
          </div>

          <p className="text-sm text-white/50">
            Do Step 1 first. The Focus OS link only works once TestFlight is
            installed.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Landing;
