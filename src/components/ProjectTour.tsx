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
  action?: 'click-project' | 'show-move-task';
}

const tourSteps: TourStep[] = [
  {
    target: '[data-projects-tour-step="new-project-button"]',
    title: 'Create New Project',
    description: 'Click this button to create a new project. Projects help you organize related tasks together, like "Work", "Personal", or specific goals.',
    position: 'bottom',
  },
  {
    target: '[data-projects-tour-step="color-picker"]',
    title: 'Choose Project Color',
    description: 'Each project can have its own color! This helps you quickly identify tasks by project when viewing your lists. Click on any color to select it.',
    position: 'bottom',
  },
  {
    target: '[data-projects-tour-step="demo-project"]',
    title: 'Select a Project',
    description: 'Click on a project to open it and view all its tasks. Let\'s click on this demo project to see what\'s inside.',
    position: 'bottom',
    action: 'click-project',
  },
  {
    target: '[data-projects-tour-step="project-name"]',
    title: 'Rename Your Project',
    description: 'Click on the project name to edit it. You can rename your project anytime to better reflect its purpose.',
    position: 'bottom',
  },
  {
    target: '[data-projects-tour-step="delete-button"]',
    title: 'Delete Project',
    description: 'When you no longer need a project, you can delete it using this button. Be careful - this will also delete all tasks within the project!',
    position: 'bottom',
  },
  {
    target: '[data-projects-tour-step="task-project-selector"]',
    title: 'Move Tasks Between Projects',
    description: 'You can move any task to a different project using this dropdown. This makes it easy to reorganize your work as priorities change.',
    position: 'top',
    action: 'show-move-task',
  },
];

interface ProjectTourProps {
  isOpen: boolean;
  onComplete: () => void;
  onStepChange?: (step: number, action?: string) => void;
}

const TOOLTIP_WIDTH = 320;
const SPOTLIGHT_PADDING = 8;

export const ProjectTour = ({ isOpen, onComplete, onStepChange }: ProjectTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipHeight, setTooltipHeight] = useState(240);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isCompletingRef = useRef(false);

  const step = tourSteps[currentStep];
  const targetRect = useTourSpotlight(isOpen ? step?.target ?? null : null, isOpen, 10000);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      isCompletingRef.current = false;
    }
  }, [isOpen]);

  // Dispatch tour-ready ONLY after both spotlight target AND tooltip have painted.
  // This is what the loading overlay listens for to dismiss itself.
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
          window.dispatchEvent(new CustomEvent('focusos:tour-ready', { detail: { tour: 'projects' } }));
        });
      });
    }
  }, [isOpen, targetRect]);

  // Measure tooltip after render so positioning is accurate
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      const h = tooltipRef.current.getBoundingClientRect().height;
      if (h && Math.abs(h - tooltipHeight) > 4) setTooltipHeight(h);
    }
  });

  const preferredPlacement: TooltipPlacement = useMemo(() => {
    return step?.position ?? 'bottom';
  }, [step]);

  const tooltipPos = targetRect
    ? computeTooltipPosition(targetRect, TOOLTIP_WIDTH, tooltipHeight, preferredPlacement)
    : null;

  const handleNext = async () => {
    if (isCompletingRef.current) return;

    if (currentStep < tourSteps.length - 1) {
      const nextStep = currentStep + 1;
      const nextStepData = tourSteps[nextStep];

      // If NEXT step has an action, trigger it BEFORE advancing so UI is ready
      if (nextStepData.action) {
        onStepChange?.(nextStep, nextStepData.action);
        const delay = nextStepData.action === 'click-project' ? 1000 :
                      nextStepData.action === 'show-move-task' ? 1500 : 500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      setCurrentStep(nextStep);
      await new Promise(resolve => setTimeout(resolve, 100));
      onStepChange?.(nextStep);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (isCompletingRef.current) return;
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      onStepChange?.(prevStep, tourSteps[prevStep].action);
    }
  };

  const handleComplete = () => {
    if (isCompletingRef.current) return;
    isCompletingRef.current = true;
    setCurrentStep(0);
    onComplete();
  };

  const handleSkip = () => {
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
        {/* Spotlight overlay */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="projects-spotlight-mask">
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
            mask="url(#projects-spotlight-mask)"
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
          {/* Skip */}
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="Skip tour"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Step indicator */}
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
            Projects Tour
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
