import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TourStep {
  target: string;
  title: string;
  description: string;
}

export type TourType = 'menu-magic' | 'projects';

const tourStepsMap: Record<TourType, { name: string; steps: TourStep[] }> = {
  'menu-magic': {
    name: 'Menu Magic Buttons Tour',
    steps: [
      {
        target: '[data-tour-step="projects"]',
        title: 'Create Projects',
        description: 'Use the Blue microphone to create a new Project with tasks. Projects help you organize related tasks together.',
      },
      {
        target: '[data-tour-step="tasks"]',
        title: 'Add Tasks to Projects',
        description: 'Use the Green microphone to add Tasks to your selected Project. Make sure you have a project selected first!',
      },
      {
        target: '[data-tour-step="today"]',
        title: 'Quick Today Tasks',
        description: 'Use the Purple microphone to quickly add tasks to Today\'s to-do list. Perfect for capturing immediate tasks.',
      },
    ],
  },
  'projects': {
    name: 'Projects Tour',
    steps: [],
  },
};

interface OnboardingTourProps {
  isOpen: boolean;
  onComplete: () => void;
  tourType?: TourType;
}

export const OnboardingTour = ({ isOpen, onComplete, tourType = 'menu-magic' }: OnboardingTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const tourData = tourStepsMap[tourType];
  const tourSteps = tourData.steps;

  useEffect(() => {
    // Reset step when tour type changes
    setCurrentStep(0);
  }, [tourType]);

  useEffect(() => {
    if (!isOpen || tourSteps.length === 0) return;

    const updateTargetPosition = () => {
      const target = document.querySelector(tourSteps[currentStep]?.target);
      if (target) {
        setTargetRect(target.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    updateTargetPosition();
    window.addEventListener('resize', updateTargetPosition);
    window.addEventListener('scroll', updateTargetPosition);

    // Also check periodically in case elements are rendered after mount
    const interval = setInterval(updateTargetPosition, 500);

    return () => {
      window.removeEventListener('resize', updateTargetPosition);
      window.removeEventListener('scroll', updateTargetPosition);
      clearInterval(interval);
    };
  }, [isOpen, currentStep, tourSteps]);

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

  if (!isOpen || tourSteps.length === 0) return null;

  const step = tourSteps[currentStep];
  const padding = 8;

  // Calculate tooltip position - prefer bottom, but use top if target is low on screen
  const getTooltipPosition = () => {
    if (!targetRect) return {};
    
    const spaceBelow = window.innerHeight - targetRect.bottom;
    const spaceAbove = targetRect.top;
    const tooltipHeight = 200; // Approximate tooltip height
    
    if (spaceBelow > tooltipHeight + 20) {
      // Position below
      return {
        left: Math.min(
          Math.max(16, targetRect.left + targetRect.width / 2 - 160),
          window.innerWidth - 336
        ),
        top: targetRect.bottom + 16,
      };
    } else {
      // Position above
      return {
        left: Math.min(
          Math.max(16, targetRect.left + targetRect.width / 2 - 160),
          window.innerWidth - 336
        ),
        bottom: window.innerHeight - targetRect.top + 16,
      };
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100]"
      >
        {/* Overlay with spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - padding}
                  y={targetRect.top - padding}
                  width={targetRect.width + padding * 2}
                  height={targetRect.height + padding * 2}
                  rx="12"
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
            mask="url(#spotlight-mask)"
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
              borderRadius: '12px',
              border: '2px solid hsl(var(--primary))',
              boxShadow: '0 0 20px hsl(var(--primary) / 0.5)',
            }}
          />
        )}

        {/* Tooltip card */}
        {targetRect && (
          <motion.div
            key={`${tourType}-${currentStep}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-[101] w-[90vw] max-w-[320px] bg-card border border-border rounded-xl shadow-2xl p-4"
            style={getTooltipPosition()}
          >
            {/* Skip button */}
            <button
              onClick={handleSkip}
              className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Step indicator */}
            <div className="flex gap-1.5 mb-3">
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
              {tourData.name}
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
        )}

        {/* Fallback message if target not found */}
        {!targetRect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[101] w-[90vw] max-w-[320px] bg-card border border-border rounded-xl shadow-2xl p-4 text-center"
          >
            <p className="text-muted-foreground mb-4">
              Looking for the element... Make sure you have tasks visible to see this step.
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleSkip}>
                Skip Tour
              </Button>
              <Button size="sm" onClick={handleNext}>
                Next Step
              </Button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};