# Cap transcription segments at 30 chunks (GCS compose limit)

## Problem
`segmentChunksFor` returns round(600 / chunkSeconds). With 10 s chunks that is ~60 chunks, but GCS compose takes at most 32 sources, so the iPhone meeting failed with "53 sources exceeds the GCS limit of 32".

## Changes

### 1. `supabase/functions/_shared/segments.ts`
- Add `export const MAX_SEGMENT_CHUNKS = 30` and `export const GCS_COMPOSE_MAX_SOURCES = 32`.
- `segmentChunksFor(chunkSeconds)` becomes `Math.min(MAX_SEGMENT_CHUNKS, Math.max(1, Math.round(600 / chunkSeconds)))`.
- Add `planNeedsReplan(state)`: true when there is no plan, or `state.segmentChunks` is not a positive number or is above `MAX_SEGMENT_CHUNKS`.

### 2. `supabase/functions/focusos-transcribe-meeting/index.ts`
- Planning condition (line ~476): change `if (!state || typeof state.total !== "number")` to `if (planNeedsReplan(state))`. A stored plan with segmentChunks 53 is then thrown away and rebuilt from the chunk count and duration with the cap. Old segment texts are dropped as well, because their indexes belong to the old plan. A log line notes the replan. The Retry branch below it only runs for valid plans, so nothing changes there.
- `runSegment`: just before `composeObjects`, if `sources.length > GCS_COMPOSE_MAX_SOURCES`, throw `Segment i+1/total has N sources; GCS compose allows at most 32`. With the cap this should never happen.
- Nothing else changes: chunkSeconds, AAC/WebM handling, leases and timing stay as they are.

### 3. `supabase/functions/_shared/segments_test.ts`, new tests
- segmentChunksFor(10) = 30, segmentChunksFor(9.9) = 30, segmentChunksFor(30) = 20.
- A 53-chunk plan with segmentChunksFor(10) gives 2 segments (chunks 0–29 and 30–52). Compose sources are at most 30 for AAC and at most 32 for WebM (30 + init + lead).
- segmentStartSeconds(1, 30, 10) = 300, so the marker reads 00:05:00.
- planNeedsReplan is true for null, for segmentChunks 53 and for a missing segmentChunks, and false for 30 and 20.

## Deploy
- Run the Deno tests for segments, then type-check.
- Redeploy `focusos-transcribe-meeting` and `focusos-poll-stuck-meetings` (the poller imports segments.ts).
- No migration and no client code change.

## Verification
- Tests above pass.
- Igor clicks Retry on the failed iPhone meeting. I then read (read-only) the function logs and the meeting row. I expect to see "53 chunks -> 2 segments" (or the replan line), two compose calls and a finished transcript.
