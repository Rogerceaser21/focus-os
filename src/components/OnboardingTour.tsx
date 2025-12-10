import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TourStep {
  target: string;
  title: string;
  description: string;
}

const tourSteps: TourStep[] = [
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
];

interface OnboardingTourProps {
  isOpen: boolean;
  onComplete: () => void;
}

export const OnboardingTour = ({ isOpen, onComplete }: OnboardingTourProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const target = document.querySelector(tourSteps[currentStep].target) as HTMLElement;
    const elementsToElevate: { el: HTMLElement; originalZIndex: string; originalPosition: string }[] = [];

    const updateTargetPosition = () => {
      if (target) {
        setTargetRect(target.getBoundingClientRect());
      }
    };

    // Initial delay to allow DOM to settle (especially on mobile)
    const initialTimeout = setTimeout(() => {
      updateTargetPosition();
      
      // Elevate the target element AND all its children above the overlay
      if (target) {
        // Elevate the target itself
        elementsToElevate.push({
          el: target,
          originalZIndex: target.style.zIndex,
          originalPosition: target.style.position
        });
        target.style.position = 'relative';
        target.style.zIndex = '100001';
        
        // Also elevate all descendants to ensure icons are visible
        const descendants = target.querySelectorAll('*') as NodeListOf<HTMLElement>;
        descendants.forEach((child) => {
          elementsToElevate.push({
            el: child,
            originalZIndex: child.style.zIndex,
            originalPosition: child.style.position
          });
          child.style.position = 'relative';
          child.style.zIndex = '100001';
        });
      }
    }, 100);

    window.addEventListener('resize', updateTargetPosition);
    window.addEventListener('scroll', updateTargetPosition);

    // Observe DOM changes for dynamic updates
    const observer = new MutationObserver(() => {
      updateTargetPosition();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(initialTimeout);
      window.removeEventListener('resize', updateTargetPosition);
      window.removeEventListener('scroll', updateTargetPosition);
      observer.disconnect();
      
      // Reset all elevated elements
      elementsToElevate.forEach(({ el, originalZIndex, originalPosition }) => {
        el.style.zIndex = originalZIndex;
        el.style.position = originalPosition;
      });
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
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute w-[90vw] max-w-[320px] bg-card border border-border rounded-xl shadow-2xl p-4 pointer-events-auto"
            style={{
              left: Math.min(
                Math.max(16, targetRect.left + targetRect.width / 2 - 160),
                window.innerWidth - 336
              ),
              bottom: window.innerHeight - targetRect.top + 16,
              zIndex: 100000,
            }}
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
              Menu Magic Buttons Tour
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
      </motion.div>
    </AnimatePresence>
  );
};
