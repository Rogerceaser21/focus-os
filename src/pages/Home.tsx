import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Video, HelpCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePrefetchAppData } from '@/hooks/usePrefetchAppData';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import BottomNav from '@/components/BottomNav';
import RecordFAB from '@/components/RecordFAB';
import { HomeTour } from '@/components/HomeTour';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { ProjectInfo } from '@/hooks/useBrainDumpLive';

const SUBTITLES = [
"Ready to capture your thoughts?",
"Ready to convert them into tasks or projects?",
"Do you have a new project in mind?",
"What's on your mind?"];


function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

const Home = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [firstName, setFirstName] = useState<string>('');
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const { preferences, markHomeTourComplete } = useUserPreferences(user?.id);

  // Silently prefetch all data for /app and /meetings while user is on Home screen
  usePrefetchAppData(user?.id);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);


  useEffect(() => {
    if (!user) return;
    (supabase as any).from('focusos_profiles').select('first_name').eq('user_id', user.id).maybeSingle().
    then(({ data }: any) => {if (data?.first_name) setFirstName(data.first_name);});
    (supabase as any).from('focusos_projects').select('id, name, color').eq('user_id', user.id).order('name').
    then(({ data }: any) => {if (data) setProjects(data);});
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => setSubtitleIndex((p) => (p + 1) % SUBTITLES.length), 4000);
    return () => clearInterval(interval);
  }, []);

  // Auto-launch the Home tour for first-time users, or when triggered via ?tour=home
  useEffect(() => {
    if (searchParams.get('tour') === 'home') {
      const t = setTimeout(() => setTourOpen(true), 400);
      const next = new URLSearchParams(searchParams);
      next.delete('tour');
      setSearchParams(next, { replace: true });
      return () => clearTimeout(t);
    }
    if (preferences && !preferences.has_completed_home_tour) {
      const t = setTimeout(() => setTourOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [preferences, searchParams, setSearchParams]);

  const handleTourComplete = useCallback(() => {
    setTourOpen(false);
    markHomeTourComplete();
  }, [markHomeTourComplete]);

  const handleTasksCreated = useCallback(() => navigate('/app'), [navigate]);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Redirecting...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* Main content — centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        {/* Greeting */}
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <div className="h-8 mt-3 relative">
            <AnimatePresence mode="wait">
              <motion.p
                key={subtitleIndex}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                className="text-base sm:text-lg absolute inset-0 flex items-center justify-center"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                
                {SUBTITLES[subtitleIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* Brain Dump Button */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <motion.button
            data-home-tour-step="brain-dump"
            whileTap={{ scale: 0.93 }}
            whileHover={{ scale: 1.03 }}
            onClick={() => setBrainDumpOpen(true)}
            className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full flex items-center justify-center border-[3px] border-border"
            style={{
              background: 'radial-gradient(circle at 40% 35%, hsl(var(--card)), hsl(var(--muted)))',
              boxShadow: '0 8px 32px hsl(var(--glass-shadow)), inset 0 2px 8px hsl(0 0% 100% / 0.4), inset 0 -2px 6px hsl(0 0% 0% / 0.06)'
            }}>
            
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full"
              style={{
                background: 'radial-gradient(circle at 40% 35%, #d94040, #a02020)',
                boxShadow: '0 2px 8px rgba(180, 40, 40, 0.4)'
              }} />
            
          </motion.button>
          <span className="text-sm font-medium text-center text-muted-foreground">
            Tap to capture your thoughts into tasks
          </span>
        </div>

        {/* Record Meeting — always centered */}
        <button
          data-home-tour-step="record-meeting"
          onClick={() => navigate('/meetings')}
          className="flex items-center gap-2 px-6 py-3 rounded-full transition-all border border-border/50 bg-secondary/50 text-muted-foreground hover:bg-secondary">
          
          <Video className="w-4 h-4" />
          <span className="text-sm font-medium">Record Meeting</span>
        </button>
      </div>

      {/* Help / replay tour button */}
      <button
        onClick={() => setTourOpen(true)}
        aria-label="Take the Home tour"
        className="fixed right-4 z-30 flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors shadow-md"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      <BottomNav projects={projects} />

      <RecordFAB compact />

      <HomeTour isOpen={tourOpen} onComplete={handleTourComplete} />

      <BrainDumpLiveDialog
        open={brainDumpOpen}
        onOpenChange={setBrainDumpOpen}
        userId={user.id}
        projects={projects}
        onTasksCreated={handleTasksCreated} />
      
    </div>);

};

export default Home;
