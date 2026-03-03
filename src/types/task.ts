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
}

export interface Project {
  id: string;
  name: string;
  color: string;
  timer: TaskTimer;
}
