import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { taskTourSteps, type TaskTourStep } from './tour/taskTourSteps';
import { useTourSpotlight, computeTooltipPosition, type TooltipPlacement } from '@/hooks/useTourSpotlight';

interface TaskTourProps {
  isOpen: boolean;
  onComplete: () => void;
  /** Called when the active step index changes — used by Index.tsx to open the Edit dialog */
  onStepChange?: (step: number) => void;
}

const TOOLTIP_WIDTH = 320;
const SPOTLIGHT_PADDING = 8;

export const TaskTour = ({ isOpen, onComplete, onStepChange }: TaskTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(220);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Filter out optional steps whose targets don't exist (e.g. project step when no projects)
  const steps = useMemo<TaskTourStep[]>(() => {
    if (!isOpen) return taskTourSteps;
    return taskTourSteps.filter((s) => {
      if (!s.optional) return true;
      return !!document.querySelector(s.target);
    });
  }, [isOpen, currentStep]);

  const step = steps[currentStep];
  const targetRect = useTourSpotlight(isOpen ? step?.target ?? null : null, isOpen);

  // Reset on close
  useEffect(() => {
    if (!isOpen) setCurrentStep(0);
  }, [isOpen]);

  // Notify listeners (e.g. the loading overlay in ProjectSidebar) ONLY after BOTH
  // the spotlight target and the tooltip card have actually painted. We use a
  // double rAF to guarantee the browser has completed a paint frame before firing.
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
          window.dispatchEvent(new CustomEvent('focusos:tour-ready', { detail: { tour: 'tasks' } }));
        });
      });
    }
  }, [isOpen, targetRect]);

  // Measure tooltip after render so positioning math is accurate
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const h = tooltipRef.current.getBoundingClientRect().height;
      if (h && Math.abs(h - tooltipHeight) > 4) setTooltipHeight(h);
    }
  });

  // Decide preferred tooltip placement
  const preferredPlacement: TooltipPlacement = useMemo(() => {
    if (!targetRect) return 'bottom';
    const isDesktop = window.innerWidth >= 1024;
    const docked = document.querySelector('[data-side-panel="task"], [data-side-panel="edit-task"]');
    // On desktop with a docked side panel, prefer LEFT (panel sits on the right edge)
    if (isDesktop && docked && currentStep > 0) return 'left';
    // The Add Task button (step 0) lives in the top toolbar — prefer below it
    if (currentStep === 0) return 'bottom';
    // Mobile / tablet — bottom by default, the helper will flip if needed
    return 'bottom';
  }, [targetRect, currentStep]);

  const tooltipPos = targetRect
    ? computeTooltipPosition(targetRect, TOOLTIP_WIDTH, tooltipHeight, preferredPlacement)
    : null;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      onStepChange?.(next);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
      onStepChange?.(prev);
    }
  };

  const handleComplete = () => {
    setCurrentStep(0);
    onComplete();
  };

  if (!isOpen || !step) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 99999 }}
      >
        {/* Spotlight overlay */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="task-spotlight-mask">
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
            mask="url(#task-spotlight-mask)"
          />
        </svg>

        {/* Spotlight border */}
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

        {/* Tooltip card */}
        <motion.div
          ref={tooltipRef}
          key={currentStep}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute bg-card border border-border rounded-xl shadow-2xl p-4 pointer-events-auto"
          style={{
            width: `${TOOLTIP_WIDTH}px`,
            maxWidth: 'calc(100vw - 32px)',
            left: tooltipPos ? `${tooltipPos.left}px` : '50%',
            top: tooltipPos ? `${tooltipPos.top}px` : '50%',
            transform: tooltipPos ? undefined : 'translate(-50%, -50%)',
            zIndex: 100000,
          }}
        >
          {/* Skip */}
          <button
            onClick={handleComplete}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="Skip tour"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Step indicator */}
          <div className="flex gap-1.5 mb-3 flex-wrap pr-6">
            {steps.map((_, index) => (
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
            Tasks Tour
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            {step.description}
          </p>

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
              {currentStep + 1} of {steps.length}
            </span>

            <Button size="sm" onClick={handleNext} className="gap-1">
              {currentStep === steps.length - 1 ? 'Done' : 'Next'}
              {currentStep < steps.length - 1 && <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
