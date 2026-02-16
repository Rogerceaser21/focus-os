

# Fix: Handle Binary Audio Messages from Gemini Live

## Problem

When `responseModalities` is `["AUDIO"]`, Gemini sends two types of WebSocket messages:
- **Binary Blobs** -- audio data (which we don't need)
- **JSON strings** -- setup confirmations, tool calls (`add_task`, etc.)

The current code tries to `JSON.parse(event.data)` on every message, including binary Blobs, causing `SyntaxError: "[object Blob]" is not valid JSON`. This crashes the message handler, so `setupComplete` is never processed, and the UI stays stuck on "Connecting..."

## Fix (single file change)

**File:** `src/hooks/useBrainDumpLive.ts`

In the `ws.onmessage` handler (line 151-232), add an early return at the top to skip Blob messages:

```typescript
ws.onmessage = (event) => {
  try {
    // Skip binary audio data — we only care about JSON (tool calls)
    if (typeof event.data !== 'string') return;

    const msg = JSON.parse(event.data);
    // ... rest stays the same
```

That's it. One guard clause. Binary audio gets ignored, JSON tool calls get processed, tasks appear in real-time.

