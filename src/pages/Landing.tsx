/*
DIRECTION CONTRACT (impeccable new-work, extension of the established world)
THESIS: the film IS the landing. The page extends the approved promo film into a
  scrollable product story; refused: the generic SaaS hero + screenshot card grid.
OWN-WORLD: liquid-glass, film grammar. Dark smoke bookends (#11141f with teal and
  coral washes), light frost product act, deep teal accent #0f7490, glass frames
  with specular borders, dark device bezels, system font stack, radius 26/20/999.
STORY: the visitor is asked the film's two questions, watches the film answer
  them, reads the five features in the film's own voice, and starts free.
FIRST VIEWPORT: dark act. The benefit line as display type, the film's questions
  as the small line beneath, the film playing in a glass frame capped to keep
  Start Free Today above the fold. Portrait viewports get the portrait cut,
  chosen before load. Nav carries the compact "Start Free".
FORM: single scroll, film order: film, five feature acts, dark close. Concept
  roll not run: owner-pinned structure (precisely specified brief inside the
  established liquid-glass world; new-work extension rule). The five film
  labels above the feature heads are a committed-world quotation of the
  approved film, kept over the craft-floor kicker default by the owner's brief.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
  finish review, the verdict, and DESIGN.md.
*/
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { AppBootSkeleton } from '@/components/AppSkeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

const BASE = import.meta.env.BASE_URL;

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
  shot: string;
  alt: string;
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
    shot: 'braindump-full.png',
    alt: 'Focus OS listening while spoken tasks appear grouped into projects',
  },
  {
    id: 'handoff',
    label: 'AI Handoff',
    head: 'Hand the work to your AI',
    body:
      'See a task you think an AI can do for you? Press a button and it is transferred to your favourite AI. Once received, the AI already knows exactly what to do!',
    shot: 'handoff-full.png',
    alt: 'Hand off to AI sheet with the generated prompt ready to send',
  },
  {
    id: 'meetings',
    label: 'Meetings',
    head: 'Never lose an action item again',
    body:
      'Have a meeting? Record it, get the transcript and the summary, and send it to your team. Then turn any action item into a task and choose what to focus on. Easy work!',
    shot: 'meeting-phone-full.png',
    alt: 'A recorded meeting with its overview, outline and action items',
  },
  {
    id: 'sharing',
    label: 'Sharing',
    head: 'Delegate to anyone. Watch it get done',
    body:
      'Who is best for this task? Share it with Sarah or Steve, even whole projects, by email or calendar invite. When the task is complete, you get notified. Now that is collaboration!',
    shot: 'share-dialog-full.png',
    alt: 'Share Task dialog sending a task to a teammate by email',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    head: 'Your plan lands on your calendar',
    body:
      'One tap sends your plan to a dedicated calendar, with real invites and a free/busy availability picker.',
    shot: 'calendar-availability-full.png',
    alt: 'Free/busy availability picker over a day grid',
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

  /* The narration carries the whole pitch: an authored restart-with-sound
     control in the world's own glass, alongside the familiar native controls. */
  const playWithSound = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.currentTime = 0;
    void v.play();
    setWithSound(true);
  };

  return (
    <div
      className={
        'relative overflow-hidden rounded-[26px] border border-white/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.18)] bg-black/40 ' +
        (portrait
          ? 'w-full max-w-[min(380px,34svh)]'
          : 'w-full max-w-[min(1024px,96svh)]')
      }
    >
      <video
        ref={videoRef}
        className="block h-auto w-full"
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
      {!withSound && (
        <button
          onClick={playWithSound}
          className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/25 bg-white/12 px-4 py-2 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md transition-colors hover:bg-white/20 active:scale-[0.97]"
        >
          <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
          Watch with sound
        </button>
      )}
    </div>
  );
};

const PhoneShot = ({ feature }: { feature: Feature }) => (
  <div className="relative mx-auto w-[min(300px,78vw)] rounded-[44px] bg-[#1d232c] p-[10px] shadow-[0_34px_70px_-28px_rgba(15,40,52,0.55),inset_0_1px_0_rgba(255,255,255,0.14)] sm:w-full sm:max-w-[380px] lg:max-w-[420px]">
    <img
      src={`${BASE}media/shots/${feature.shot}`}
      alt={feature.alt}
      loading="lazy"
      decoding="async"
      width={780}
      height={1688}
      className="block w-full rounded-[34px]"
    />
  </div>
);

type AuthMode = 'signin' | 'signup';

/* The auth card, in the landing's own glass. The handlers are the ones from
   src/pages/Auth.tsx verbatim; on success the card closes and the landing's
   user-redirect effect carries the session to /home. /auth stays untouched
   for deep links. */
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
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);

  const handleGoogleSignIn = async () => {
    const isCustomDomain =
      !window.location.hostname.includes('lovable.app') &&
      !window.location.hostname.includes('lovableproject.com') &&
      !window.location.hostname.includes('localhost');

    if (isCustomDomain) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}home`,
          skipBrowserRedirect: true,
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      }
    } else {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}home`,
        },
      });
      if (error) {
        toast.error(error.message);
      }
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Welcome back!', { duration: 1500 });
      onOpenChange(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !firstName.trim() || !lastName.trim()) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}home`,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Account created! Logging you in...', { duration: 1500 });
      onOpenChange(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error('Please enter your email');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password reset link sent! Check your email.');
      setForgotPassword(false);
    }
  };

  const fieldCls =
    'h-11 rounded-xl border-white/15 bg-white/10 text-white placeholder:text-white/35 focus-visible:ring-[#0f7490] focus-visible:ring-offset-0';
  /* inline, deliberately: the theme Input CSS out-cascades utilities (same as
     the card surface) */
  const fieldStyle = {
    background: 'rgba(255,255,255,0.09)',
    borderColor: 'rgba(255,255,255,0.16)',
    color: '#ffffff',
  } as const;
  const labelCls = 'text-white/70';
  const primaryCls =
    'w-full h-11 rounded-xl bg-[#0f7490] font-semibold text-white hover:bg-[#0d6580] active:scale-[0.98]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* inline style, deliberately: DialogContent's glass-card CSS paints the
          frost material and out-cascades Tailwind utilities; the landing's dark
          glass must win on the dark ground. */}
      <DialogContent
        className="w-[min(92vw,420px)] border p-6 text-white"
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
            Focus OS
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Stress less. Free to start, no credit card required.
          </DialogDescription>
        </DialogHeader>

        <Button
          variant="outline"
          className="w-full gap-2 rounded-xl border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white active:scale-[0.98]"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </Button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-white/12" />
          <span className="text-xs text-white/40">or</span>
          <span className="h-px flex-1 bg-white/12" />
        </div>

        <div className="flex rounded-full bg-white/8 p-1">
          {(['signin', 'signup'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onModeChange(m);
                setForgotPassword(false);
              }}
              className={
                'flex-1 rounded-full py-1.5 text-sm font-medium transition-colors active:scale-[0.98] ' +
                (mode === m ? 'bg-white text-[#11141f]' : 'text-white/65 hover:text-white')
              }
            >
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {mode === 'signin' ? (
          forgotPassword ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ld-forgot-email" className={labelCls}>Email</Label>
                <Input id="ld-forgot-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
              </div>
              <Button type="submit" className={primaryCls} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-white/55 transition-colors hover:text-white"
                onClick={() => setForgotPassword(false)}
              >
                Back to Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ld-signin-email" className={labelCls}>Email</Label>
                <Input id="ld-signin-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ld-signin-password" className={labelCls}>Password</Label>
                <Input id="ld-signin-password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
              </div>
              <Button type="submit" className={primaryCls} disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-white/55 transition-colors hover:text-white"
                onClick={() => setForgotPassword(true)}
              >
                Forgot Password?
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ld-signup-firstname" className={labelCls}>First Name</Label>
                <Input id="ld-signup-firstname" type="text" placeholder="John" value={firstName} onChange={e => setFirstName(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ld-signup-lastname" className={labelCls}>Surname</Label>
                <Input id="ld-signup-lastname" type="text" placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ld-signup-email" className={labelCls}>Email</Label>
              <Input id="ld-signup-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ld-signup-password" className={labelCls}>Password</Label>
              <Input id="ld-signup-password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} className={fieldCls} style={fieldStyle} />
            </div>
            <Button type="submit" className={primaryCls} disabled={loading}>
              {loading ? 'Creating account...' : 'Start Free Today'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Landing = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');

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
        <div className="mx-auto flex w-fit items-center gap-5 rounded-full border border-white/15 bg-[#141925]/90 py-1.5 pl-5 pr-1.5 shadow-[0_14px_36px_-14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md">
          <button
            type="button"
            onClick={toTop}
            aria-label="Back to top"
            className="text-[16px] font-semibold tracking-[-0.01em] text-white/95 transition-opacity hover:opacity-80 active:scale-[0.98]"
          >
            Focus OS
          </button>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              onClick={() => openAuth('signin')}
              className="h-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white active:scale-[0.97]"
            >
              Sign In
            </Button>
            <Button
              onClick={() => openAuth('signup')}
              className="h-9 rounded-full bg-white px-5 text-[#11141f] hover:bg-white/90 active:scale-[0.97]"
            >
              Start Free
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
            className="max-w-[18ch] text-[clamp(2.3rem,6vw,4.2rem)] font-bold leading-[1.05] tracking-[-0.025em] text-white"
          >
            Your day, back in order.
          </motion.h1>
          <motion.p
            variants={enter}
            initial="hidden"
            animate="shown"
            transition={{ delay: 0.12 }}
            className="mt-4 text-[clamp(1.05rem,2.2vw,1.3rem)] font-medium text-white/60"
          >
            Big day ahead? Too much to remember?
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
                  <div className={flip ? 'sm:justify-self-start' : 'sm:justify-self-end'}>
                    <PhoneShot feature={f} />
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
          <button
            onClick={() => openAuth('signin')}
            className="underline-offset-4 hover:text-white/80 hover:underline"
          >
            Sign in
          </button>
        </div>
      </footer>

      <AuthDialog
        open={authOpen}
        mode={authMode}
        onOpenChange={setAuthOpen}
        onModeChange={setAuthMode}
      />
    </div>
  );
};

export default Landing;
