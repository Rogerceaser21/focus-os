import * as React from "react";

import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetPortal } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * TOUCH-SAFE OVERLAY SURFACES (O6, 2026-08-23) — the house primitives behind
 * every dialog and bottom sheet that holds a text field.
 *
 * O4 sim-bisected the mechanism on the iPhone16-P4-393 iOS 26.3 rig: Radix's
 * MODAL path (Dialog and Sheet alike — sheet.tsx IS @radix-ui/react-dialog)
 * installs react-remove-scroll, whose non-passive document 'touchmove' listener
 * preventDefault()s an iOS selection-handle drag, so a selection inside the
 * surface could not be grown or shrunk (selection went [47,51] -> [47,51]
 * modal, [47,51] -> [47,64] non-modal, and back to no growth when
 * react-remove-scroll was added to the non-modal arm). O4 shipped the cure for
 * the Edit Task sheet only; this file is that cure turned into primitives so
 * every other surface with a field gets it, on phones AND on any coarse pointer
 * (iPad, where useIsMobile is false and the modal path used to win).
 *
 * Two surfaces, one mechanism:
 *
 *   <TouchDialog open={open} onOpenChange={setOpen}>
 *     <TouchDialogContent className="max-w-md">…</TouchDialogContent>
 *   </TouchDialog>
 *
 *   <TouchSheet open={open} onOpenChange={setOpen}>
 *     <TouchSheetContent side="bottom" className="lg-onebar-sheet">…</TouchSheetContent>
 *   </TouchSheet>
 *
 * DialogHeader / SheetHeader / …Title / …Description / …Footer are unchanged and
 * keep coming from '@/components/ui/dialog' and '@/components/ui/sheet'.
 *
 * Laws this file is written against:
 *  - render-phase: the mode is DERIVED DURING RENDER, never corrected by an
 *    effect. The only effect here is the body-class add/remove, with cleanup.
 *  - Radix: nothing is forceMount-ed, and body pointer-events is never left
 *    locked (the non-modal path never locks it at all).
 *  - iOS layer birth: each dim reuses its own stock overlay classes and their
 *    keyframes, keyed off data-state; no new mount animation is introduced.
 */

/* ── the decision ────────────────────────────────────────────────────────── */

const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Touch-safe when the viewport is a phone OR the primary pointer is coarse.
 *  Read during render on purpose: `useIsMobile` already re-renders on width
 *  changes, and a device's primary pointer type does not change at runtime, so
 *  no listener and no effect is needed for the second half. Guarded for a
 *  non-browser render, which falls back to the stock modal surface. */
function useTouchSafe(): boolean {
  const isMobile = useIsMobile();
  if (isMobile) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

interface TouchSurfaceState {
  /** true when this surface is running the non-modal, touch-safe path. */
  touchSafe: boolean;
  /** identifies THIS surface's hand-rendered dim, so a stacked surface's dim can
   *  never dismiss the one underneath it (see ownDimOnly below). */
  surfaceId: string;
}

const TouchSurfaceContext = React.createContext<TouchSurfaceState | null>(null);

/* ── the shared mechanism ────────────────────────────────────────────────── */

/* How many touch-safe surfaces are open right now. They STACK (the Edit Task
   sheet opens Share, Handoff and the Google Calendar picker on top of itself),
   and a plain add/remove would strip the scroll lock off <body> the moment the
   TOP one closed, leaving the surface underneath scrollable behind. Counted
   instead: the class goes on at the first, and comes off only at the last. */
let openTouchSurfaces = 0;

/** modal={false} takes Radix's scroll lock with it, so the page behind would
 *  scroll under the surface. `body.lg-sheet-open` is the replacement: plain
 *  overflow: hidden, no listener of any kind. Removed on close AND on unmount,
 *  so nothing can ever be left stranded on the body. */
function useBodyScrollLock(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    openTouchSurfaces += 1;
    document.body.classList.add("lg-sheet-open");
    return () => {
      openTouchSurfaces = Math.max(0, openTouchSurfaces - 1);
      if (openTouchSurfaces === 0) document.body.classList.remove("lg-sheet-open");
    };
  }, [active]);
}

/** The hand-rendered dim. Radix's own Overlay renders NULL when modal is false
 *  (both Dialog and Sheet), so the house dim is rebuilt here with that
 *  overlay's exact classes and its data-state, which the stock fade keyframes
 *  key off. It gets its own portal, created BEFORE the content's, so the
 *  surface still paints above it at the same z-index — and when two surfaces
 *  stack, the later one's portals are appended later, so its dim sits above the
 *  surface beneath it and its content above its own dim. touch-action: none
 *  (see .lg-sheet-overlay in index.css) stops a touch on the dim panning the
 *  page behind, which is the one thing the dropped scroll lock used to do, and
 *  it costs no JS listener. A pointer down on the dim is still "outside" to
 *  DismissableLayer, so tapping it closes the surface exactly as it did when
 *  modal. */
const TouchDim = ({
  Portal,
  surfaceId,
  open,
  className,
}: {
  Portal: typeof DialogPortal;
  surfaceId: string;
  open: boolean;
  className: string;
}) => (
  <Portal>
    <div
      aria-hidden="true"
      data-sheet-overlay={surfaceId}
      data-state={open ? "open" : "closed"}
      className={className}
    />
  </Portal>
);

/** WHAT DISMISSES A TOUCH-SAFE SURFACE, and why this handler exists at all.
 *  DismissableLayer guards its POINTER path with isPointerEventsEnabled, so a
 *  tap inside a nested modal layer (a Select, an AlertDialog) cannot dismiss us.
 *  Its FOCUS path has NO such guard: the modal branch of Radix's Dialog silences
 *  it with onFocusOutside preventDefault, the non-modal branch does not. Without
 *  this, focusing the Share dialog's recipient field (or any nested portal)
 *  dismissed the sheet underneath and detached the dialog mid-interaction, which
 *  tests/share-status-live.spec.ts caught. The same hole would let a tap in a
 *  date Popover, which is NOT a pointer-events-disabling layer, close the whole
 *  surface.
 *  One rule covers all of it: only THIS surface's own dim dismisses it; every
 *  other outside interaction is ignored. Matching the dim by id, not merely by
 *  the attribute, is what keeps a stack honest — tapping the dim of the surface
 *  on top must close that one and leave the surface underneath open. Escape is
 *  untouched and still closes, and Radix only lets the highest layer act on it. */
type InteractOutsideHandler = NonNullable<
  React.ComponentPropsWithoutRef<typeof DialogContent>["onInteractOutside"]
>;
type InteractOutsideEvent = Parameters<InteractOutsideHandler>[0];

const ownDimOnly =
  (surfaceId: string, caller?: InteractOutsideHandler): InteractOutsideHandler =>
  (event: InteractOutsideEvent) => {
    caller?.(event);
    if (event.defaultPrevented) return;
    const target = event.target as Element | null;
    const dim = target?.closest?.("[data-sheet-overlay]") ?? null;
    if (dim?.getAttribute("data-sheet-overlay") !== surfaceId) event.preventDefault();
  };

/* ── DIALOG ──────────────────────────────────────────────────────────────── */

type DialogProps = React.ComponentPropsWithoutRef<typeof Dialog>;
type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogContent>;

/** DialogOverlay's own classes, plus the touch-action rule. */
const DIALOG_DIM = "lg-overlay lg-sheet-overlay fixed inset-0 z-[110] bg-background/60 backdrop-blur-sm";

const TouchDialog = ({ children, ...props }: DialogProps) => {
  const touchSafe = useTouchSafe();
  const surfaceId = React.useId();
  const open = props.open === true;
  useBodyScrollLock(touchSafe && open);

  const value = React.useMemo<TouchSurfaceState>(() => ({ touchSafe, surfaceId }), [touchSafe, surfaceId]);

  if (!touchSafe) {
    // Stock modal dialog, untouched: same Radix Root, same props.
    return (
      <TouchSurfaceContext.Provider value={value}>
        <Dialog {...props}>{children}</Dialog>
      </TouchSurfaceContext.Provider>
    );
  }

  return (
    <TouchSurfaceContext.Provider value={value}>
      {/* NON-MODAL ON PURPOSE — see the file header for the sim bisect. */}
      <Dialog {...props} modal={false}>
        <TouchDim Portal={DialogPortal} surfaceId={surfaceId} open={open} className={DIALOG_DIM} />
        {children}
      </Dialog>
    </TouchSurfaceContext.Provider>
  );
};
TouchDialog.displayName = "TouchDialog";

const TouchDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogContent>,
  DialogContentProps
>(({ onInteractOutside, ...props }, ref) => {
  const state = React.useContext(TouchSurfaceContext);

  if (!state?.touchSafe) {
    return <DialogContent ref={ref} onInteractOutside={onInteractOutside} {...props} />;
  }

  return (
    <DialogContent
      ref={ref}
      {...props}
      data-sheet-mode="nonmodal"
      onInteractOutside={ownDimOnly(state.surfaceId, onInteractOutside)}
    />
  );
});
TouchDialogContent.displayName = "TouchDialogContent";

/* ── SHEET ───────────────────────────────────────────────────────────────── */

type SheetProps = React.ComponentPropsWithoutRef<typeof Sheet>;
type SheetContentProps = React.ComponentPropsWithoutRef<typeof SheetContent>;

/** SheetOverlay's own classes (including its fade keyframes), plus the
 *  touch-action rule. Kept in sync with src/components/ui/sheet.tsx. */
const SHEET_DIM =
  "fixed inset-0 z-50 bg-background/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg-sheet-overlay";

/** The Sheet twin of TouchDialog. Same decision, same dim, same body lock, same
 *  dismiss rule — only the stock overlay classes and the portal differ, so the
 *  side="bottom" slide classes and the .lg-onebar-sheet styling stay exactly as
 *  the house SheetContent renders them. Reach for this when a bottom sheet holds
 *  a text field (the one-bar context sheet's "Rename project" Input is the case
 *  that forced it: on the iOS 26.3 sim the O4 gesture died there, [3,10] to
 *  [3,10], because the modal Sheet still carried react-remove-scroll). */
const TouchSheet = ({ children, ...props }: SheetProps) => {
  const touchSafe = useTouchSafe();
  const surfaceId = React.useId();
  const open = props.open === true;
  useBodyScrollLock(touchSafe && open);

  const value = React.useMemo<TouchSurfaceState>(() => ({ touchSafe, surfaceId }), [touchSafe, surfaceId]);

  if (!touchSafe) {
    return (
      <TouchSurfaceContext.Provider value={value}>
        <Sheet {...props}>{children}</Sheet>
      </TouchSurfaceContext.Provider>
    );
  }

  return (
    <TouchSurfaceContext.Provider value={value}>
      <Sheet {...props} modal={false}>
        <TouchDim Portal={SheetPortal} surfaceId={surfaceId} open={open} className={SHEET_DIM} />
        {children}
      </Sheet>
    </TouchSurfaceContext.Provider>
  );
};
TouchSheet.displayName = "TouchSheet";

const TouchSheetContent = React.forwardRef<
  React.ElementRef<typeof SheetContent>,
  SheetContentProps
>(({ onInteractOutside, ...props }, ref) => {
  const state = React.useContext(TouchSurfaceContext);

  if (!state?.touchSafe) {
    return <SheetContent ref={ref} onInteractOutside={onInteractOutside} {...props} />;
  }

  return (
    <SheetContent
      ref={ref}
      {...props}
      data-sheet-mode="nonmodal"
      onInteractOutside={ownDimOnly(state.surfaceId, onInteractOutside)}
    />
  );
});
TouchSheetContent.displayName = "TouchSheetContent";

export { TouchDialog, TouchDialogContent, TouchSheet, TouchSheetContent };
