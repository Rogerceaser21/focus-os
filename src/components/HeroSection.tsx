import { useState } from 'react';
import CircularText from './CircularText';
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
        className="relative w-full h-[133px] overflow-hidden z-[5] cursor-pointer hover:opacity-90 transition-opacity flex items-center justify-center"
        onClick={() => user && setDialogOpen(true)}
      >
        <CircularText 
          text=" Try Mag|c Plan | Click |"
          spinDuration={11}
          onHover="speedUp"
        />
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
