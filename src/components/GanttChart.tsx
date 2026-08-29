import { Task, Project } from '@/types/task';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { CalendarPlus, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval, addMonths } from 'date-fns';
import { useMemo, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, ListTodo } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface GanttChartProps {
  tasks: Task[];
  allTasks?: Task[];
  projectName?: string;
  projectId?: string | null;
  projects?: Project[];
  /** Sub-project grouping (P4). Passed ONLY when the selected project is a
   * top-level project that actually has active sub-projects; without it this
   * component renders exactly as it did before, one flat list of task rows. */
  groupBy?: { parentId: string; subs: Project[] };
  /** Owner of the persisted collapse map (localStorage key is per user). */
  userId?: string;
  onTaskClick?: (task: Task) => void;
  onAddTask?: (task: Task) => void;
  onOpenAddTask?: () => void;
}

export const GanttChart = ({ tasks, allTasks = [], projectName = 'Gantt Chart', projectId, projects = [], groupBy, userId, onTaskClick, onAddTask, onOpenAddTask }: GanttChartProps) => {
  const { isConnected, push, busy } = useGoogleCalendar();
  const [syncingAll, setSyncingAll] = useState(false);
  // Per-sub expand state. This session's toggles only; the persisted map is read
  // from localStorage DURING RENDER (groupOpen below) and the two are merged, so
  // nothing here is corrected by a post-paint effect. SAME pattern as the
  // drawer's sub-project tree (ProjectSidebar's storedTreeOpen/treeOpenOverride).
  const [groupOpenOverride, setGroupOpenOverride] = useState<Record<string, boolean>>({});

  const syncAllToGCal = async () => {
    const ids = tasks.filter(t => t.startDate || t.endDate || t.dueDate).map(t => t.id);
    if (ids.length === 0) return;
    setSyncingAll(true);
    await push({ taskIds: ids, action: 'sync' });
    setSyncingAll(false);
  };
  const isMobile = useIsMobile();
  const [existingSheetOpen, setExistingSheetOpen] = useState(false);

  const tasksWithoutDates = allTasks.filter(t => (!t.startDate || !t.endDate) && t.status !== 'completed');
  const tasksWithDates = tasks
    .filter(t => t.startDate && t.endDate)
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime());
  
  const months = useMemo(() => {
    const today = new Date();
    // Span every month that has scheduled work: earliest task start .. latest
    // task end, with the old today..+2 window as the minimum. Capped at 36
    // panels as a runaway guard.
    let first = startOfMonth(today);
    let last = endOfMonth(addMonths(today, 2));
    if (tasksWithDates.length > 0) {
      const minStart = tasksWithDates.reduce(
        (m, t) => (t.startDate! < m ? t.startDate! : m),
        tasksWithDates[0].startDate!,
      );
      const maxEnd = tasksWithDates.reduce(
        (m, t) => (t.endDate! > m ? t.endDate! : m),
        tasksWithDates[0].endDate!,
      );
      if (startOfMonth(minStart) < first) first = startOfMonth(minStart);
      if (endOfMonth(maxEnd) > last) last = endOfMonth(maxEnd);
    }
    const result: { start: Date; end: Date; days: Date[] }[] = [];
    let cursor = first;
    while (cursor <= last && result.length < 36) {
      const start = startOfMonth(cursor);
      const end = endOfMonth(cursor);
      result.push({ start, end, days: eachDayOfInterval({ start, end }) });
      cursor = addMonths(cursor, 1);
    }
    return result;
  }, [tasksWithDates]);

  const today = new Date();

  // Same maths for a single task and for a sub-project's roll-up bar: clip the
  // range to the month, then convert to percentages of the month's day columns.
  const getRangePosition = (start: Date, end: Date, days: Date[], monthStart: Date, monthEnd: Date) => {
    // Clip dates to month boundaries
    const clippedStart = start < monthStart ? monthStart : start;
    const clippedEnd = end > monthEnd ? monthEnd : end;

    const totalDays = days.length;
    const startIndex = days.findIndex(day => isSameDay(day, clippedStart));
    const endIndex = days.findIndex(day => isSameDay(day, clippedEnd));
    
    if (startIndex === -1 || endIndex === -1) return null;
    
    const left = (startIndex / totalDays) * 100;
    const width = ((endIndex - startIndex + 1) / totalDays) * 100;
    
    return { left, width };
  };

  const getTaskPosition = (task: Task, days: Date[], monthStart: Date, monthEnd: Date) => {
    if (!task.startDate || !task.endDate) return null;
    return getRangePosition(task.startDate, task.endDate, days, monthStart, monthEnd);
  };

  const getTasksForMonth = (monthStart: Date, monthEnd: Date) => {
    return tasksWithDates.filter(task => {
      if (!task.startDate || !task.endDate) return false;
      return isWithinInterval(task.startDate, { start: monthStart, end: monthEnd }) ||
             isWithinInterval(task.endDate, { start: monthStart, end: monthEnd }) ||
             (task.startDate < monthStart && task.endDate > monthEnd);
    });
  };

  const taskColors = [
    { bg: 'bg-blue-500', border: 'border-blue-500' },
    { bg: 'bg-purple-500', border: 'border-purple-500' },
    { bg: 'bg-green-500', border: 'border-green-500' },
    { bg: 'bg-orange-500', border: 'border-orange-500' },
    { bg: 'bg-pink-500', border: 'border-pink-500' },
    { bg: 'bg-amber-600', border: 'border-amber-600' },
    { bg: 'bg-yellow-500', border: 'border-yellow-500' },
    { bg: 'bg-indigo-500', border: 'border-indigo-500' },
    { bg: 'bg-red-500', border: 'border-red-500' },
    { bg: 'bg-rose-700', border: 'border-rose-700' }
  ];

  // Persisted per-sub collapse, read straight from localStorage DURING RENDER and
  // overlaid with this session's toggles (groupOpenOverride). Reading here rather
  // than seeding state in an effect keeps the first paint correct, so a collapse
  // survives a reload without a post-paint correction. Mirrors the drawer.
  const storedGroupOpen = useMemo<Record<string, boolean>>(() => {
    if (!userId) return {};
    try {
      const raw = window.localStorage.getItem(`focusos-gantt-open-${userId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }, [userId]);

  const groupOpen = useMemo(
    () => ({ ...storedGroupOpen, ...groupOpenOverride }),
    [storedGroupOpen, groupOpenOverride],
  );

  const setGroupOpenFor = (subId: string, open: boolean) => {
    const next = { ...groupOpen, [subId]: open };
    setGroupOpenOverride(next);
    if (userId) {
      try {
        window.localStorage.setItem(`focusos-gantt-open-${userId}`, JSON.stringify(next));
      } catch { /* private mode / quota — the in-memory state still works */ }
    }
  };

  // Default OPEN, same rule the drawer uses: only an explicit collapse is stored,
  // so a newly dated task can never hide inside a closed group.
  const toggleGroupOpen = (subId: string) => setGroupOpenFor(subId, !(groupOpen[subId] ?? true));

  const subIdSet = useMemo(() => new Set((groupBy?.subs ?? []).map(sub => sub.id)), [groupBy]);

  if (tasksWithDates.length === 0) {
    return (
      <Card className="p-8 bg-card/80 backdrop-blur-sm border-2">
        <p className="text-center text-muted-foreground">
          No tasks with dates to display in Gantt view
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-40">

      {months.map((month, monthIndex) => {
        const monthTasks = getTasksForMonth(month.start, month.end);

        // ---- Sub-project grouping (P4), derived during render ------------------
        // Without groupBy both of these collapse to "everything is an own task",
        // which is byte-for-byte the pre-P4 render.
        const ownMonthTasks = monthTasks.filter(task => !task.projectId || !subIdSet.has(task.projectId));
        const monthSubGroups = (groupBy?.subs ?? [])
          .map(sub => {
            const subTasks = monthTasks.filter(task => task.projectId === sub.id);
            if (subTasks.length === 0) return null;
            // Roll-up bar: min(start) .. max(end) across THIS month's tasks for
            // this sub, through the same clipping maths a task bar uses.
            const rollupStart = new Date(Math.min(...subTasks.map(t => t.startDate!.getTime())));
            const rollupEnd = new Date(Math.max(...subTasks.map(t => t.endDate!.getTime())));
            return {
              sub,
              subTasks,
              rollup: getRangePosition(rollupStart, rollupEnd, month.days, month.start, month.end),
            };
          })
          .filter((group): group is { sub: Project; subTasks: Task[]; rollup: { left: number; width: number } | null } => group !== null);

        // ONE task-row markup, shared by the parent's own rows and a sub's rows —
        // the sub rows differ only by the title's indent (the date bar must stay
        // aligned to the month grid, so the row itself is never padded).
        const renderTaskRow = (task: Task, indented = false) => {
          const position = getTaskPosition(task, month.days, month.start, month.end);
          if (!position) return null;

          const taskColor = taskColors[tasksWithDates.findIndex(t => t.id === task.id) % taskColors.length];

          return (
            <div
              key={task.id}
              data-testid={`gantt-task-${task.id}`}
              className="relative h-10 border-b border-border/50 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => onTaskClick?.(task)}
            >
              <div
                className={`absolute ${indented ? 'left-6' : 'left-0'} top-1 text-sm font-medium truncate max-w-full sm:max-w-[45%] ${task.status === 'completed' ? 'line-through opacity-50' : ''}`}
                title={`${task.title} - ${format(task.startDate!, 'MMM d')} to ${format(task.endDate!, 'MMM d')}`}
              >
                {task.title}
              </div>
              {/* Date range underline bar */}
              <div
                className={`absolute bottom-0 h-1.5 rounded-full ${taskColor.bg} ${task.status === 'completed' ? 'opacity-30' : 'opacity-90'}`}
                style={{
                  left: `${position.left}%`,
                  width: `${position.width}%`
                }}
              >
                {task.status === 'completed' && (
                  <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
                    <defs>
                      <pattern id={`zigzag-${task.id}`} patternUnits="userSpaceOnUse" width="8" height="6" patternTransform="rotate(0)">
                        <polyline points="0,6 4,0 8,6" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#zigzag-${task.id})`} />
                  </svg>
                )}
              </div>
            </div>
          );
        };

        return (
          <Card key={monthIndex} className="p-6 overflow-x-auto bg-card/80 backdrop-blur-sm border-2">
            {/* Title row with buttons */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {projectName} - {format(month.start, 'MMMM yyyy')}
              </h3>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-primary border-2" onClick={() => onOpenAddTask?.()}>
                  <Plus className="h-3 w-3" />
                  New
                </Button>
                {isConnected && monthIndex === 0 && (
                  <Button
                    variant="outline" size="sm"
                    className="gap-1 text-xs h-8"
                    disabled={syncingAll || busy}
                    onClick={syncAllToGCal}
                    title="Sync all scheduled tasks to your Focus OS Google Calendar"
                  >
                    {syncingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarPlus className="h-3 w-3" />}
                    Sync to Google
                  </Button>
                )}
                {isMobile ? (
                  <>
                    <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-accent border-2" disabled={tasksWithoutDates.length === 0} onClick={() => setExistingSheetOpen(true)}>
                      <ListTodo className="h-3 w-3" />
                      Existing
                    </Button>
                    <Sheet open={existingSheetOpen} onOpenChange={setExistingSheetOpen}>
                      <SheetContent side="bottom" className="max-h-[60vh]">
                        <SheetHeader>
                          <SheetTitle>Unscheduled Tasks</SheetTitle>
                        </SheetHeader>
                        <div className="overflow-y-auto mt-3 space-y-1">
                          {tasksWithoutDates.map(task => (
                            <button
                              key={task.id}
                              className="w-full text-left px-3 py-2.5 rounded-md border border-accent/50 text-sm truncate hover:bg-accent/10 transition-colors"
                              onClick={() => { onTaskClick?.(task); setExistingSheetOpen(false); }}
                            >
                              {task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}
                            </button>
                          ))}
                        </div>
                      </SheetContent>
                    </Sheet>
                  </>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1 text-xs h-8 border-accent border-2" disabled={tasksWithoutDates.length === 0}>
                        <ListTodo className="h-3 w-3" />
                        Existing
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-64 overflow-y-auto border-accent/50 border">
                      {tasksWithoutDates.map(task => (
                        <DropdownMenuItem key={task.id} onClick={() => onTaskClick?.(task)} className="border-b border-accent/20 last:border-b-0">
                          {task.title.length > 40 ? task.title.slice(0, 40) + '…' : task.title}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            
            {/* Timeline Header */}
            <div className="mb-4">
              <div className="flex relative h-12 border-b">
                {month.days.map((day, idx) => {
                  const isToday = isSameDay(day, today);
                  const dayNum = day.getDate();
                  const lastDay = month.days[month.days.length - 1].getDate();
                  const isIntervalDay = dayNum % 5 === 0 && Math.abs(dayNum - lastDay) >= 2;
                  const showOnMobile = dayNum === 1 || dayNum === lastDay || isIntervalDay || isToday;
                  return (
                    <div 
                      key={idx} 
                      className={`flex-1 text-center text-xs py-2 border-r min-w-0 ${isToday ? 'bg-primary/10' : ''}`}
                    >
                      <div className="font-medium whitespace-nowrap overflow-visible">
                        <span className="hidden sm:inline">{dayNum}</span>
                        <span className="sm:hidden">{showOnMobile ? dayNum : ''}</span>
                      </div>
                      <div className="text-muted-foreground hidden min-[1100px]:block whitespace-nowrap">{format(day, 'EEE')}</div>
                    </div>
                  );
                })}
                {/* Today indicator */}
                {month.days.findIndex(day => isSameDay(day, today)) !== -1 && (
                  <div 
                    className="absolute top-0 bottom-0 w-0.5 bg-accent z-10"
                    style={{ 
                      left: `${(month.days.findIndex(day => isSameDay(day, today)) / month.days.length) * 100}%` 
                    }}
                  />
                )}
              </div>
            </div>

            {/* Tasks */}
            {monthTasks.length > 0 ? (
              <div className="space-y-3">
                {/* The parent's OWN tasks first, exactly as before P4. */}
                {ownMonthTasks.map(task => renderTaskRow(task))}

                {/* Then one group per sub-project that has dated tasks in this
                    month: a header row carrying the sub's roll-up bar, and the
                    sub's own task rows underneath. Collapse/expand is a plain
                    conditional render — no animation, no layer being born or
                    destroyed while anything moves (iOS Safari law). */}
                {monthSubGroups.map(({ sub, subTasks, rollup }) => {
                  const isOpen = groupOpen[sub.id] ?? true;
                  return (
                    <div key={sub.id} className="space-y-3">
                      <div className="relative h-10 border-b border-border/50" data-testid={`gantt-group-${sub.id}`}>
                        <div className="absolute left-0 top-0 flex items-center gap-1 max-w-full sm:max-w-[45%] min-w-0">
                          {/* SAME control the drawer's tree uses: plain button,
                              ChevronDown/ChevronRight, aria-expanded. */}
                          <button
                            type="button"
                            data-testid={`gantt-toggle-${sub.id}`}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${sub.name}`}
                            className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleGroupOpen(sub.id)}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                            )}
                          </button>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sub.color }} />
                          <span className="text-sm font-medium truncate min-w-0" title={sub.name}>{sub.name}</span>
                        </div>
                        {rollup && (
                          <div
                            data-testid={`gantt-rollup-${sub.id}`}
                            className="absolute bottom-0 h-1.5 rounded-full opacity-90"
                            style={{
                              left: `${rollup.left}%`,
                              width: `${rollup.width}%`,
                              backgroundColor: sub.color
                            }}
                          />
                        )}
                      </div>
                      {isOpen && subTasks.map(task => renderTaskRow(task, true))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                No tasks scheduled for this month
              </p>
            )}
          </Card>
        );
      })}

    </div>
  );
};
