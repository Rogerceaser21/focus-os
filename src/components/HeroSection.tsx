import { useState } from 'react';
import TrueFocus from './TrueFocus';
import { BrainDumpDialog } from './BrainDumpDialog';
import { useAuth } from '@/hooks/useAuth';

interface HeroSectionProps {
  onTasksCreated: () => void;
}

const HeroSection = ({ onTasksCreated }: HeroSectionProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { user } = useAuth();

  return (
    <>
      <div 
        className="relative w-full h-[180px] overflow-hidden z-[5] cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => user && setDialogOpen(true)}
      >
        {/* Text Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <TrueFocus
            sentence="Try Magic Plan"
            manualMode={false}
            blurAmount={8}
            borderColor="#4FD1C5"
            glowColor="rgba(79, 209, 197, 0.8)"
            animationDuration={0.6}
            pauseBetweenAnimations={1.5}
            maxCycles={3}
          />
          <p className="text-sm text-muted-foreground">Click here to Start</p>
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
