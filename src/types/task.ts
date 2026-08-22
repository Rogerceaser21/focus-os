export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in-progress' | 'completed';

export interface TaskTimer {
  totalSeconds: number;
  isRunning: boolean;
  startTime?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  startDate?: Date;
  endDate?: Date;
  dueDate?: Date;
  images?: string[];
  timer: TaskTimer;
  projectId?: string;
  sortOrder?: number;
  completedByEmail?: string;
  assignedToEmail?: string;
  changeRequestMessage?: string;
  sharedWithName?: string;
  sharedRecipients?: Array<{ email: string; name: string; status: string; sharedItemId?: string }>;
  googleCalendarEventId?: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  timer: TaskTimer;
  isShared?: boolean;
  userId?: string;
  /** ISO timestamp, or null/undefined when active. Archived projects are filtered
   * out at the loadProjects consumers (see appDataFetchers.isProjectArchived) —
   * this field only needs to survive onto rows that intentionally keep archived
   * ones (the drawer's Archived section, the time-report project lookup). */
  archivedAt?: string | null;
}
