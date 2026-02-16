

# Brain Dump -- Real-Time with Gemini Live

## What This Does

Replaces the current two-step "record then process" flow with a real-time experience where tasks appear on screen as you speak, powered by Gemini 2.5 Flash Live API.

### Current Flow (being replaced)
1. User clicks "Record" and speaks
2. User clicks "Stop"
3. Audio is sent to Whisper for transcription
4. Transcription is sent to Gemini for task extraction
5. Tasks appear all at once

### New Flow ("Brain Dump")
1. User clicks "Start Brain Dump" -- mic opens, WebSocket connects to Gemini Live
2. User speaks freely -- tasks appear in real-time as Gemini identifies them via function calling
3. User clicks "Done" -- reviews/edits tasks, then saves

## Prerequisites

A **Google AI API key** (Gemini API key) is required. You can get one free at https://aistudio.google.com/apikeys. I'll prompt you to provide it before any coding begins.

## Implementation Steps

### 1. Store the Gemini API Key
- Add `GEMINI_API_KEY` as a backend secret

### 2. Create a new backend function: `brain-dump-live`
- This edge function acts as a **WebSocket proxy** between the browser and Gemini Live API
- Receives audio chunks from the client over a WebSocket
- Forwards them to Gemini Live (`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`)
- Configures Gemini with function declarations (`add_task`, `update_task`, `remove_task`) so it calls tools as the user speaks
- Streams tool call results (new tasks) back to the client in real-time
- Uses `response_modalities: ["TEXT"]` (no audio output needed -- we just want the structured task data)

### 3. Replace the three Brain Dump dialogs with a unified `BrainDumpDialog`
- Single dialog component used in all contexts (new project, existing project, today's to-do)
- A `mode` prop controls behavior: `"new-project"` | `"existing-project"` | `"today"`
- UI layout:
  - Top: "Listening..." indicator with animated waveform/pulse
  - Middle: Live task list that grows as Gemini sends `add_task` tool calls -- tasks animate in
  - Bottom: "Done" button to stop, then "Save" to confirm
- Real-time updates: each `add_task` tool call from Gemini immediately appends a task card with animation
- After stopping, user can edit/remove tasks before saving (same review UI as today)

### 4. Client-side WebSocket hook: `useBrainDumpLive`
- Manages microphone capture (MediaRecorder or raw PCM via AudioWorklet)
- Opens WebSocket to the `brain-dump-live` edge function
- Streams audio chunks to the backend
- Receives structured task events (`add_task`, `update_task`, `remove_task`) and updates local state
- Exposes: `{ isConnected, isListening, tasks, start, stop }`

### 5. Update `Index.tsx`
- Replace imports of `BrainDumpDialog`, `TaskOnlyBrainDumpDialog`, and `TodayBrainDumpDialog` with the single new `BrainDumpDialog`
- Pass appropriate `mode` prop based on context

### 6. Clean up
- Remove `TaskOnlyBrainDumpDialog.tsx` and `TodayBrainDumpDialog.tsx`
- The old `transcribe-audio` and `extract-tasks` edge functions remain available (used elsewhere or as fallback)

## Technical Details

### Gemini Live WebSocket Protocol
- Connection URL: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`
- Model: `gemini-2.5-flash-live` (or latest available live model)
- Audio format: 16-bit PCM, 16kHz, mono
- Function declarations sent in the setup message define `add_task(title, description, priority)` so Gemini calls this tool as it recognizes tasks in speech
- The edge function relays tool calls back to the client as JSON messages

### Edge Function Architecture

```text
Browser (mic audio)
    |
    | WebSocket
    v
brain-dump-live (Edge Function)
    |
    | WebSocket (with API key)
    v
Gemini Live API
    |
    | tool_call: add_task(...)
    v
brain-dump-live
    |
    | JSON event: { type: "add_task", task: {...} }
    v
Browser (renders task card in real-time)
```

### Audio Capture
- Use `AudioContext` + `AudioWorkletNode` to capture raw PCM at 16kHz
- Convert to base64 chunks and send over WebSocket
- This avoids the MediaRecorder format compatibility issues

### Fallback
- If WebSocket connection fails or Gemini Live is unavailable, fall back to the existing record-then-process flow with a toast notification

