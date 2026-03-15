import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SidePanel = ({ open, onClose, title, children, className }: SidePanelProps) => {
  if (!open) return null;

  return (
    <div className={cn(
      "fixed top-0 right-0 h-full w-[420px] z-40 border-l border-border/50 bg-card/98 backdrop-blur-sm overflow-y-auto shadow-xl animate-in slide-in-from-right duration-300",
      className
    )}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
};
