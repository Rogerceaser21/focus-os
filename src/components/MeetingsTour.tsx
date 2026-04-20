import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTourSpotlight, computeTooltipPosition, type TooltipPlacement } from '@/hooks/useTourSpotlight';

interface TourStep {
  target: string;
  title: string;
  description: string;
  position?: TooltipPlacement;
  /** Which page this step lives on */
  phase: 'list' | 'detail';
}

export const meetingsTourSteps: TourStep[] = [
  // ── Phase A: list page ─────────────────────────────────────────
  {
    phase: 'list',
    target: '[data-meetings-tour-step="page"]',
    title: 'Welcome to Meetings',
    description:
      "This is your Meetings tab — every meeting you record, plus AI-generated summaries and action items, lives here.",
    position: 'bottom',
  },
  {
    phase: 'list',
    target: '[data-meetings-tour-step="new-meeting"]',
    title: 'Record a New Meeting',
    description:
      "Tap the record button to start capturing a meeting live. Focus OS will transcribe it, generate a summary, and pull out action items automatically.",
    position: 'top',
  },
  {
    phase: 'list',
    target: '[data-meetings-tour-step="list"]',
    title: 'Your Meetings',
    description:
      "All your processed meetings appear here. Click any one to see its summary, transcript, and extracted tasks. Let's open a sample meeting now.",
    position: 'top',
  },
  // ── Phase B: detail page ───────────────────────────────────────
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="title"]',
    title: 'Title & Participants',
    description:
      "Each meeting shows its title, date, duration, and participants up top. Click the title to rename it anytime.",
    position: 'bottom',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="overview"]',
    title: 'AI Overview',
    description:
      "This is the AI-generated overview — a concise paragraph summarizing what happened in the meeting so you don't have to re-listen.",
    position: 'bottom',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="overview-edit"]',
    title: 'Edit the Overview',
    description:
      "Don't love the AI's wording? Tap Edit to manually tweak the overview. Tap Re-summarize to regenerate it from the transcript.",
    position: 'left',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="outline"]',
    title: 'Outline',
    description:
      "The outline breaks the meeting down into structured sections and bullet points — decisions, topics, and open questions.",
    position: 'top',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="outline-detail"]',
    title: 'Adjust Outline Detail',
    description:
      "Use − Detail and + Detail to make the outline more concise or more detailed. Focus OS will regenerate it at the new level.",
    position: 'left',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="action-items"]',
    title: 'Action Items',
    description:
      "Action items are auto-extracted as tasks linked to this meeting. Tap Re-extract to pull more from the transcript anytime.",
    position: 'top',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="share-email"]',
    title: 'Share Summary via Email',
    description:
      "Send the overview and outline as a one-way email to anyone — they don't need a Focus OS account. Great for FYI updates.",
    position: 'top',
  },
  {
    phase: 'detail',
    target: '[data-meetings-tour-step="share-meeting"]',
    title: 'Share the Full Meeting',
    description:
      "Share the entire meeting (with action items) with another Focus OS user. They can accept it into their own workspace and collaborate on the tasks.",
    position: 'top',
  },
];

interface MeetingsTourProps {
  isOpen: boolean;
  phase: 'list' | 'detail';
  onComplete: () => void;
  /** Called when the user advances past the last list step — parent should navigate to the demo detail page. */
  onAdvanceToDetail?: () => void;
}

const TOOLTIP_WIDTH = 320;
const SPOTLIGHT_PADDING = 8;

export const MeetingsTour = ({ isOpen, phase, onComplete, onAdvanceToDetail }: MeetingsTourProps) => {
  // Filter to current phase
  const phaseSteps = useMemo(() => meetingsTourSteps.filter(s => s.phase === phase), [phase]);
  const totalSteps = meetingsTourSteps.length;

  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(240);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isCompletingRef = useRef(false);

  const step = phaseSteps[currentStep];
  const targetRect = useTourSpotlight(isOpen ? step?.target ?? null : null, isOpen, 5000);

  // Reset step counter whenever phase or open state changes
  useEffect(() => {
    setCurrentStep(0);
    isCompletingRef.current = false;
  }, [phase, isOpen]);

  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const h = tooltipRef.current.getBoundingClientRect().height;
      if (h && Math.abs(h - tooltipHeight) > 4) setTooltipHeight(h);
    }
  });

  const preferredPlacement: TooltipPlacement = useMemo(() => step?.position ?? 'bottom', [step]);
  const tooltipPos = targetRect
    ? computeTooltipPosition(targetRect, TOOLTIP_WIDTH, tooltipHeight, preferredPlacement)
    : null;

  // Compute global step number across both phases for the dot indicator
  const globalStepIndex = useMemo(() => {
    if (!step) return 0;
    return meetingsTourSteps.findIndex(s => s.target === step.target && s.phase === step.phase);
  }, [step]);

  const handleNext = () => {
    if (isCompletingRef.current) return;
    if (currentStep < phaseSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else if (phase === 'list' && onAdvanceToDetail) {
      // Hand off to the detail page
      isCompletingRef.current = true;
      onAdvanceToDetail();
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (isCompletingRef.current) return;
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleComplete = () => {
    if (isCompletingRef.current) return;
    isCompletingRef.current = true;
    setCurrentStep(0);
    onComplete();
  };

  if (!isOpen || !step) return null;

  const tourContent = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0"
        style={{ zIndex: 99999, pointerEvents: 'none' }}
      >
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="meetings-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - SPOTLIGHT_PADDING}
                  y={targetRect.top - SPOTLIGHT_PADDING}
                  width={targetRect.width + SPOTLIGHT_PADDING * 2}
                  height={targetRect.height + SPOTLIGHT_PADDING * 2}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.7)"
            mask="url(#meetings-spotlight-mask)"
          />
        </svg>

        {targetRect && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute pointer-events-none"
            style={{
              left: targetRect.left - SPOTLIGHT_PADDING,
              top: targetRect.top - SPOTLIGHT_PADDING,
              width: targetRect.width + SPOTLIGHT_PADDING * 2,
              height: targetRect.height + SPOTLIGHT_PADDING * 2,
              borderRadius: '8px',
              border: '2px solid hsl(var(--primary))',
              boxShadow: '0 0 24px hsl(var(--primary) / 0.55)',
            }}
          />
        )}

        <motion.div
          ref={tooltipRef}
          key={`${phase}-${currentStep}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute bg-card border border-border rounded-xl shadow-2xl p-4"
          style={{
            width: `${TOOLTIP_WIDTH}px`,
            maxWidth: 'calc(100vw - 32px)',
            left: tooltipPos ? `${tooltipPos.left}px` : '50%',
            top: tooltipPos ? `${tooltipPos.top}px` : '50%',
            transform: tooltipPos ? undefined : 'translate(-50%, -50%)',
            zIndex: 100000,
            pointerEvents: 'auto',
          }}
        >
          <button
            onClick={handleComplete}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="Skip tour"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="flex gap-1.5 mb-3 flex-wrap pr-6">
            {meetingsTourSteps.map((_, index) => (
              <div
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === globalStepIndex
                    ? 'w-6 bg-primary'
                    : index < globalStepIndex
                    ? 'w-1.5 bg-primary/50'
                    : 'w-1.5 bg-muted'
                }`}
              />
            ))}
          </div>

          <div className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Meetings Tour
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{step.description}</p>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrev}
              disabled={currentStep === 0}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>

            <span className="text-xs text-muted-foreground">
              {globalStepIndex + 1} of {totalSteps}
            </span>

            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="gap-1"
            >
              {globalStepIndex === totalSteps - 1 ? 'Done' : 'Next'}
              {globalStepIndex < totalSteps - 1 && <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(tourContent, document.body);
};
