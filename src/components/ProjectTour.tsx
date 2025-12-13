import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TourStep {
  target: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  action?: 'click-project' | 'show-rename' | 'show-delete' | 'show-move-task';
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
    position: 'right',
    action: 'click-project',
  },
  {
    target: '[data-projects-tour-step="project-name"]',
    title: 'Rename Your Project',
    description: 'Click on the project name to edit it. You can rename your project anytime to better reflect its purpose.',
    position: 'bottom',
    action: 'show-rename',
  },
  {
    target: '[data-projects-tour-step="delete-button"]',
    title: 'Delete Project',
    description: 'When you no longer need a project, you can delete it using this button. Be careful - this will also delete all tasks within the project!',
    position: 'left',
    action: 'show-delete',
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

export const ProjectTour = ({ isOpen, onComplete, onStepChange }: ProjectTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const isCompletingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      return;
    }
    
    // Reset completion guard when tour opens
    isCompletingRef.current = false;

    const updateTargetPosition = () => {
      const target = document.querySelector(tourSteps[currentStep].target);
      if (target) {
        // On mobile, scroll the target into view if needed (especially for color picker in dialog)
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          // Wait a bit for scroll to complete before getting position
          setTimeout(() => {
            setTargetRect(target.getBoundingClientRect());
          }, 150);
        } else {
          setTargetRect(target.getBoundingClientRect());
        }
      } else {
        setTargetRect(null);
      }
    };

    // Initial delay to let UI render (longer on mobile for scroll)
    const isMobile = window.innerWidth < 768;
    const timer = setTimeout(updateTargetPosition, isMobile ? 200 : 100);
    
    window.addEventListener('resize', updateTargetPosition);
    window.addEventListener('scroll', updateTargetPosition);

    // Also update on any DOM changes
    const observer = new MutationObserver(updateTargetPosition);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateTargetPosition);
      window.removeEventListener('scroll', updateTargetPosition);
      observer.disconnect();
    };
  }, [isOpen, currentStep]);

  const handleNext = () => {
    if (isCompletingRef.current) return;
    console.log('[ProjectTour] handleNext called, currentStep:', currentStep);
    if (currentStep < tourSteps.length - 1) {
      const nextStep = currentStep + 1;
      console.log('[ProjectTour] Moving to step:', nextStep);
      setCurrentStep(nextStep);
      onStepChange?.(nextStep, tourSteps[nextStep].action);
    } else {
      console.log('[ProjectTour] Completing tour');
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

  if (!isOpen) return null;

  const step = tourSteps[currentStep];
  const padding = 8;

  // Calculate tooltip position based on step preference
  const getTooltipPosition = () => {
    if (!targetRect) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

    const tooltipWidth = 320;
    const tooltipHeight = 240;
    const margin = 16;

    let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    let top: number;

    // Clamp left position to viewport
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));

    if (step.position === 'bottom' || step.position === undefined) {
      top = targetRect.bottom + margin;
      if (top + tooltipHeight > window.innerHeight - margin) {
        top = targetRect.top - tooltipHeight - margin;
      }
    } else if (step.position === 'top') {
      top = targetRect.top - tooltipHeight - margin;
      if (top < margin) {
        top = targetRect.bottom + margin;
      }
    } else if (step.position === 'right') {
      left = targetRect.right + margin;
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      if (left + tooltipWidth > window.innerWidth - margin) {
        left = targetRect.left - tooltipWidth - margin;
      }
    } else if (step.position === 'left') {
      left = targetRect.left - tooltipWidth - margin;
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
      if (left < margin) {
        left = targetRect.right + margin;
      }
    } else {
      top = targetRect.bottom + margin;
    }

    // Clamp top position to viewport
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));

    return { left: `${left}px`, top: `${top}px` };
  };

  const tooltipPos = getTooltipPosition();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 99999 }}
      >
        {/* Overlay with spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="projects-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - padding}
                  y={targetRect.top - padding}
                  width={targetRect.width + padding * 2}
                  height={targetRect.height + padding * 2}
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
            fill="rgba(0, 0, 0, 0.75)"
            mask="url(#projects-spotlight-mask)"
          />
        </svg>

        {/* Spotlight border highlight */}
        {targetRect && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute"
            style={{
              left: targetRect.left - padding,
              top: targetRect.top - padding,
              width: targetRect.width + padding * 2,
              height: targetRect.height + padding * 2,
              borderRadius: '8px',
              border: '2px solid hsl(var(--primary))',
              boxShadow: '0 0 20px hsl(var(--primary) / 0.5)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Tooltip card */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute w-[90vw] max-w-[320px] bg-card border border-border rounded-xl shadow-2xl p-4 pointer-events-auto"
          style={{ ...tooltipPos, zIndex: 100000 }}
        >
          {/* Skip button */}
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Step indicator */}
          <div className="flex gap-1.5 mb-3 flex-wrap">
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

          {/* Tour Title */}
          <div className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Projects Tour
          </div>

          {/* Content */}
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {step.title}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            {step.description}
          </p>

          {/* Navigation */}
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
              onClick={handleNext}
              className="gap-1"
            >
              {currentStep === tourSteps.length - 1 ? 'Done' : 'Next'}
              {currentStep < tourSteps.length - 1 && (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
