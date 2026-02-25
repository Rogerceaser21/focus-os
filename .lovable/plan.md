
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
- Outlines capture too much — repeating points, including filler, not distinguishing signal from noise
- Markdown formatting leaks through (`**bold**`, `#` headers) into the UI
- No way to re-summarize old meetings
- No user control over detail level
- Meeting name not always displayed (stale closure bug)

## Prompting Strategy

### Core Principle: Signal Over Noise (NOT duration-based)
The prompt must instruct Gemini to **think like an executive assistant**:
- What were the KEY DECISIONS made?
- What ACTION ITEMS came out of this?
- What are the 2-3 MAIN TOPICS discussed?
- Ignore filler, small talk, repeated points, and tangential comments.
- NEVER repeat the same point under different headings.
- Each bullet should convey a UNIQUE piece of information.

Duration is used only as a soft guardrail (fewer sections for shorter meetings), NOT as the primary quality signal.

### Detail Levels
- **concise** (default): Only decisions, action items, and key takeaways. Each heading gets 1-3 SHORT bullets. Merge related points. Ruthlessly cut anything that doesn't change understanding.
- **standard**: Add supporting context and discussion points. 2-5 bullets per section. Still no repetition.
- **detailed**: Thorough capture including nuances, disagreements, and supporting arguments. No hard limit on bullets but still NO repetition.

### Duration as Soft Guardrail
| Duration | Suggested Max Sections |
|----------|----------------------|
| < 5 min  | 2-3                  |
| 5-30 min | 3-5                  |
| 30+ min  | 5-8                  |

### Prompt Template
```
Analyze this meeting transcript and provide a structured summary.

Detail level: {detail_level}.

CRITICAL RULES:
1. Think like an executive assistant. Extract ONLY what matters: decisions, action items, key topics.
2. Do NOT repeat information. If a point was made once, it appears once — in the most relevant section.
3. Each bullet must convey a UNIQUE piece of information. Merge similar points.
4. Omit filler, greetings, small talk, and tangential comments entirely.
5. Do NOT use any markdown formatting. No **bold**, no *italic*, no # headers. Plain text only.
6. Headings should be short descriptive labels (3-6 words), not full sentences.
7. For "concise": max {max_sections} sections, 1-3 bullets each. Only decisions and actions.
8. For "standard": max {max_sections} sections, 2-5 bullets each. Add key context.
9. For "detailed": up to {max_sections} sections, thorough but never redundant.
10. Overview: {overview_guidance}

Return JSON: { "overview": "...", "outline": [{ "heading": "...", "points": ["..."] }] }
```

### Overview Guidance
- concise: "1-2 sentences. What happened and what's next."
- standard: "2-4 sentences. Key topics, decisions, and outcomes."
- detailed: "3-6 sentences. Comprehensive executive summary."

## Implementation Plan

### File 1: `supabase/functions/process-meeting/index.ts`

1. **Add `detailLevel` parameter** to request body parsing (values: "concise" | "standard" | "detailed", default: "concise")
2. **Add `resummarize` flag** — when true, accept `transcript` and `meetingId` instead of audio. Re-run summary prompt only, update the meeting record, return new summary.
3. **Replace hardcoded summary prompt** with the signal-over-noise tiered prompt template above
4. **Strip markdown** from Gemini output as a safety net (remove `**`, `*`, `#` prefixes from text)
5. **Use `durationSeconds`** only for soft section-count guardrails, not as the primary quality driver

### File 2: `src/pages/MeetingDetail.tsx`

1. **Add `- Detail` / `+ Detail` buttons** inline in the Outline section header
   - Compact text for mobile: `- Detail` and `+ Detail`
   - Three states: concise ↔ standard ↔ detailed
   - Show current level label between buttons (e.g. "Concise")
   - Clicking a detail button triggers re-summarize with new level
2. **Add standalone "Re-summarize" button** (for regenerating at current detail level)
3. **Strip markdown** from rendered outline/overview text (frontend safety net: remove `**`, `*`, `##` etc.)
4. **Loading state** spinner/skeleton while re-summarizing
5. **Display meeting title** prominently — use the user-entered name, not the auto-generated timestamp fallback

### File 3: `src/pages/Meetings.tsx`

6. **Verify meeting name capture** — ensure `useRef` pattern is correctly passing the user-entered meeting name to `process-meeting`. The stale closure fix (using refs for meetingName, participants, recordingSeconds) must be confirmed working.

### Mobile Considerations
- Detail buttons use `size="sm"` with short text (`- Detail` / `+ Detail`)
- Controls sit inline with "OUTLINE" header using `flex-wrap` for narrow screens
- Re-summarize button is full-width on mobile
