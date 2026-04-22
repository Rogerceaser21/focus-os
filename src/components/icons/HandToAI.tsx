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
 * "Hand off to AI" glyph. Pure text — renders "A.I." in a tight, bold pill.
 * Inherits color via currentColor (uses text/border tokens) so it themes correctly.
 * The `variant` prop is accepted but all variants render the same text glyph.
 */
export const HandToAI = ({ variant = 'full', className }: HandToAIProps) => {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center font-bold tracking-tight leading-none select-none',
        'text-[0.7rem]',
        className,
      )}
      aria-label="Hand off to AI"
    >
      A.I.
    </span>
  );
};

export default HandToAI;