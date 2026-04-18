export interface TaskTourStep {
  /** CSS selector for the highlighted element */
  target: string;
  title: string;
  description: string;
  /** If true, the step is shown only when the corresponding element exists */
  optional?: boolean;
}

export const taskTourSteps: TaskTourStep[] = [
  {
    target: '[data-task-tour-step="add-task-button"]',
    title: 'Add Task button',
    description:
      "This is your quick way to create new tasks. Tap here any time you want to capture something new. We'll open a sample task for the rest of the tour.",
  },
  {
    target: '[data-task-tour-step="title"]',
    title: 'Title',
    description:
      'Give your task a clear, descriptive title — this is the headline you\'ll see across every list and view.',
  },
  {
    target: '[data-task-tour-step="description"]',
    title: 'Description & links',
    description:
      'Add notes, instructions, or context. Any URL you paste here automatically becomes a clickable link — perfect for booking sites, docs, or references.',
  },
  {
    target: '[data-task-tour-step="project"]',
    title: 'Assign to a project',
    description:
      'Group related work by assigning the task to a project. Leave it on "None" to keep it in your Unassigned list.',
    optional: true,
  },
  {
    target: '[data-task-tour-step="priority"]',
    title: 'Priority',
    description:
      'Set how important this task is — Low, Medium, High, or Urgent. Higher priorities sort to the top of your lists.',
  },
  {
    target: '[data-task-tour-step="start-date"]',
    title: 'Start date',
    description:
      "When do you plan to begin? This is used by the Gantt view to lay out your project timeline.",
  },
  {
    target: '[data-task-tour-step="end-date"]',
    title: 'End date',
    description:
      'When should the work be finished? Together with the Start date, this defines the bar length on the Gantt chart.',
  },
  {
    target: '[data-task-tour-step="due-date"]',
    title: 'Due date',
    description:
      'The deadline. Anything due today (or earlier) automatically appears in your "Today\'s To-Do" list.',
  },
  {
    target: '[data-task-tour-step="images"]',
    title: 'Attach images',
    description:
      'Add up to 8 images for visual reference — paste with Ctrl+V on desktop, or pick from your gallery on mobile.',
  },
  {
    target: '[data-task-tour-step="save-button"]',
    title: 'Save your changes',
    description:
      "All set! Hit Save to lock in your edits. That's the full Tasks tour — happy focusing!",
  },
];
