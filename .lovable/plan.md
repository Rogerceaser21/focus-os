# Brain Dump: Fix Move/Update/Remove Reliability + Add Date Support

## Summary of Changes

Two files need to change: `src/hooks/useBrainDumpLive.ts` and `src/components/BrainDumpLiveDialog.tsx`.

---

## File 1: `src/hooks/useBrainDumpLive.ts`

### 1. Update `BrainDumpTask` interface — add date fields

Add three optional date string fields (stored as ISO strings like `"2026-02-22"`):

```
startDate?: string;
endDate?: string;
dueDate?: string;
```

---

### 2. Update System Instruction

Three additions to the system prompt:

**A — Today's date context** (so Gemini can resolve relative dates):
```
Today's date is: 2026-02-19 (Wednesday).
When the user mentions relative dates like "next Friday", "end of the month", "in 3 days", convert them to ISO format (YYYY-MM-DD).
```

**B — Date extraction rules** (added to TASK EXTRACTION RULES):
```
- If the user mentions a start date, end date, or due date, extract it as an ISO date (YYYY-MM-DD).
- Include start_date, end_date, and/or due_date in any task creation or update call.
```

**C — Move rule** (added to CORRECTION RULES — this is the most important fix):
```
- If the user asks to MOVE a task from one place to another, use the move_task tool with the task_id you received when that task was created. Do NOT simulate a move by calling add_task + remove_task. That causes duplicates.
- If the user says "actually put that in [project]" or "move [task] to [project]", this is always a move_task call.
- For update_task and remove_task: always use task_id if you have it. Only fall back to searchPhrase if you do not have the task_id.
```

---

### 3. Add date parameters to all task-creation tool definitions

For `add_task_to_today`, `add_task_to_project`, and `create_project_and_add_task`, add three new optional properties:
```
start_date: { type: STRING, description: 'Task start date in ISO format (YYYY-MM-DD)' }
end_date:   { type: STRING, description: 'Task end date in ISO format (YYYY-MM-DD)' }
due_date:   { type: STRING, description: 'Task due date in ISO format (YYYY-MM-DD)' }
```

---

### 4. Add `task_id` parameter to `update_task` and `remove_task`

**`update_task` — new parameters:**
```
task_id:     { type: STRING, description: 'The exact task_id returned when the task was created. Use this for precise matching.' }
searchPhrase: kept as optional fallback
destination: { type: STRING, description: 'New destination: today, existing-project, or new-project — use move_task instead for this' }
start_date, end_date, due_date: new optional date fields
```

**`remove_task` — new parameter:**
```
task_id: { type: STRING, description: 'The exact task_id returned when the task was created. Use this for precise matching.' }
searchPhrase: kept as optional fallback
```

Change `required` on `remove_task` from `['searchPhrase']` to `[]` — so Gemini can supply either `task_id` or `searchPhrase`.

---

### 5. Add new `move_task` tool definition

```
name: 'move_task'
description: 'Move an existing task to a different destination or project. Use this instead of add+remove when the user wants to move a task.'
parameters:
  task_id:      required — the task_id returned at creation
  destination:  required — 'today', 'existing-project', or 'new-project'
  project_name: optional — name of the project to move the task to
```

---

### 6. Update all tool handlers

**All creation handlers (`add_task_to_today`, `add_task_to_project`, `create_project_and_add_task`):**
- Capture `args.start_date`, `args.end_date`, `args.due_date` and store them on the `BrainDumpTask` object.

**`update_task` handler:**
- If `args.task_id` is present → find task by exact ID match.
- If not → fall back to `searchPhrase` text search (current behaviour).
- Also handle `args.start_date`, `args.end_date`, `args.due_date` updates.

**`remove_task` handler:**
- If `args.task_id` is present → filter by exact ID match.
- If not → fall back to `searchPhrase` text search (current behaviour).

**New `move_task` handler:**
- Find task by `args.task_id`.
- Determine new destination from `args.destination`.
- If `existing-project`: look up `args.project_name` in `projectsRef.current` (case-insensitive match) to get `projectId`.
- If `new-project`: register in `newProjectsRef` for grouping.
- Update the task in state: change `destination`, `projectName`, `projectId`.
- Return `{ result: 'ok', task_id: args.task_id }` to Gemini.

---

## File 2: `src/components/BrainDumpLiveDialog.tsx`

### 7. Pass dates through in `handleSave`

In the `tasksToInsert` map, add:
```typescript
...(task.startDate ? { start_date: new Date(task.startDate).toISOString() } : {}),
...(task.endDate   ? { end_date:   new Date(task.endDate).toISOString()   } : {}),
...(task.dueDate   ? { due_date:   new Date(task.dueDate).toISOString()   } : {}),
```

Note: For tasks with `destination === 'today'`, the current code sets `due_date` to today's date. With this change, if Gemini extracted an explicit `due_date` it takes priority; otherwise today's date is still used as the fallback for today-tasks.

### 8. Update `handleTaskUpdate` to pass dates back

When `TaskListItem` calls `onUpdate`, also map `updatedTask.startDate`, `endDate`, `dueDate` back to the `BrainDumpTask` store.

---

## What This Fixes

| Problem | Fix Applied |
|---|---|
| Move creates duplicate instead of moving | New `move_task` tool + system prompt rule explicitly forbidding add+remove simulation |
| `remove_task` deletes wrong task | `task_id` exact match takes priority over fuzzy `searchPhrase` |
| `update_task` doesn't change project | `move_task` handles project/destination changes; `update_task` gains ID-based matching for title/priority/description/dates |
| Gemini doesn't set dates | All creation + update tools gain `start_date`, `end_date`, `due_date` params + system prompt with today's date |
| Model unchanged | Staying on `gemini-2.5-flash-native-audio-preview-12-2025` with `Modality.AUDIO` — no change |

---

# Meeting Summary & Outline Improvements

## Problem
- Outlines are far too detailed for short meetings (e.g. a 2-min recording gets 6+ sections with 4+ bullets each)
- Markdown formatting leaks through (`**bold**`, `#` headers) into the UI
- No way to re-summarize old meetings
- No user control over detail level

## Prompting Strategy

### Duration-Aware Defaults
| Duration | Max Sections | Max Bullets/Section | Default Level |
|----------|-------------|---------------------|---------------|
| < 5 min  | 2-3         | 1-3                 | concise       |
| 5-30 min | 3-5         | 2-4                 | concise       |
| 30+ min  | 5-8         | 3-5                 | standard      |

### Detail Levels
- **concise**: Only key decisions, action items, and major topics. Ruthlessly cut fluff. Each heading gets 1-3 short bullets.
- **standard**: Main discussion points and conclusions. 3-5 bullets per section. Include context where helpful.
- **detailed**: Thorough capture of discussion nuances, supporting arguments, and side points. No hard limit.

### Prompt Template (for outline generation)
```
Analyze this meeting transcript and provide a structured summary.
Today's date: {today}. Meeting duration: {duration_minutes} minutes.

Detail level: {detail_level} ({description}).

CRITICAL RULES:
- Do NOT use any markdown formatting. No bold (**), no italic (*), no headers (#). Plain text only.
- For "{detail_level}" level: max {max_sections} outline sections, max {max_bullets} bullets per section.
- Focus on SIGNAL over noise. What decisions were made? What actions are needed? What are the key takeaways?
- Omit filler, small talk, and repetitive points.
- Overview should be {overview_length} for a {duration_minutes}-minute meeting.

Return JSON: { "overview": "...", "outline": [{ "heading": "...", "points": ["..."] }] }
```

### Overview Length Scaling
- < 5 min: 1-2 sentences
- 5-30 min: 2-4 sentences
- 30+ min: 3-6 sentences

## Implementation Plan

### File 1: `supabase/functions/process-meeting/index.ts`

1. **Add `detailLevel` parameter** to request body parsing (default: auto-select based on duration)
2. **Add `resummarize` flag** — when true, fetch existing transcript from GCS and re-summarize only (skip audio upload/transcription)
3. **Replace hardcoded summary prompt** with the duration-aware tiered prompt template above
4. **Strip markdown** from Gemini output as a safety net (remove `**`, `*`, `#` prefixes)

### File 2: `src/pages/MeetingDetail.tsx`

1. **Add `- Detail` / `+ Detail` buttons** inline in the Outline section header
   - Use compact text for mobile: `- Detail` and `+ Detail`
   - Three states: concise ↔ standard ↔ detailed
   - Show current level as a small label between buttons (e.g. "Concise")
2. **Add "Re-summarize" button** in the overview/outline area
   - Clicking either detail button OR the re-summarize button triggers a call to `process-meeting` with `resummarize: true` and the chosen `detailLevel`
3. **Strip markdown** from rendered outline text (safety net on frontend too)
4. **Loading state** while re-summarizing

### Mobile Considerations
- Buttons use `size="sm"` with icon + short text
- Detail controls sit inline with the "OUTLINE" header
- Layout uses `flex-wrap` so buttons wrap below heading on very narrow screens
