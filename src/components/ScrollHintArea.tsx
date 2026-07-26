import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Scroll container that shows a bouncing chevron + soft fade at the bottom
 * while more content is below the fold, so users know they can scroll.
 * The hint disappears once they reach the bottom.
 */
export const ScrollHintArea = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [more, setMore] = React.useState(false);

  const check = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 12);
  }, []);

  React.useEffect(() => {
    check();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [check]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={ref} onScroll={check} className={cn('flex-1 min-h-0 overflow-y-auto', className)}>
        {children}
      </div>
      {more && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center h-10 bg-gradient-to-t from-background/60 to-transparent">
          <ChevronDown className="h-4 w-4 mb-1 text-muted-foreground animate-bounce" />
        </div>
      )}
    </div>
  );
};
