import { SVGProps } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'full' | 'hand' | 'text';

interface HandToAIProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  variant?: Variant;
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

/**
 * Custom "Hand pointing at AI" icon. Inherits color via currentColor,
 * matches Lucide's stroke-based aesthetic. Three variants:
 *  - "full": horizontal hand with index finger pointing right toward "AI" text
 *  - "hand": just the hand (compact)
 *  - "text": just stylized "AI" letters
 */
export const HandToAI = ({
  variant = 'full',
  size = 24,
  strokeWidth = 2,
  className,
  ...rest
}: HandToAIProps) => {
  // Each variant uses its own viewBox so the artwork fills the icon box.
  if (variant === 'hand') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('shrink-0', className)}
        aria-hidden="true"
        {...rest}
      >
        {/* Palm */}
        <path d="M3 13c0-1.5 1-2.5 2.2-2.5h2.3" />
        {/* Curled fingers (thumb + 3 folded) */}
        <path d="M7.5 8.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v3" />
        <path d="M10.5 9c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v3" />
        <path d="M13.5 10c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v2" />
        {/* Wrist / forearm */}
        <path d="M3 13v2.5c0 1.7 1.3 3 3 3h6c2.2 0 4-1.8 4-4v-2" />
        {/* Index finger pointing right */}
        <path d="M16.5 12h4.5" />
      </svg>
    );
  }

  if (variant === 'text') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('shrink-0', className)}
        aria-hidden="true"
        {...rest}
      >
        {/* A */}
        <path d="M5 19 L9 5 L13 19" />
        <path d="M6.5 14 L11.5 14" />
        {/* I */}
        <path d="M17 5 V19" />
      </svg>
    );
  }

  // "full": hand on the left pointing right at AI letters on the right.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={typeof size === 'number' ? size * 1.6 : size}
      height={size}
      viewBox="0 0 40 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      aria-hidden="true"
      {...rest}
    >
      {/* Hand (same artwork as 'hand' variant, in left half) */}
      <path d="M2 13c0-1.5 1-2.5 2.2-2.5h2.3" />
      <path d="M6.5 8.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v3" />
      <path d="M9.5 9c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v3" />
      <path d="M12.5 10c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v2" />
      <path d="M2 13v2.5c0 1.7 1.3 3 3 3h6c2.2 0 4-1.8 4-4v-2" />
      {/* Index finger pointing right toward AI */}
      <path d="M15.5 12h6" />
      {/* Arrowhead at fingertip */}
      <path d="M20 10.5 L21.5 12 L20 13.5" />
      {/* "A" */}
      <path d="M24 19 L27 5 L30 19" />
      <path d="M25 14.5 L29 14.5" />
      {/* "I" */}
      <path d="M34 5 V19" />
    </svg>
  );
};

export default HandToAI;