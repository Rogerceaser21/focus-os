import { Task, Project } from '@/types/task';
import { useMemo } from 'react';

interface TimeTrackingChartProps {
  tasks: Task[];
  projects: Project[];
}

interface TaskGroup {
  projectId: string | null;
  projectName: string;
  projectColor: string;
  totalSeconds: number;
  tasks: Task[];
}

export const TimeTrackingChart = ({ tasks, projects }: TimeTrackingChartProps) => {
  const groupedTasks = useMemo(() => {
    const groups: TaskGroup[] = [];
    const projectMap = new Map(projects.map(p => [p.id, p]));

    // Group tasks by project
    const tasksByProject = tasks.reduce((acc, task) => {
      const key = task.projectId || 'unassigned';
      if (!acc[key]) acc[key] = [];
      acc[key].push(task);
      return acc;
    }, {} as Record<string, Task[]>);

    // Create groups with totals
    Object.entries(tasksByProject).forEach(([key, tasks]) => {
      const project = key === 'unassigned' ? null : projectMap.get(key);
      const totalSeconds = tasks.reduce((sum, t) => sum + t.timer.totalSeconds, 0);
      
      groups.push({
        projectId: key === 'unassigned' ? null : key,
        projectName: project?.name || 'Unassigned',
        projectColor: project?.color || '#64748b',
        totalSeconds,
        tasks: tasks.sort((a, b) => b.timer.totalSeconds - a.timer.totalSeconds)
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
              <div className="flex-1">
                <div 
                  className="h-12 rounded-lg flex items-center px-4 font-bold text-lg shadow-lg"
                  style={{
                    backgroundColor: `${group.projectColor}40`,
                    borderLeft: `4px solid ${group.projectColor}`,
                    width: `${(group.totalSeconds / maxSeconds) * 100}%`,
                    minWidth: '200px'
                  }}
                >
                  <span className="truncate" data-testid="time-group-name">{group.projectName}</span>
                </div>
              </div>
              <span className="text-sm font-mono text-muted-foreground min-w-[100px] text-right">
                {formatTime(group.totalSeconds)}
              </span>
            </div>
          </div>

          {/* Task Bars */}
          <div className="space-y-2 pl-6">
            {group.tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3">
                <div className="flex-1">
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
        </div>
      ))}
    </div>
  );
};
