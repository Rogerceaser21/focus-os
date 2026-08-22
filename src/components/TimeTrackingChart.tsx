import { Task, Project } from '@/types/task';
import { useMemo } from 'react';

interface TimeTrackingChartProps {
  tasks: Task[];
  projects: Project[];
}

interface SubTaskGroup {
  projectId: string;
  projectName: string;
  projectColor: string;
  totalSeconds: number;
  tasks: Task[];
}

interface TaskGroup {
  projectId: string | null;
  projectName: string;
  projectColor: string;
  /** Own tasks PLUS every sub-project's tasks — the roll-up total (P4). */
  totalSeconds: number;
  /** Tasks that live directly on this project. */
  tasks: Task[];
  /** One entry per sub-project of this project that has tracked tasks here. */
  subGroups: SubTaskGroup[];
}

export const TimeTrackingChart = ({ tasks, projects }: TimeTrackingChartProps) => {
  const groupedTasks = useMemo(() => {
    const projectMap = new Map(projects.map(p => [p.id, p]));

    // The project a task's time ROLLS UP INTO: its own project, unless that
    // project is a sub whose parent is present in `projects` — then the parent
    // owns the total (P4). An orphan sub (parent archived away / not in the
    // list) stays its own group, so no row can vanish from the report.
    const rollUpKey = (projectId: string): string => {
      const project = projectMap.get(projectId);
      const parentId = project?.parentProjectId;
      if (!parentId || parentId === projectId) return projectId;
      const parent = projectMap.get(parentId);
      if (!parent) return projectId; // orphan sub -> its own group
      // Grandchild guard, same rule groupProjectTree applies to the drawer: a
      // bad row two levels deep is treated as top level rather than nested, so
      // one project can never be both a group and a subgroup.
      if (parent.parentProjectId && parent.parentProjectId !== parent.id && projectMap.has(parent.parentProjectId)) {
        return projectId;
      }
      return parentId;
    };

    // Group tasks by the project they roll up into, keeping the sub split.
    const tasksByProject = tasks.reduce((acc, task) => {
      const key = task.projectId ? rollUpKey(task.projectId) : 'unassigned';
      if (!acc[key]) acc[key] = [];
      acc[key].push(task);
      return acc;
    }, {} as Record<string, Task[]>);

    const groups: TaskGroup[] = [];

    // Create groups with totals
    Object.entries(tasksByProject).forEach(([key, groupTasks]) => {
      const project = key === 'unassigned' ? null : projectMap.get(key);
      const totalSeconds = groupTasks.reduce((sum, t) => sum + t.timer.totalSeconds, 0);

      const ownTasks = groupTasks.filter(t => (t.projectId ?? 'unassigned') === key);
      // Sub-projects that contributed to this group, each with its own subtotal.
      const subIds = Array.from(new Set(
        groupTasks.filter(t => (t.projectId ?? 'unassigned') !== key).map(t => t.projectId as string)
      ));
      const subGroups: SubTaskGroup[] = subIds.map(subId => {
        const subTasks = groupTasks.filter(t => t.projectId === subId);
        const sub = projectMap.get(subId);
        return {
          projectId: subId,
          projectName: sub?.name || 'Sub-project',
          projectColor: sub?.color || project?.color || '#64748b',
          totalSeconds: subTasks.reduce((sum, t) => sum + t.timer.totalSeconds, 0),
          tasks: subTasks.sort((a, b) => b.timer.totalSeconds - a.timer.totalSeconds),
        };
      }).sort((a, b) => b.totalSeconds - a.totalSeconds);

      groups.push({
        projectId: key === 'unassigned' ? null : key,
        projectName: project?.name || 'Unassigned',
        projectColor: project?.color || '#64748b',
        totalSeconds,
        tasks: ownTasks.sort((a, b) => b.timer.totalSeconds - a.timer.totalSeconds),
        subGroups,
      });
    });

    // Sort groups by total time
    return groups.sort((a, b) => b.totalSeconds - a.totalSeconds);
  }, [tasks, projects]);

  const maxSeconds = useMemo(() => {
    return Math.max(...tasks.map(t => t.timer.totalSeconds), 1);
  }, [tasks]);

  const formatTime = (seconds: number) => {
    if (seconds === 0) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No tracked time yet. Start a timer on a task to see it here!
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="time-tracking-chart">
      {groupedTasks.map((group) => (
        <div key={group.projectId || 'unassigned'} className="space-y-3">
          {/* Project Header Bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {/* min-w-0: without it the nowrap project name sets this column's
                  minimum width, the bar overflows the row on a 393px screen and
                  pushes the (rolled-up) total off the edge. */}
              <div className="flex-1 min-w-0">
                <div 
                  className="h-12 rounded-lg flex items-center px-4 font-bold text-lg shadow-lg"
                  style={{
                    backgroundColor: `${group.projectColor}40`,
                    borderLeft: `4px solid ${group.projectColor}`,
                    // Clamped: the scale is per-TASK, so a group total (now a
                    // roll-up of the project AND its subs) routinely exceeds the
                    // longest single task and would otherwise render wider than
                    // its own row, pushing the formatted total off screen.
                    width: `${Math.min(100, (group.totalSeconds / maxSeconds) * 100)}%`,
                    minWidth: '200px'
                  }}
                >
                  <span className="truncate" data-testid="time-group-name">{group.projectName}</span>
                </div>
              </div>
              <span
                className="text-sm font-mono text-muted-foreground min-w-[100px] text-right"
                data-testid={`time-group-total-${group.projectId ?? 'unassigned'}`}
              >
                {formatTime(group.totalSeconds)}
              </span>
            </div>
          </div>

          {/* Task Bars — the project's OWN tasks first, with no sub header. */}
          <div className="space-y-2 pl-6">
            {group.tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3">
                {/* min-w-0, same reason as the group row above: the task title is
                    nowrap-truncated, so without it the bar sets the column's
                    minimum width and the elapsed time is clipped at 393px. */}
                <div className="flex-1 min-w-0">
                  <div 
                    className={`h-10 rounded-md flex items-center px-3 text-sm transition-all ${
                      task.status === 'completed' 
                        ? 'opacity-60 line-through' 
                        : ''
                    }`}
                    style={{
                      backgroundColor: `${group.projectColor}30`,
                      borderLeft: `3px solid ${group.projectColor}`,
                      width: `${(task.timer.totalSeconds / maxSeconds) * 100}%`,
                      minWidth: '150px'
                    }}
                  >
                    <span className="truncate">{task.title}</span>
                  </div>
                </div>
                <span className="text-xs font-mono text-muted-foreground min-w-[100px] text-right">
                  {formatTime(task.timer.totalSeconds)}
                </span>
              </div>
            ))}
          </div>

          {/* Then one block per sub-project that contributed time to this group:
              a caption row with the sub's own subtotal, then its task bars in
              the sub's colour, indented one step further than the own tasks. */}
          {group.subGroups.map((sub) => (
            <div key={sub.projectId} className="space-y-2">
              <div className="flex items-center gap-3 pl-6" data-testid={`time-subgroup-${sub.projectId}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sub.projectColor }} />
                  <span className="text-xs text-muted-foreground truncate" title={sub.projectName}>{sub.projectName}</span>
                </div>
                <span
                  className="text-xs font-mono text-muted-foreground min-w-[100px] text-right"
                  data-testid={`time-subgroup-total-${sub.projectId}`}
                >
                  {formatTime(sub.totalSeconds)}
                </span>
              </div>
              <div className="space-y-2 pl-12">
                {sub.tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div
                        className={`h-10 rounded-md flex items-center px-3 text-sm transition-all ${
                          task.status === 'completed'
                            ? 'opacity-60 line-through'
                            : ''
                        }`}
                        style={{
                          backgroundColor: `${sub.projectColor}30`,
                          borderLeft: `3px solid ${sub.projectColor}`,
                          width: `${(task.timer.totalSeconds / maxSeconds) * 100}%`,
                          minWidth: '150px'
                        }}
                      >
                        <span className="truncate">{task.title}</span>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground min-w-[100px] text-right">
                      {formatTime(task.timer.totalSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
