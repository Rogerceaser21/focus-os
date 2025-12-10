import { HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface HelpButtonProps {
  onClick: () => void;
}

export const HelpButton = ({ onClick }: HelpButtonProps) => {
  return (
    <div className="fixed bottom-24 right-4 z-50 md:bottom-28">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={onClick}
            className="h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm border-border/50 shadow-lg hover:bg-background hover:border-primary/50 transition-all"
          >
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Take a tour</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
