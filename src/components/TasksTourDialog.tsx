import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format, addDays } from 'date-fns';

interface TasksTourDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenAddTaskDialog?: () => void;
}

interface TourStep {
  title: string;
  description: string;
  targetId: string;
  fillAction?: () => void;
}

export const TasksTourDialog = ({ open, onClose, onOpenAddTaskDialog }: TasksTourDialogProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showDialog, setShowDialog] = useState(false);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();

  const today = new Date();
  const sevenDaysFromNow = addDays(today, 7);

  const tourSteps: TourStep[] = [
    {
      title: 'Add New Task',
      description: 'Click this button to open the task creation form. This is where you\'ll capture all your to-dos, projects tasks, and ideas.',
      targetId: 'tour-add-task-button',
      fillAction: () => {
        setShowDialog(true);
      }
    },
    {
      title: 'Task Title',
      description: 'Give your task a clear, actionable title. This helps you quickly understand what needs to be done at a glance.',
      targetId: 'tour-title-field',
      fillAction: () => {
        setTitle('Plan Holidays');
      }
    },
    {
      title: 'Task Description',
      description: 'Add details about what the task involves. Break it down into sub-tasks or notes to help you stay organized.',
      targetId: 'tour-description-field',
      fillAction: () => {
        setDescription('Choose destination, Find accommodation and book a flight');
      }
    },
    {
      title: 'Add Hyperlinks',
      description: 'You can add URLs in the description - they\'ll automatically become clickable links! Great for referencing websites, documents, or resources.',
      targetId: 'tour-description-field',
      fillAction: () => {
        setDescription('Choose destination, Find accommodation and book a flight\n\nbooking.com\nskyscanner.com');
      }
    },
    {
      title: 'Set Priority',
      description: 'Choose from Low, Medium, High, or Urgent priority. This helps you focus on what matters most and keeps your task list organized.',
      targetId: 'tour-priority-field',
      fillAction: () => {
        setPriority('high');
      }
    },
    {
      title: 'Start Date',
      description: 'Set when you plan to begin working on this task. This is useful for planning ahead and scheduling your work.',
      targetId: 'tour-start-date-field',
      fillAction: () => {
        setStartDate(today);
      }
    },
    {
      title: 'End Date',
      description: 'Set when you expect to complete the task. This helps track your timeline and plan your workload.',
      targetId: 'tour-end-date-field',
      fillAction: () => {
        setEndDate(sevenDaysFromNow);
      }
    },
    {
      title: 'Due Date',
      description: 'Set the deadline for this task. Tasks with due dates will appear in your "Today\'s To-Do" view when they\'re due!',
      targetId: 'tour-due-date-field',
      fillAction: () => {
        setDueDate(sevenDaysFromNow);
      }
    },
    {
      title: 'Attach Images',
      description: 'You can paste images directly with Ctrl+V or choose from your gallery. Perfect for screenshots, reference images, or visual notes. (Up to 8 images per task)',
      targetId: 'tour-images-section',
    },
    {
      title: 'Create Your Task',
      description: 'Once you\'ve filled in the details, click "Create Task" to save it. Your task will appear in your selected project or list. That\'s it - you\'re ready to be productive!',
      targetId: 'tour-create-button',
    }
  ];

  // Update highlight position when step changes
  useEffect(() => {
    if (!open) return;

    const updateHighlight = () => {
      const targetId = tourSteps[currentStep]?.targetId;
      if (!targetId) return;

      const element = document.getElementById(targetId);
      if (element) {
        setHighlightRect(element.getBoundingClientRect());
      } else {
        setHighlightRect(null);
      }
    };

    // Small delay to let DOM update
    const timer = setTimeout(updateHighlight, 100);
    window.addEventListener('resize', updateHighlight);
    window.addEventListener('scroll', updateHighlight);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateHighlight);
      window.removeEventListener('scroll', updateHighlight);
    };
  }, [open, currentStep, showDialog]);

  const handleNext = () => {
    // Execute the fill action for the current step
    const step = tourSteps[currentStep];
    if (step.fillAction) {
      step.fillAction();
    }

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
    resetTour();
    onClose();
  };

  const handleSkip = () => {
    resetTour();
    onClose();
  };

  const resetTour = () => {
    setCurrentStep(0);
    setShowDialog(false);
    setTitle('');
    setDescription('');
    setPriority('medium');
    setStartDate(undefined);
    setEndDate(undefined);
    setDueDate(undefined);
  };

  if (!open) return null;

  const step = tourSteps[currentStep];
  const padding = 8;

  // Calculate tooltip position
  const getTooltipPosition = () => {
    if (!highlightRect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    
    const spaceBelow = window.innerHeight - highlightRect.bottom;
    const spaceRight = window.innerWidth - highlightRect.right;
    
    if (spaceBelow > 220) {
      return {
        left: Math.min(Math.max(16, highlightRect.left), window.innerWidth - 340),
        top: highlightRect.bottom + 16,
      };
    } else if (spaceRight > 360) {
      return {
        left: highlightRect.right + 16,
        top: Math.max(16, highlightRect.top),
      };
    } else {
      return {
        left: Math.min(Math.max(16, highlightRect.left), window.innerWidth - 340),
        bottom: window.innerHeight - highlightRect.top + 16,
      };
    }
  };

  return (
    <>
      {/* Overlay */}
      <motion.div
        key="tour-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200]"
      >
        {/* Dark overlay with spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <mask id="tasks-tour-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {highlightRect && (
                <rect
                  x={highlightRect.left - padding}
                  y={highlightRect.top - padding}
                  width={highlightRect.width + padding * 2}
                  height={highlightRect.height + padding * 2}
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
            fill="rgba(0, 0, 0, 0.8)"
            mask="url(#tasks-tour-mask)"
          />
        </svg>

        {/* Spotlight border */}
        {highlightRect && (
          <motion.div
            key={`spotlight-${currentStep}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute pointer-events-none z-[201]"
            style={{
              left: highlightRect.left - padding,
              top: highlightRect.top - padding,
              width: highlightRect.width + padding * 2,
              height: highlightRect.height + padding * 2,
              borderRadius: '8px',
              border: '2px solid hsl(var(--primary))',
              boxShadow: '0 0 20px hsl(var(--primary) / 0.5)',
            }}
          />
        )}
      </motion.div>

      {/* Tooltip - wrapped in AnimatePresence for step transitions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`tooltip-step-${currentStep}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="fixed z-[202] w-[90vw] max-w-[320px] bg-card border border-border rounded-xl shadow-2xl p-4"
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
          <div className="flex gap-1 mb-3 flex-wrap">
            {tourSteps.map((_, index) => (
              <div
                key={index}
                className={`h-1.5 rounded-full transition-all ${
                  index === currentStep
                    ? 'w-4 bg-primary'
                    : index < currentStep
                    ? 'w-1.5 bg-primary/50'
                    : 'w-1.5 bg-muted'
                }`}
              />
            ))}
          </div>

          {/* Tour Title */}
          <div className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
            Tasks Tour • Step {currentStep + 1} of {tourSteps.length}
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

            <Button
              size="sm"
              onClick={handleNext}
              className="gap-1"
            >
              {currentStep === tourSteps.length - 1 ? 'Finish' : 'Next'}
              {currentStep < tourSteps.length - 1 && (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Simulated Add Task Button (Step 0) */}
      {currentStep === 0 && !showDialog && (
        <div 
          id="tour-add-task-button"
          className="fixed top-4 right-4 z-[199]"
        >
          <Button className="gap-2 border-2 shadow-lg shadow-primary/20">
            + Add Task
          </Button>
        </div>
      )}

      {/* Tour Dialog (Steps 1-9) */}
      {showDialog && (
        <Dialog open={showDialog} onOpenChange={() => {}}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto z-[199]">
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
              <DialogDescription className="sr-only">
                Tour guide for creating a new task
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div id="tour-title-field">
                <Label htmlFor="tour-title">Title *</Label>
                <Input
                  id="tour-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title"
                  readOnly
                />
              </div>

              <div id="tour-description-field">
                <Label htmlFor="tour-description">Description</Label>
                <Textarea
                  id="tour-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Task description"
                  rows={4}
                  readOnly
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div id="tour-priority-field">
                  <Label htmlFor="tour-priority">Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="tour-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="tour-status">Status</Label>
                  <Select value="todo" disabled>
                    <SelectTrigger id="tour-status">
                      <SelectValue placeholder="To Do" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To Do</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div id="tour-start-date-field">
                  <Label>Start Date</Label>
                  <Button variant="outline" className="w-full justify-start text-left font-normal" disabled>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </div>

                <div id="tour-end-date-field">
                  <Label>End Date</Label>
                  <Button variant="outline" className="w-full justify-start text-left font-normal" disabled>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </div>

                <div id="tour-due-date-field">
                  <Label>Due Date</Label>
                  <Button variant="outline" className="w-full justify-start text-left font-normal" disabled>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </div>
              </div>

              <div id="tour-images-section">
                <Label>Images (Optional - Max 8)</Label>
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled
                  >
                    📁 Choose from Gallery (0/8)
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Desktop: You can also paste images with Ctrl+V
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" disabled>
                  Cancel
                </Button>
                <Button id="tour-create-button" disabled>
                  Create Task
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};