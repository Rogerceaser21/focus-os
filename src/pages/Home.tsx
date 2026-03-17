import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Calendar, ListTodo, AlertTriangle, Home as HomeIcon, BookOpen, Video } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import type { ProjectInfo } from '@/hooks/useBrainDumpLive';

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

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (supabase as any).from('focusos_profiles').select('first_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }: any) => { if (data?.first_name) setFirstName(data.first_name); });
    (supabase as any).from('focusos_projects').select('id, name, color').eq('user_id', user.id).order('name')
      .then(({ data }: any) => { if (data) setProjects(data); });
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => setSubtitleIndex((p) => (p + 1) % SUBTITLES.length), 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTasksCreated = useCallback(() => navigate('/app'), [navigate]);

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f0e8' }}>
      <div className="animate-pulse" style={{ color: '#8a8070' }}>Loading...</div>
    </div>;
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(180deg, #ede7db 0%, #f5f0e8 40%, #faf7f2 100%)' }}>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        {/* Greeting */}
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" style={{ color: '#2c2418' }}>
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
                style={{ color: '#8a8070' }}
              >
                {SUBTITLES[subtitleIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* Brain Dump Button */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <motion.button
            whileTap={{ scale: 0.93 }}
            whileHover={{ scale: 1.03 }}
            onClick={() => setBrainDumpOpen(true)}
            className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full flex items-center justify-center"
            style={{
              background: 'radial-gradient(circle at 40% 35%, #faf7f2, #e8e0d0)',
              boxShadow: '0 8px 32px rgba(120, 100, 70, 0.2), inset 0 2px 8px rgba(255,255,255,0.6), inset 0 -2px 6px rgba(0,0,0,0.06)',
              border: '3px solid #c9bfa8',
            }}
          >
            {/* Red dot */}
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full"
              style={{
                background: 'radial-gradient(circle at 40% 35%, #d94040, #a02020)',
                boxShadow: '0 2px 8px rgba(180, 40, 40, 0.4)',
              }}
            />
          </motion.button>
          <span className="text-sm font-medium" style={{ color: '#8a8070' }}>Tap to record</span>
        </div>

        {/* Navigation grid */}
        <div className="flex items-center gap-4 sm:gap-6 w-full max-w-sm justify-center mb-6">
          {/* Left buttons */}
          <div className="flex flex-col gap-3">
            <NavButton icon={<FolderOpen className="w-5 h-5" />} label="Projects" onClick={() => navigate('/app?view=projects')} />
            <NavButton icon={<Calendar className="w-5 h-5" />} label="Meetings" onClick={() => navigate('/meetings')} />
          </div>

          {/* Record Meeting center button */}
          <button
            onClick={() => navigate('/meetings')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full transition-all"
            style={{
              background: 'rgba(201, 191, 168, 0.25)',
              border: '1px solid rgba(201, 191, 168, 0.5)',
              color: '#6b5e4d',
            }}
          >
            <Video className="w-4 h-4" />
            <span className="text-sm font-medium">Record Meeting</span>
          </button>

          {/* Right buttons */}
          <div className="flex flex-col gap-3">
            <NavButton icon={<ListTodo className="w-5 h-5" />} label="Today's To-Do" onClick={() => navigate('/app?view=today')} />
            <NavButton icon={<AlertTriangle className="w-5 h-5" style={{ color: '#c07030' }} />} label="Past Due" onClick={() => navigate('/app?view=past-due')} accent />
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-center gap-16 py-3 z-20"
        style={{ background: 'rgba(30, 25, 18, 0.95)', borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button className="flex flex-col items-center gap-0.5" style={{ color: '#5ec4d4' }}>
          <HomeIcon className="w-6 h-6" />
          <span className="text-[11px] font-medium">Home</span>
        </button>
        <button
          onClick={() => navigate('/app')}
          className="flex flex-col items-center gap-0.5 transition-colors"
          style={{ color: '#7a7a7a' }}
        >
          <BookOpen className="w-6 h-6" />
          <span className="text-[11px] font-medium">Journal</span>
        </button>
      </div>

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

/* Small nav button used on sides */
const NavButton = ({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean }) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl transition-all min-w-[76px]"
    style={{
      background: 'rgba(255,255,255,0.55)',
      border: '1px solid rgba(201, 191, 168, 0.4)',
      color: accent ? '#c07030' : '#6b5e4d',
    }}
  >
    {icon}
    <span className="text-[11px] font-medium whitespace-nowrap">{label}</span>
  </button>
);

export default Home;
