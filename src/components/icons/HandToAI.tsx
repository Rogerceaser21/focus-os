import { cn } from '@/lib/utils';

interface HandToAIProps {
  variant?: 'full' | 'hand' | 'text';
  className?: string;
  /** Ignored — kept for API compatibility with prior icon component. */
  size?: number | string;
  /** Ignored — kept for API compatibility with prior icon component. */
  strokeWidth?: number;
}

/**
 * "Hand off to AI" glyph.
 * - variant="hand": line-drawn horizontal hand SVG (palm left, fingers right).
 *   Uses currentColor + Lucide-style stroke so it themes correctly.
 * - variant="text" | "full" (default): bold "A.I." text glyph.
 */
export const HandToAI = ({ variant = 'full', className, strokeWidth = 2 }: HandToAIProps) => {
  if (variant === 'hand') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('inline-block', className)}
        aria-label="Hand off to AI"
      >
        {/* Thumb (up-left) */}
        <path d="M6 12V7.5a1.5 1.5 0 0 1 3 0V12" />
        {/* Index finger (extending right) */}
        <path d="M9 11V6a1.5 1.5 0 0 1 3 0v6" />
        {/* Middle finger */}
        <path d="M12 12V7a1.5 1.5 0 0 1 3 0v5" />
        {/* Ring finger */}
        <path d="M15 12V8.5a1.5 1.5 0 0 1 3 0V14" />
        {/* Palm / wrist curve */}
        <path d="M18 13c0 4-2.5 7-6 7-2.2 0-4-1-5-2.5L4 14a1.5 1.5 0 0 1 2.5-1.6L8 14" />
      </svg>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center font-bold tracking-tight leading-none select-none',
        'text-[0.95rem]',
        className,
      )}
      aria-label="Hand off to AI"
    >
      A.I.
    </span>
  );
};

export default HandToAI;