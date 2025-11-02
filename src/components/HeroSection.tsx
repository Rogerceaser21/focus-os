import { useState, useEffect } from 'react';
import TrueFocus from './TrueFocus';
import { BrainDumpDialog } from './BrainDumpDialog';
import { useAuth } from '@/hooks/useAuth';

interface HeroSectionProps {
  onTasksCreated: () => void;
}

const HeroSection = ({ onTasksCreated }: HeroSectionProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phase, setPhase] = useState<'title' | 'cta'>('title');
  const [isVisible, setIsVisible] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    // Initial 5 second display of title
    const initialTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        setPhase('cta');
        setIsVisible(true);
      }, 300); // Fade transition duration
    }, 5000);

    return () => clearTimeout(initialTimer);
  }, []);

  const handleAnimationComplete = () => {
    // When TrueFocus animation completes, switch back to title
    setIsVisible(false);
    setTimeout(() => {
      setPhase('title');
      setIsVisible(true);
      
      // After 30 seconds on title, restart the cycle
      setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          setPhase('cta');
          setIsVisible(true);
        }, 300);
      }, 30000);
    }, 300);
  };

  return (
    <>
      <div 
        className="relative cursor-pointer hover:opacity-80 transition-opacity min-h-[80px]"
        onClick={() => user && setDialogOpen(true)}
      >
        {/* Text Overlay */}
        <div className={`absolute inset-0 flex flex-col gap-1 items-center justify-start transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          {phase === 'title' ? (
            <>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground drop-shadow-lg">Focus Manager</h1>
              <p className="text-xs sm:text-sm text-muted-foreground drop-shadow hidden sm:block">Plan your day, the magic way...</p>
            </>
          ) : (
            <>
              <div className="scale-75 sm:scale-90 lg:scale-100">
                <TrueFocus
                  sentence="Try Magic Plan"
                  manualMode={false}
                  blurAmount={8}
                  borderColor="#4FD1C5"
                  glowColor="rgba(79, 209, 197, 0.8)"
                  animationDuration={0.6}
                  pauseBetweenAnimations={1.5}
                  maxCycles={3}
                  onAnimationComplete={handleAnimationComplete}
                />
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground drop-shadow hidden sm:block">Click here to Start</p>
            </>
          )}
        </div>
      </div>

      {user && (
        <BrainDumpDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onTasksCreated={onTasksCreated}
          userId={user.id}
        />
      )}
    </>
  );
};

export default HeroSection;
