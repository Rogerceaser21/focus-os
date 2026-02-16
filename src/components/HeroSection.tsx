import { useState, useEffect } from 'react';
import TrueFocus from './TrueFocus';
import { useAuth } from '@/hooks/useAuth';

interface HeroSectionProps {
  onTasksCreated: () => void;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

const HeroSection = ({ onTasksCreated, dialogOpen, setDialogOpen }: HeroSectionProps) => {
  const [phase, setPhase] = useState<'title' | 'cta'>('title');
  const [isVisible, setIsVisible] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        setPhase('cta');
        setIsVisible(true);
      }, 300);
    }, 5000);

    return () => clearTimeout(initialTimer);
  }, []);

  const handleAnimationComplete = () => {
    setIsVisible(false);
    setTimeout(() => {
      setPhase('title');
      setIsVisible(true);
      
      setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          setPhase('cta');
          setIsVisible(true);
        }, 300);
      }, 54000);
    }, 300);
  };

  return (
    <div 
      className="relative min-h-[80px] cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => user && setDialogOpen(true)}
    >
      <div className={`absolute top-0 left-12 sm:left-0 flex flex-col gap-1 items-start transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        {phase === 'title' ? (
          <>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground drop-shadow-lg whitespace-nowrap">Focus OS</h1>
            <p className="text-xs sm:text-sm text-muted-foreground drop-shadow whitespace-nowrap">Plan your day, the magic way...</p>
          </>
        ) : (
          <>
            <TrueFocus
              sentence="Try the Mic"
              manualMode={false}
              blurAmount={8}
              borderColor="#4FD1C5"
              glowColor="rgba(79, 209, 197, 0.8)"
              animationDuration={0.6}
              pauseBetweenAnimations={1.5}
              maxCycles={1}
              onAnimationComplete={handleAnimationComplete}
            />
            <p className="text-xs sm:text-sm text-muted-foreground drop-shadow whitespace-nowrap">Click here to Start</p>
          </>
        )}
      </div>
    </div>
  );
};

export default HeroSection;
