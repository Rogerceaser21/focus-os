import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TourStep {
  target: string;
  title: string;
  description: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const tourSteps: TourStep[] = [
  {
    target: '[data-task-tour-step="add-task-button"]',
    title: 'Add Task Button',
    description: 'This is your quick way to create new tasks! Click here to open the task creation form and start organizing your work.',
    position: 'bottom',
  },
  {
    target: '[data-task-tour-step="title"]',
    title: 'Task Title',
    description: 'Give your task a clear, descriptive title. This is the main identifier for your task and helps you quickly understand what needs to be done.',
    position: 'bottom',
  },
  {
    target: '[data-task-tour-step="description"]',
    title: 'Task Description',
    description: 'Add detailed notes, instructions, or context here. You can include as much information as you need to complete the task.',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="description"]',
    title: 'Clickable Links',
    description: 'Any URLs you add in the description become clickable hyperlinks! Perfect for adding reference materials, booking sites, or any web resources you need.',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="priority"]',
    title: 'Priority Level',
    description: 'Set the importance of your task. Choose from Low, Medium, High, or Urgent to help prioritize your workload effectively.',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="start-date"]',
    title: 'Start Date',
    description: 'When do you plan to begin working on this task? Setting a start date helps you plan your schedule and track when work should commence.',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="end-date"]',
    title: 'End Date',
    description: 'When should the task be completed? This helps you visualize the task duration in the Gantt view and manage your timeline.',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="due-date"]',
    title: 'Due Date',
    description: 'The deadline for your task! Tasks with a due date of today or earlier will appear in your "Today\'s To-Do" list.',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="images"]',
    title: 'Attach Images',
    description: 'Need to add visual references? You can paste images directly (Ctrl+V) or choose files from your device. Up to 8 images per task!',
    position: 'top',
  },
  {
    target: '[data-task-tour-step="save-button"]',
    title: 'Save Your Task',
    description: 'All done! Click "Save Changes" to update your task with all the details you\'ve added. Your task is now ready to be completed!',
    position: 'top',
  },
];

interface TaskTourProps {
  isOpen: boolean;
  onComplete: () => void;
}

export const TaskTour = ({ isOpen, onComplete }: TaskTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(0);
      return;
    }

    const updateTargetPosition = () => {
      const target = document.querySelector(tourSteps[currentStep].target);
      if (target) {
        setTargetRect(target.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    // Initial delay to let dialog render
    const timer = setTimeout(updateTargetPosition, 100);
    
    window.addEventListener('resize', updateTargetPosition);
    window.addEventListener('scroll', updateTargetPosition);

    // Also update on any DOM changes (for dialog content)
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
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    setCurrentStep(0);
    onComplete();
  };

  const handleSkip = () => {
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
    const tooltipHeight = 200;
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
    } else {
      top = targetRect.top - tooltipHeight - margin;
      if (top < margin) {
        top = targetRect.bottom + margin;
      }
    }

    return { left: `${left}px`, top: `${top}px` };
  };

  const tooltipPos = getTooltipPosition();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200]"
      >
        {/* Overlay with spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <mask id="task-spotlight-mask">
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
            mask="url(#task-spotlight-mask)"
          />
        </svg>

        {/* Spotlight border highlight */}
        {targetRect && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute pointer-events-none"
            style={{
              left: targetRect.left - padding,
              top: targetRect.top - padding,
              width: targetRect.width + padding * 2,
              height: targetRect.height + padding * 2,
              borderRadius: '8px',
              border: '2px solid hsl(var(--primary))',
              boxShadow: '0 0 20px hsl(var(--primary) / 0.5)',
            }}
          />
        )}

        {/* Tooltip card */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute z-[201] w-[90vw] max-w-[320px] bg-card border border-border rounded-xl shadow-2xl p-4"
          style={tooltipPos}
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
            Tasks Tour
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