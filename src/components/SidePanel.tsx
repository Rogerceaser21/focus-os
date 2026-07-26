import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollHintArea } from '@/components/ScrollHintArea';

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Pinned below the scroll area — always visible. */
  footer?: React.ReactNode;
}

export const SidePanel = ({ open, onClose, title, children, className, footer }: SidePanelProps) => {
  if (!open) return null;

  return (
    <div className={cn(
      "h-full w-[420px] flex-shrink-0 border-l border-border/50 bg-card relative z-10 flex flex-col",
      className
    )} data-side-panel="true">
      <div className="flex items-center justify-between p-4 pb-2 flex-shrink-0">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollHintArea className={cn('px-4', footer ? 'pb-4' : 'pb-24')}>
        {children}
      </ScrollHintArea>
      {footer && <div className="flex-shrink-0 px-4 pb-4">{footer}</div>}
    </div>
  );
};
