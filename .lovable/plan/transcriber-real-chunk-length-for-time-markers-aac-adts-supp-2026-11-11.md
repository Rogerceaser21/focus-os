# Transcriber: real chunk length for time markers + AAC (ADTS) support

Scope: `supabase/functions/_shared/segments.ts`, `_shared/segments_test.ts`, `focusos-transcribe-meeting/index.ts`. No migration, no `src/`, no change to upload/start-session/get-audio/process-meeting. Lease, poller logic, self-kick and timing caps untouched.

## Confirmed current state
- `SEGMENT_CHUNKS = 20` hard-coded in index.ts (line 74); planning block at ~477-500 uses it.
- `segmentStartSeconds` / `joinTranscript` already accept a `chunkSeconds` param (default 30) but index.ts never passes it (lines 676, 803).
- `const mimeType = "audio/webm"` at line 475; used for init/lead uploads, compose, Gemini upload and `transcribeSegment`.
- Sniff at line 561: `if (state.format !== "webm")` + `isWebm`; `SegmentsState.format?: "webm"`.
- Cleanup deletes `init.webm` + `segments/` via per-object try/catch (a missing init just logs a warning, already non-fatal).
- `focusos-poll-stuck-meetings` imports `../_shared/segments.ts` (leaseIsValid, SegmentsState, etc.).

## Changes

### `_shared/segments.ts`
- `SegmentsState`: add `chunkSeconds?: number`; widen `format?: "webm" | "aac"`.
- New pure helpers (testable):
  - `chunkSecondsFor(durationSeconds, chunkCount)`: `duration/chunkCount` when duration is a positive finite number and chunkCount > 0, else 30; clamped to [1, 120].
  - `segmentChunksFor(chunkSeconds)`: `max(1, round(600 / chunkSeconds))` (30 s -> 20).
  - `isAdts(bytes)`: length >= 2, `b[0] === 0xFF && (b[1] & 0xF6) === 0xF0`.
  - `mimeForFormat(format)`: `"aac"` -> `"audio/aac"`, otherwise `"audio/webm"`.
- Existing functions unchanged.

### `focusos-transcribe-meeting/index.ts`
1. Fresh plan block: `chunkSeconds = chunkSecondsFor(meeting.duration_seconds, chunkCount)`, `segmentChunks = segmentChunksFor(chunkSeconds)`; persist both in state. `SEGMENT_CHUNKS` constant removed (or kept only as documentation-free fallback; 30 s still yields 20).
2. Sniff (b2): run when `state.format` is neither `"webm"` nor `"aac"`. WebM magic -> `format: "webm"`; else ADTS -> `format: "aac"`; else throw the existing readable error (wording extended to "supports WebM or AAC only"). Log line names the detected format.
3. `mimeType` becomes `mimeForFormat(state.format)`, computed after the sniff; used for compose, Gemini upload, `transcribeSegment` and the remaining `uploadToGcs` calls (transcript.json keeps `application/json`).
4. `runSegment`: init-object + lead-cluster block runs only when `state.format === "webm"`; for `"aac"` sources = the plan's chunk objects only. Segment object names keep `.webm`; contentType = `mimeType`.
5. Pass `state.chunkSeconds ?? 30` to `segmentStartSeconds(...)` (prompt start time) and `joinTranscript(...)` (markers). Old rows without `chunkSeconds` stay on 30 s.
6. Cleanup: for `"aac"` skip `initObjectName` in targets (avoids a spurious 404 warning); WebM unchanged.

### `_shared/segments_test.ts` (new tests)
- `chunkSecondsFor`: (1200, 120) -> 10; (null/0, n) -> 30; clamp low/high.
- `segmentChunksFor`: 10 -> 60; 30 -> 20.
- `planSegments(120, 60)` -> 2 segments; `joinTranscript` with chunkSeconds 10, segmentChunks 60 -> markers `00:00:00` and `00:10:00`.
- `segmentStartSeconds(1, 20)` default still 600 (old-row behaviour).
- `isAdts`: `FF F1 ...` and `FF F9 ...` pass; EBML, mp4 `ftyp`, `FF FB` (MP3), short/empty fail.
- `mimeForFormat`: aac -> audio/aac, webm/undefined -> audio/webm.

## Verification and deploy
- Run `deno test supabase/functions/_shared/` (segments + timing tests).
- Deploy `focusos-transcribe-meeting` and `focusos-poll-stuck-meetings` (the poller imports `segments.ts`; its behaviour does not change, redeploy keeps bundles consistent). No other function.
- Post-deploy: empty-body POST to transcriber still returns its 400 contract.

## Note
The Gemini File API is expected to accept `audio/aac`; first real iPhone recording will be the live confirmation (not testable without one).
