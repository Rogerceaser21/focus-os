import { useState, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, Project, TaskPriority } from '@/types/task';
import { TaskListItem } from '@/components/TaskListItem';
import { GripVertical } from 'lucide-react';

interface DraggableTaskListProps {
  tasks: Task[];
  onUpdate: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  globalViewMode: 'full' | 'compact';
  expandedTaskIds: Set<string>;
  onTaskClick: (taskId: string) => void;
  projects: Project[];
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
  globalViewMode: 'full' | 'compact';
  isIndividuallyExpanded: boolean;
  onTaskClick: () => void;
  projects: Project[];
}

const SortableTaskItem = ({
  task,
  onUpdate,
  onEditTask,
  globalViewMode,
  isIndividuallyExpanded,
  onTaskClick,
  projects,
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
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex items-center px-1 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground transition-colors rounded-l-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </div>
      {/* Task Item */}
      <div className="flex-1 min-w-0">
        <TaskListItem
          task={task}
          onUpdate={onUpdate}
          onEditTask={onEditTask}
          globalViewMode={globalViewMode}
          isIndividuallyExpanded={isIndividuallyExpanded}
          onTaskClick={onTaskClick}
          projects={projects}
        />
      </div>
    </div>
  );
};

export const DraggableTaskList = ({
  tasks,
  onUpdate,
  onEditTask,
  globalViewMode,
  expandedTaskIds,
  onTaskClick,
  projects,
}: DraggableTaskListProps) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  // Group tasks by priority
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

    // If dropped onto a task with a different priority, change the dragged task's priority
    if (activeTask.priority !== overTask.priority) {
      onUpdate({ ...activeTask, priority: overTask.priority });
    }
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  // Check if there are any tasks at all
  const hasTasks = PRIORITY_ORDER.some((p) => groupedTasks[p].length > 0);
  if (!hasTasks) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={allTaskIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1">
          {PRIORITY_ORDER.map((priority) => {
            const tasksInGroup = groupedTasks[priority];
            if (tasksInGroup.length === 0) return null;

            const { label, color } = PRIORITY_LABELS[priority];

            return (
              <div key={priority}>
                {/* Priority Group Header */}
                <div className="flex items-center gap-2 py-1.5 px-2">
                  <div className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
                    {label}
                  </div>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">{tasksInGroup.length}</span>
                </div>
                {/* Tasks */}
                <div className="flex flex-col gap-2">
                  {tasksInGroup.map((task) => (
                    <SortableTaskItem
                      key={task.id}
                      task={task}
                      onUpdate={onUpdate}
                      onEditTask={onEditTask}
                      globalViewMode={globalViewMode}
                      isIndividuallyExpanded={expandedTaskIds.has(task.id)}
                      onTaskClick={() => onTaskClick(task.id)}
                      projects={projects}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SortableContext>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask ? (
          <div className="opacity-90 shadow-xl rounded-lg">
            <TaskListItem
              task={activeTask}
              onUpdate={() => {}}
              globalViewMode={globalViewMode}
              isIndividuallyExpanded={false}
              onTaskClick={() => {}}
              projects={projects}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
