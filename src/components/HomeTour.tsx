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
}

const tourSteps: TourStep[] = [
  {
    target: '[data-home-tour-step="brain-dump"]',
    title: 'Brain Dump',
    description:
      "Tap this big red button and just talk. Speak your thoughts, ideas, or to-dos out loud — AI will instantly turn them into clear, organized tasks and drop them into the right project for you.",
    position: 'bottom',
  },
  {
    target: '[data-home-tour-step="record-meeting"]',
    title: 'Record Meeting',
    description:
      "Recording a real meeting? Tap here to capture the audio. Focus OS will transcribe it, generate a summary, and pull out action items as tasks — automatically.",
    position: 'top',
  },
  {
    target: '[data-home-tour-step="settings"]',
    title: 'Settings',
    description:
      "Customize your experience here: theme, default view, task density, notifications, and timer alerts. Make Focus OS feel like yours.",
    position: 'top',
  },
  {
    target: '[data-home-tour-step="today"]',
    title: 'Today',
    description:
      "Your daily focus list. Shows everything due today — nothing more, nothing less. The fastest way to know what to work on right now.",
    position: 'top',
  },
  {
    target: '[data-home-tour-step="past-due"]',
    title: 'Past Due',
    description:
      "Anything you've missed. Tasks with a due date in the past land here so they don't clutter Today but never get lost. Catch up or reschedule from one place.",
    position: 'top',
  },
  {
    target: '[data-home-tour-step="projects"]',
    title: 'Projects',
    description:
      "Open the project sidebar. Group related tasks together, assign colors, share with collaborators, and switch between projects in a tap.",
    position: 'top',
  },
  {
    target: '[data-home-tour-step="meetings"]',
    title: 'Meetings',
    description:
      "All your recorded meetings — transcripts, summaries, and the tasks extracted from each one. Revisit, share, or convert action items into work.",
    position: 'top',
  },
  {
    target: '[data-home-tour-step="logout"]',
    title: 'Log Out',
    description:
      "Sign out of your account when you're done. Your data stays safe in the cloud and will be right here when you log back in.",
    position: 'top',
  },
  {
    target: '[data-tour-step="menu-fab"]',
    title: 'Quick Return Home',
    description:
      "See this red record button? It follows you everywhere. From any screen — Projects, Today, Meetings — just double-tap it to jump straight back here.",
    position: 'top',
  },
];

interface HomeTourProps {
  isOpen: boolean;
  onComplete: () => void;
}

const TOOLTIP_WIDTH = 320;
const SPOTLIGHT_PADDING = 8;

export const HomeTour = ({ isOpen, onComplete }: HomeTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(240);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isCompletingRef = useRef(false);

  const step = tourSteps[currentStep];
  const targetRect = useTourSpotlight(isOpen ? step?.target ?? null : null, isOpen, 5000);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      isCompletingRef.current = false;
    }
  }, [isOpen]);

  const firedReadyRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      firedReadyRef.current = false;
      return;
    }
    if (targetRect && tooltipRef.current && !firedReadyRef.current) {
      firedReadyRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('focusos:tour-ready', { detail: { tour: 'home' } }));
        });
      });
    }
  }, [isOpen, targetRect]);

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

  const handleNext = () => {
    if (isCompletingRef.current) return;
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
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
            <mask id="home-spotlight-mask">
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
            mask="url(#home-spotlight-mask)"
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
          key={currentStep}
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
            {tourSteps.map((_, index) => (
              <div
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === currentStep
                    ? 'w-6 bg-primary'
                    : index < currentStep
                    ? 'w-1.5 bg-primary/50'
                    : 'w-1.5 bg-muted'
                }`}
              />
            ))}
          </div>

          <div className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Home Screen Tour
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
              {currentStep + 1} of {tourSteps.length}
            </span>

            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="gap-1"
            >
              {currentStep === tourSteps.length - 1 ? 'Done' : 'Next'}
              {currentStep < tourSteps.length - 1 && <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(tourContent, document.body);
};
