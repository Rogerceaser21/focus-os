import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, Project, TaskPriority } from '@/types/task';
import { TaskListItem } from '@/components/TaskListItem';
import { GripVertical } from 'lucide-react';

interface DraggableTaskListProps {
  tasks: Task[];
  onUpdate: (task: Task) => void;
  onBatchUpdate?: (tasks: Task[]) => void;
  onEditTask?: (task: Task) => void;
  onEditTaskImages?: (task: Task) => void;
  onEditTaskDates?: (task: Task) => void;
  onAssignTask?: (task: Task) => void;
  onRequestChanges?: (task: Task) => void;
  onDismissChangeRequest?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void | Promise<void>;
  globalViewMode: 'full' | 'compact' | 'minimal';
  expandedTaskIds: Set<string>;
  onTaskClick: (taskId: string) => void;
  projects: Project[];
  /** Per-task sub-project caption (P4). Computed by Index during render; this
   * list only forwards it, so the label logic lives in exactly one place. */
  getScopeLabel?: (task: Task) => { name: string; color: string } | undefined;
  isReorderMode?: boolean;
}

const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

const PRIORITY_LABELS: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'text-destructive' },
  high: { label: 'High', color: 'text-orange-400' },
  medium: { label: 'Medium', color: 'text-yellow-400' },
  low: { label: 'Low', color: 'text-muted-foreground' },
};

interface SortableTaskItemProps {
  task: Task;
  onUpdate: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onEditTaskImages?: (task: Task) => void;
  onEditTaskDates?: (task: Task) => void;
  onAssignTask?: (task: Task) => void;
  onRequestChanges?: (task: Task) => void;
  onDismissChangeRequest?: (task: Task) => void;
  onDeleteTask?: (task: Task) => void | Promise<void>;
  globalViewMode: 'full' | 'compact' | 'minimal';
  isIndividuallyExpanded: boolean;
  onTaskClick: () => void;
  projects: Project[];
  scopeLabel?: { name: string; color: string };
  isReorderMode?: boolean;
}

const SortableTaskItem = ({
  task,
  onUpdate,
  onEditTask,
  onEditTaskImages,
  onEditTaskDates,
  onAssignTask,
  onRequestChanges,
  onDismissChangeRequest,
  onDeleteTask,
  globalViewMode,
  isIndividuallyExpanded,
  onTaskClick,
  projects,
  scopeLabel,
  isReorderMode,
}: SortableTaskItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto' as any,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-0">
      {isReorderMode && (
        <div
          {...attributes}
          {...listeners}
          className="lg-grip flex items-center px-1 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground transition-colors rounded-l-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <TaskListItem
          task={task}
          onUpdate={onUpdate}
          onEditTask={onEditTask}
          onEditTaskImages={onEditTaskImages}
          onEditTaskDates={onEditTaskDates}
          onAssignTask={onAssignTask}
          onRequestChanges={onRequestChanges}
          onDismissChangeRequest={onDismissChangeRequest}
          onDeleteTask={onDeleteTask}
          globalViewMode={globalViewMode}
          isIndividuallyExpanded={isIndividuallyExpanded}
          onTaskClick={onTaskClick}
          projects={projects}
          scopeLabel={scopeLabel}
        />
      </div>
    </div>
  );
};

export const DraggableTaskList = ({
  tasks,
  onUpdate,
  onBatchUpdate,
  onEditTask,
  onEditTaskImages,
  onEditTaskDates,
  onAssignTask,
  onRequestChanges,
  onDismissChangeRequest,
  onDeleteTask,
  globalViewMode,
  expandedTaskIds,
  onTaskClick,
  projects,
  getScopeLabel,
  isReorderMode,
}: DraggableTaskListProps) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Group tasks by priority (already sorted by sort_order from parent)
  const groupedTasks = useMemo(() => {
    const groups: Record<TaskPriority, Task[]> = {
      urgent: [],
      high: [],
      medium: [],
      low: [],
    };
    tasks.forEach((task) => {
      groups[task.priority].push(task);
    });
    return groups;
  }, [tasks]);

  // Flat ordered list of all task IDs for SortableContext
  const allTaskIds = useMemo(() => {
    const ids: string[] = [];
    PRIORITY_ORDER.forEach((priority) => {
      groupedTasks[priority].forEach((task) => ids.push(task.id));
    });
    return ids;
  }, [groupedTasks]);

  // Find which priority group a task ID belongs to
  const findPriorityGroup = (taskId: string): TaskPriority | null => {
    for (const priority of PRIORITY_ORDER) {
      if (groupedTasks[priority].some((t) => t.id === taskId)) {
        return priority;
      }
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    const overTask = tasks.find((t) => t.id === over.id);
    if (!activeTask || !overTask) return;

    const activePriority = activeTask.priority;
    const overPriority = overTask.priority;

    if (activePriority === overPriority) {
      // Within same priority group — reorder
      const group = [...groupedTasks[activePriority]];
      const oldIndex = group.findIndex((t) => t.id === active.id);
      const newIndex = group.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(group, oldIndex, newIndex);
      // Assign new sort_order values
      const updates: Task[] = reordered.map((t, i) => ({
        ...t,
        sortOrder: i,
      }));

      if (onBatchUpdate) {
        onBatchUpdate(updates);
      } else {
        // Fallback: update each individually
        updates.forEach((t) => onUpdate(t));
      }
    } else {
      // Cross-priority — change priority and insert at the drop position
      const targetGroup = [...groupedTasks[overPriority]];
      const overIndex = targetGroup.findIndex((t) => t.id === over.id);
      
      // Insert the moved task into the target group at the right position
      const movedTask = { ...activeTask, priority: overPriority };
      targetGroup.splice(overIndex, 0, movedTask);

      // Re-assign sort_order for the target group
      const updates: Task[] = targetGroup.map((t, i) => ({
        ...t,
        sortOrder: i,
      }));

      // Also re-assign sort_order for the source group (task was removed)
      const sourceGroup = groupedTasks[activePriority].filter((t) => t.id !== active.id);
      const sourceUpdates: Task[] = sourceGroup.map((t, i) => ({
        ...t,
        sortOrder: i,
      }));

      if (onBatchUpdate) {
        onBatchUpdate([...updates, ...sourceUpdates]);
      } else {
        [...updates, ...sourceUpdates].forEach((t) => onUpdate(t));
      }
    }
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  const hasTasks = PRIORITY_ORDER.some((p) => groupedTasks[p].length > 0);
  if (!hasTasks) return null;

  /**
   * The ghost. It MUST be portalled to <body>.
   *
   * DragOverlay renders `position: fixed`, and dnd-kit measures that node with
   * getClientRect to build its collision rect (core.esm.js: draggingNodeRect =
   * dragOverlay.rect ?? activeNodeRect -> collisionRect). Left in place, the
   * overlay's nearest ancestor is `.lg-content`, which carries `backdrop-filter`
   * — and a backdrop-filter box is a containing block for fixed descendants.
   * The ghost therefore laid out relative to that panel's origin instead of the
   * viewport, so it rendered offset from the finger AND fed dnd-kit a collision
   * rect ~207px (desktop) / ~73px (phone) below the finger, which is why the
   * drop landed on the wrong row. There is NO transformed ancestor anywhere in
   * the chain — backdrop-filter alone is the containing block that broke it.
   * document.body has no such ancestor, so both symptoms go with the portal.
   */
  const overlay = (
    <DragOverlay modifiers={[restrictToVerticalAxis]}>
      {activeTask ? (
        <div className="opacity-90 shadow-xl rounded-lg">
          <TaskListItem
            task={activeTask}
            onUpdate={() => {}}
            globalViewMode={globalViewMode}
            isIndividuallyExpanded={false}
            onTaskClick={() => {}}
            projects={projects}
            scopeLabel={getScopeLabel?.(activeTask)}
          />
        </div>
      ) : null}
    </DragOverlay>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={allTaskIds} strategy={verticalListSortingStrategy}>
        {/* Derived during render, never patched by an effect: while reorder mode
            is on the list is unselectable, so iOS cannot raise its selection
            loupe/highlight over the rows mid-drag. */}
        <div className={`flex flex-col gap-1${isReorderMode ? ' lg-reorder-lock' : ''}`}>
          {PRIORITY_ORDER.map((priority) => {
            const tasksInGroup = groupedTasks[priority];
            if (tasksInGroup.length === 0) return null;

            const { label, color } = PRIORITY_LABELS[priority];

            return (
              <div key={priority}>
                <div className="flex items-center gap-2.5 py-1.5 px-2 lg-phead">
                  <div className={`text-[11px] font-extrabold uppercase tracking-[.12em] ${color} lg-prio-${priority}`}>
                    {label}
                  </div>
                  <div className="flex-1 h-px bg-border lg-phead-line" />
                  <span className="text-[11px] font-bold text-muted-foreground">{tasksInGroup.length}</span>
                </div>
                <div className="flex flex-col gap-2 lg-rows">
                  {tasksInGroup.map((task) => (
                    <SortableTaskItem
                      key={task.id}
                      task={task}
                      onUpdate={onUpdate}
                      onEditTask={onEditTask}
                      onEditTaskImages={onEditTaskImages}
                      onEditTaskDates={onEditTaskDates}
                      onAssignTask={onAssignTask}
                      onRequestChanges={onRequestChanges}
                      onDismissChangeRequest={onDismissChangeRequest}
                      onDeleteTask={onDeleteTask}
                      globalViewMode={globalViewMode}
                      isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                      onTaskClick={() => onTaskClick(task.id)}
                      projects={projects}
                      scopeLabel={getScopeLabel?.(task)}
                      isReorderMode={isReorderMode}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SortableContext>

      {typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay}
    </DndContext>
  );
};
