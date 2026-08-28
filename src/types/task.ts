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
  /** Id of the project this one sits under, or null/undefined when it is top
   * level. ONE level deep only, enforced in app code (see groupProjectTree in
   * src/lib/projectTree.ts and the move guard in Index.tsx): a project that is
   * itself a sub can never be a parent. A sub IS an ordinary project row in
   * every other respect — routing, timers, task CRUD, calendar sync and
   * sharing are all unchanged by this field. Shared projects are always
   * rendered flat in a member's drawer, whatever it holds. */
  parentProjectId?: string | null;
  /** Manual position inside this project's SIBLING group (the top level, or the
   * subs of one parent), or null/undefined when it has never been dragged into
   * place. Null sorts after every ordered sibling - see compareSiblingOrder in
   * src/lib/projectTree.ts, which every list derives its order from. */
  sortOrder?: number | null;
  /** ISO timestamp of when the project was pinned to the top of the drawer, or
   * null/undefined when it is not pinned. At most PIN_LIMIT rows per account
   * (projects and sub-projects together). */
  pinnedAt?: string | null;
}
