import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Video, FolderOpen, Calendar, ListTodo, AlertTriangle, Home as HomeIcon, BookOpen } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import type { BrainDumpTask, ProjectInfo } from '@/hooks/useBrainDumpLive';
import DarkVeil from '@/components/DarkVeil';

const SUBTITLES = [
  "Ready to capture your thoughts?",
  "Ready to convert them into tasks or projects?",
  "Do you have a new project in mind?",
  "What's on your mind?",
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

const Home = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [firstName, setFirstName] = useState<string>('');
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  // Fetch profile & projects
  useEffect(() => {
    if (!user) return;

    (supabase as any)
      .from('focusos_profiles')
      .select('first_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.first_name) setFirstName(data.first_name);
      });

    (supabase as any)
      .from('focusos_projects')
      .select('id, name, color')
      .eq('user_id', user.id)
      .order('name')
      .then(({ data }: any) => {
        if (data) setProjects(data);
      });
  }, [user]);

  // Rotate subtitles
  useEffect(() => {
    const interval = setInterval(() => {
      setSubtitleIndex((prev) => (prev + 1) % SUBTITLES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTasksCreated = useCallback(() => {
    // Navigate to app after brain dump creates tasks
    navigate('/app');
  }, [navigate]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex flex-col bg-background">
      <DarkVeil
        hueShift={108}
        noiseIntensity={0}
        scanlineIntensity={0}
        speed={0.3}
        scanlineFrequency={0}
        warpAmount={0.4}
        resolutionScale={0.6}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col flex-1 px-4 pt-8 pb-4">
        {/* Greeting */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
            {getGreeting()}, {firstName || 'there'}
          </h1>
          <div className="h-8 mt-2 relative">
            <AnimatePresence mode="wait">
              <motion.p
                key={subtitleIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4 }}
                className="text-muted-foreground text-base sm:text-lg absolute inset-0 flex items-center justify-center"
              >
                {SUBTITLES[subtitleIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* Main action area with side buttons */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-4 sm:gap-8 w-full max-w-lg">
            {/* Left side buttons */}
            <div className="flex flex-col gap-4">
              <button
                onClick={() => navigate('/app?view=projects')}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/60 backdrop-blur-sm border border-border/50 hover:bg-card/80 hover:border-primary/30 transition-all min-w-[72px]"
              >
                <FolderOpen className="w-5 h-5 text-primary" />
                <span className="text-xs text-muted-foreground font-medium">Projects</span>
              </button>
              <button
                onClick={() => navigate('/meetings')}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/60 backdrop-blur-sm border border-border/50 hover:bg-card/80 hover:border-primary/30 transition-all min-w-[72px]"
              >
                <Calendar className="w-5 h-5 text-primary" />
                <span className="text-xs text-muted-foreground font-medium">Meetings</span>
              </button>
            </div>

            {/* Center - Brain Dump + Record Meeting */}
            <div className="flex-1 flex flex-col items-center gap-4">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setBrainDumpOpen(true)}
                className="w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-primary/20 border-2 border-primary/50 flex items-center justify-center hover:bg-primary/30 hover:border-primary transition-all shadow-lg shadow-primary/10"
              >
                <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-primary" />
              </motion.button>
              <span className="text-sm text-muted-foreground font-medium">Brain Dump</span>

              <button
                onClick={() => navigate('/meetings')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-card/60 backdrop-blur-sm border border-border/50 hover:bg-card/80 hover:border-primary/30 transition-all"
              >
                <Video className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground font-medium">Record Meeting</span>
              </button>
            </div>

            {/* Right side buttons */}
            <div className="flex flex-col gap-4">
              <button
                onClick={() => navigate('/app?view=today')}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/60 backdrop-blur-sm border border-border/50 hover:bg-card/80 hover:border-primary/30 transition-all min-w-[72px]"
              >
                <ListTodo className="w-5 h-5 text-primary" />
                <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Today's To-Do</span>
              </button>
              <button
                onClick={() => navigate('/app?view=past-due')}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/60 backdrop-blur-sm border border-border/50 hover:bg-card/80 hover:border-orange-400/30 transition-all min-w-[72px]"
              >
                <AlertTriangle className="w-5 h-5 text-orange-400" />
                <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Past Due</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom navigation */}
        <div className="flex items-center justify-center gap-12 pt-4 pb-2">
          <button
            className="flex flex-col items-center gap-1 text-primary"
          >
            <HomeIcon className="w-6 h-6" />
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            onClick={() => navigate('/app')}
            className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <BookOpen className="w-6 h-6" />
            <span className="text-xs font-medium">Journal</span>
          </button>
        </div>
      </div>

      {/* Brain Dump Dialog */}
      <BrainDumpLiveDialog
        open={brainDumpOpen}
        onOpenChange={setBrainDumpOpen}
        userId={user.id}
        projects={projects}
        onTasksCreated={handleTasksCreated}
      />
    </div>
  );
};

export default Home;
