# Hand off to AI — full plan

## Goal

A "Hand off to AI" button on tasks that builds a high-quality prompt from the task (title + description + images + user-supplied context), opens the user's chosen AI provider in a new tab with the prompt prefilled, and remembers their default provider.

## User flow

```text
[Task open in EditTaskDialog]
           |
   click "Hand off to AI" (sparkle icon)
           |
[Hand-off modal opens]
  - Shows preview of task title + description
  - Field: "What are you trying to accomplish?" (textarea)
  - 🎤 Speaker button → record voice → transcribe → AI cleans up → fills field
  - Image strip: each task image with toggle (include / exclude)
  - Provider picker (ChatGPT / Claude / Gemini / Perplexity)
    - First-ever use → asks "Pick your default provider" → saved
    - Subsequent uses → defaults to saved choice, still switchable
  - Image delivery toggle: [● Public link  ○ Copy to clipboard]
  - "Preview prompt" expandable section (read-only)
           |
   click "Hand off"
           |
[Open AI or Gemini builds final prompt (figure out a good cost effective AI model that will do this for us - DO NOT USE LOVABLE AI]
  - Combines task data + user context into a clean, structured prompt
  - Returns optimized prompt text
           |
[Open provider in new tab with ?q=<prompt>]
  - If prompt > 6k chars → copy to clipboard, open blank chat, toast
  - If images=clipboard mode → copy first image, chain toasts for rest
```

## Features

### 1. Provider deep-links

- ChatGPT: `https://chat.openai.com/?q=`
- Claude: `https://claude.ai/new?q=`
- Gemini: `https://gemini.google.com/app?q=`
- Perplexity: `https://www.perplexity.ai/search?q=`

### 2. Default provider memory

- New column `ai_handoff_default_provider TEXT NULL` on `focusos_user_preferences`.
- New column `ai_handoff_image_mode TEXT DEFAULT 'public_link'` (values: `public_link` | `clipboard` | `skip`).
- First use → modal forces a provider pick before continuing, saves it.
- Settings dialog gets a small "AI Hand-off" section to change defaults later.

### 3. Voice → transcribe → cleanup → context field

- Use the same button we are using for "brain dump" feature instead of the "mic" button on the "What are you trying to accomplish?" textarea.
- Reuse existing `useVoiceRecorder` hook + `focusos-transcribe-audio` edge function.
- After transcript returns, send through Lovable AI gateway with prompt: *"Clean up this dictation into clear written context. Keep the user's intent, fix grammar, remove filler."* Result lands in the textarea, editable.

### 4. Prompt builder [Open AI or Gemini builds final prompt (figure out a good cost effective AI model that will do this for us - DO NOT USE LOVABLE AI]

- New edge function `focusos-build-ai-handoff-prompt`.
- Input: `{ task: {title, description, priority, dueDate, projectName}, userContext, imageUrls[] }`.
- Uses `google/gemini-2.5-flash` via Lovable AI gateway (you can explain to me what this is otherwise don't use it).
- System prompt: *"You convert a task + user context into a high-quality prompt for an AI assistant. Output the prompt only, no preamble. Structure: Goal → Context → Task details → Specific request → Constraints. Reference attached images by description if URLs provided."*
- Returns optimized prompt string.

### 5. Images — three modes (user-toggleable, default `public_link`)

- **public_link**: Embed `focusos-task-images` public URLs directly in prompt. ChatGPT + Gemini will see them. Note in prompt: "Images attached as URLs above — please view them."
- **clipboard**: Prompt mentions images exist; after opening provider tab, sequentially copy each image to clipboard via `ClipboardItem`, with toasts ("Image 1/3 copied — paste, then click here for next").
- **skip**: No image references at all.

### 6. URL length safety

- If final URL > 6000 chars → copy full prompt to clipboard, open provider with short stub (`?q=See%20clipboard`), toast: *"Prompt copied — paste into the chat."*

## Where the button lives

- **Task title line** — primary location, next to Trash icon. Sparkle icon (`lucide/Sparkles`).
- &nbsp;

## Backend changes

### Migration

```sql
ALTER TABLE focusos_user_preferences
  ADD COLUMN ai_handoff_default_provider TEXT NULL,
  ADD COLUMN ai_handoff_image_mode TEXT NOT NULL DEFAULT 'public_link';
```

### New edge function

- `supabase/functions/focusos-build-ai-handoff-prompt/index.ts` — calls Lovable AI gateway, returns `{ prompt: string }`.

### Reused

- `focusos-transcribe-audio` for voice context input.
- `focusos-task-images` bucket (already public) for image URLs.

## Frontend changes


| File                                   | Change                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| `src/components/HandoffToAIDialog.tsx` | NEW — the modal described above                              |
| `src/lib/aiHandoff.ts`                 | NEW — providers map, prompt-length checks, clipboard helpers |
| `src/components/EditTaskDialog.tsx`    | Add Sparkles button in header; opens HandoffToAIDialog       |
| `src/hooks/useUserPreferences.ts`      | Surface new fields, save default on first pick               |
| `src/components/SettingsDialog.tsx`    | Add "AI Hand-off" section (default provider + image mode)    |


## Out of scope (explicit)

- No real OAuth into ChatGPT/Claude/Gemini — they don't offer it.
- No syncing AI responses back into the task.
- No row-action button on cards (v1 — can add later).

## Open questions before coding

1. **Image mode default** — `public_link` (auto, image URLs in prompt) or `clipboard` (manual paste, more private)? fine
2. **Voice cleanup model** — `gemini-2.5-flash` (fast/cheap, recommended) or `gemini-2.5-pro` (smarter)? Ill go with your reccomended option "flash"
3. **Should the "What are you trying to accomplish?" field be required**, or skippable for tasks that already have rich descriptions? Skippable i guess
4. **Provider list** — keep all 4 (ChatGPT, Claude, Gemini, Perplexity), or trim? I already said all 4