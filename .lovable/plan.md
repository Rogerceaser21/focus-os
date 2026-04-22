

### Aesthetics-only pass — Hand-off to AI icon + row button polish

**Scope: visual only. No functional/logic changes to the hand-off feature itself.**

---

#### 1. Build a custom "Hand → AI" SVG icon

- Create `src/components/icons/HandToAI.tsx` — a React component that returns an inline SVG
- Design: a horizontal **hand with the index finger extended pointing right**, and the letters **"AI"** to the right of the fingertip
- Built as a single SVG with `currentColor` stroke so it inherits text color from parent (works in all themes — Cream, dark, etc.)
- Accepts standard icon props (`className`, `size`, `strokeWidth`) so it behaves like a Lucide icon
- Default `strokeWidth={2}` to match Lucide defaults
- Two render modes via a prop:
  - `variant="full"` → hand + "AI" text inside the SVG (used in Edit Task pane header)
  - `variant="hand"` → hand only, no text (used in compact mobile row)
  - `variant="text"` → just stylized "AI" letters (fallback for ultra-tight spots — optional)

#### 2. Replace Sparkles everywhere it was added for hand-off

| Location | Current | New |
|---|---|---|
| `EditTaskDialog.tsx` header button | `<Sparkles>` | `<HandToAI variant="full">` (desktop) / `variant="hand"` (mobile) |
| `HandoffToAIDialog.tsx` title icon | `<Sparkles>` | `<HandToAI variant="full">` |
| Any other spot Sparkles was added for this feature | — | `<HandToAI>` |

The dialog's internal "Sparkles" usage (only the hand-off-related ones) gets swapped. Other unrelated sparkles in the codebase (if any) stay.

#### 3. Add the hand-off button to the **task row** (TaskListItem / TaskCard)

- Place it **immediately to the left of the Edit (pencil) button** in the row's action cluster
- Mobile: render `<HandToAI variant="hand">` only, same icon size as pencil/X/play
- Desktop: same — keep it compact in row context (full variant lives in the Edit pane only)
- Wire the click to open the existing `HandoffToAIDialog` with that row's task (this is the only "logic" touch — it's just hooking up the existing dialog, no new behavior)

#### 4. Fix the row button spacing & stroke weight

In `TaskListItem.tsx` (and `TaskCard.tsx` if it has the same row):
- Reduce the gap between the action icons — change current `gap-2` / `gap-3` (whatever it is) down to `gap-0.5` or `gap-1`, and shrink each button's padding (e.g. `h-8 w-8` → `h-7 w-7`, or remove inner padding on the icon button so the icons sit close)
- Audit the X button: confirm it uses the same `<X>` from `lucide-react` at the same size/strokeWidth as `<Pencil>` and `<Play>`. If it's currently a different icon (e.g. a thin `XIcon` from elsewhere), replace with `<X strokeWidth={2} className="h-4 w-4">` to match
- Keep the visual order: **[HandToAI] [Edit ✏️] [X] [Play ▷]**

#### 5. Files touched

| File | Change |
|---|---|
| `src/components/icons/HandToAI.tsx` | NEW — custom SVG icon component |
| `src/components/EditTaskDialog.tsx` | Swap Sparkles → HandToAI |
| `src/components/HandoffToAIDialog.tsx` | Swap Sparkles → HandToAI in dialog title |
| `src/components/TaskListItem.tsx` | Add HandToAI button left of Edit; tighten gap; normalize X stroke |
| `src/components/TaskCard.tsx` | Same row treatment if it has the same action cluster |

#### 6. Out of scope (per your instruction)
- No changes to the hand-off **functionality**, prompt builder, voice flow, image flow, or settings — purely the icon swap and row aesthetics
- We'll address functional issues in a follow-up once you list them

---

#### Open question before I touch anything

**The custom Hand→AI icon — how literal do you want it?**

a. **Pictographic & polished**: a clean line-drawn hand silhouette with index finger extended right, "AI" in a matching stroke weight to its right — feels like a custom Lucide icon
b. **Minimalist/abstract**: a simple arrow-like hand glyph (just a finger shape, not a full hand) pointing at "AI" — more iconographic, less illustrative
c. **Generated as a real SVG asset by an image gen** (transparent PNG) instead of hand-coded SVG — richer detail but won't recolor with theme

I recommend **(a)** — hand-coded SVG, line-drawn, currentColor — because it themes correctly and stays crisp at any size. Confirm a/b/c and I'll start.

