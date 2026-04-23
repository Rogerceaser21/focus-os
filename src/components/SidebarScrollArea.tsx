import { useEffect, useRef, useState, useCallback, ReactNode, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface SidebarScrollAreaProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const MIN_THUMB_HEIGHT = 28;

export const SidebarScrollArea = ({ children, className, style }: SidebarScrollAreaProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbHeight, setThumbHeight] = useState(MIN_THUMB_HEIGHT);
  const [thumbTop, setThumbTop] = useState(0);
  const [needsScroll, setNeedsScroll] = useState(false);
  const dragState = useRef<{ startY: number; startScrollTop: number } | null>(null);

  const recalc = useCallback(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const trackHeight = track.clientHeight;
    if (scrollHeight <= clientHeight) {
      setNeedsScroll(false);
      return;
    }
    setNeedsScroll(true);
    const ratio = clientHeight / scrollHeight;
    const rawThumb = Math.max(MIN_THUMB_HEIGHT, trackHeight * ratio);
    const maxScroll = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - rawThumb;
    const top = maxScroll > 0 ? (scrollTop / maxScroll) * maxThumbTop : 0;
    setThumbHeight(rawThumb);
    setThumbTop(top);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recalc();
    const onScroll = () => recalc();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => recalc());
    ro.observe(el);
    // Observe content for size changes
    Array.from(el.children).forEach((c) => ro.observe(c as Element));
    const mo = new MutationObserver(() => {
      recalc();
      Array.from(el.children).forEach((c) => ro.observe(c as Element));
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [recalc]);

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    dragState.current = { startY: e.clientY, startScrollTop: el.scrollTop };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragState.current || !scrollRef.current || !trackRef.current) return;
      const dy = ev.clientY - dragState.current.startY;
      const { scrollHeight, clientHeight } = scrollRef.current;
      const trackHeight = trackRef.current.clientHeight;
      const maxScroll = scrollHeight - clientHeight;
      const maxThumbTop = trackHeight - thumbHeight;
      if (maxThumbTop <= 0) return;
      const newScroll = dragState.current.startScrollTop + (dy / maxThumbTop) * maxScroll;
      scrollRef.current.scrollTop = Math.max(0, Math.min(maxScroll, newScroll));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const trackHeight = track.clientHeight;
    const maxThumbTop = trackHeight - thumbHeight;
    const targetThumbTop = Math.max(0, Math.min(maxThumbTop, clickY - thumbHeight / 2));
    const maxScroll = el.scrollHeight - el.clientHeight;
    el.scrollTop = maxThumbTop > 0 ? (targetThumbTop / maxThumbTop) * maxScroll : 0;
  };

  return (
    <div className={cn('relative flex-1 min-h-0 flex', className)}>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-scroll scrollbar-hide pr-[14px]"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          ...style,
        }}
      >
        {children}
      </div>
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className={cn(
          'absolute right-1 top-1 bottom-1 w-[8px] rounded-full bg-foreground/10 transition-opacity',
          needsScroll ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div
          onPointerDown={onThumbPointerDown}
          className="absolute left-0 right-0 rounded-full bg-foreground/40 hover:bg-foreground/60 active:bg-foreground/70 cursor-pointer transition-colors"
          style={{ height: `${thumbHeight}px`, top: `${thumbTop}px` }}
        />
      </div>
    </div>
  );
};
