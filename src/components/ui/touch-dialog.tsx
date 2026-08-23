import * as React from "react";

import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * TOUCH-SAFE DIALOG (O6, 2026-08-23) — the house primitive behind every dialog
 * that holds a text field.
 *
 * O4 sim-bisected the mechanism on the iPhone16-P4-393 iOS 26.3 rig: Radix's
 * MODAL dialog path installs react-remove-scroll, whose non-passive document
 * 'touchmove' listener preventDefault()s an iOS selection-handle drag, so a
 * selection inside the dialog could not be grown or shrunk (selection went
 * [47,51] -> [47,51] modal, [47,51] -> [47,64] non-modal, and back to no growth
 * when react-remove-scroll was added to the non-modal arm). O4 shipped the cure
 * for the Edit Task sheet only; this file is that cure turned into a primitive
 * so every other dialog with a field gets it, on phones AND on any coarse
 * pointer (iPad, where useIsMobile is false and the modal path used to win).
 *
 * Use it exactly like the house Dialog:
 *
 *   <TouchDialog open={open} onOpenChange={setOpen}>
 *     <TouchDialogContent className="max-w-md">…</TouchDialogContent>
 *   </TouchDialog>
 *
 * DialogHeader / DialogTitle / DialogDescription / DialogFooter are unchanged
 * and keep coming from '@/components/ui/dialog'.
 *
 * Laws this file is written against:
 *  - render-phase: the mode is DERIVED DURING RENDER, never corrected by an
 *    effect. The only effect here is the body-class add/remove, with cleanup.
 *  - Radix: nothing is forceMount-ed, and body pointer-events is never left
 *    locked (the non-modal path never locks it at all).
 *  - iOS layer birth: the dim reuses the stock .lg-overlay keyframes and its
 *    data-state; no new mount animation is introduced.
 */

type DialogProps = React.ComponentPropsWithoutRef<typeof Dialog>;
type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogContent>;

interface TouchDialogState {
  /** true when this dialog is running the non-modal, touch-safe path. */
  touchSafe: boolean;
  /** identifies THIS dialog's hand-rendered dim, so a stacked sheet's dim can
   *  never dismiss the sheet underneath it (see onInteractOutside below). */
  sheetId: string;
}

const TouchDialogContext = React.createContext<TouchDialogState | null>(null);

const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Touch-safe when the viewport is a phone OR the primary pointer is coarse.
 *  Read during render on purpose: `useIsMobile` already re-renders on width
 *  changes, and a device's primary pointer type does not change at runtime, so
 *  no listener and no effect is needed for the second half. Guarded for a
 *  non-browser render, which falls back to the stock modal dialog. */
function useTouchSafe(): boolean {
  const isMobile = useIsMobile();
  if (isMobile) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

/* How many touch-safe dialogs are open right now. Sheets STACK (the Edit Task
   sheet opens Share, Handoff and the Google Calendar picker on top of itself),
   and a plain add/remove would strip the scroll lock off <body> the moment the
   TOP one closed, leaving the sheet underneath scrollable behind. Counted
   instead: the class goes on at the first, and comes off only at the last. */
let openTouchSheets = 0;

const TouchDialog = ({ children, ...props }: DialogProps) => {
  const touchSafe = useTouchSafe();
  const sheetId = React.useId();
  const open = props.open === true;

  /* modal={false} takes Radix's scroll lock with it, so the page behind would
     scroll under the sheet. This class is the replacement: plain
     overflow: hidden on <body>, no listener of any kind. Removed on close AND
     on unmount, so nothing can ever be left stranded on the body. */
  React.useEffect(() => {
    if (!touchSafe || !open) return;
    openTouchSheets += 1;
    document.body.classList.add("lg-sheet-open");
    return () => {
      openTouchSheets = Math.max(0, openTouchSheets - 1);
      if (openTouchSheets === 0) document.body.classList.remove("lg-sheet-open");
    };
  }, [touchSafe, open]);

  const value = React.useMemo<TouchDialogState>(() => ({ touchSafe, sheetId }), [touchSafe, sheetId]);

  if (!touchSafe) {
    // Stock modal dialog, untouched: same Radix Root, same props.
    return (
      <TouchDialogContext.Provider value={value}>
        <Dialog {...props}>{children}</Dialog>
      </TouchDialogContext.Provider>
    );
  }

  return (
    <TouchDialogContext.Provider value={value}>
      {/* NON-MODAL ON PURPOSE — see the file header for the sim bisect. */}
      <Dialog {...props} modal={false}>
        {/* Radix's own <DialogOverlay> renders NULL when modal is false, so the
            house dim is hand-rendered here with DialogOverlay's exact classes
            and its data-state, which the .lg-overlay fade keyframes key off. It
            gets its own portal, created BEFORE the content's, so the sheet
            still paints above it at the same z-index — and when two sheets
            stack, the later sheet's portals are appended later, so its dim sits
            above the sheet beneath it and its content above its own dim.
            touch-action: none (see .lg-sheet-overlay in index.css) stops a
            touch on the dim panning the page behind, which is the one thing the
            dropped scroll lock used to do, and it costs no JS listener. A
            pointer down on the dim is still "outside" to DismissableLayer, so
            tapping it closes the sheet exactly as it did when modal. */}
        <DialogPortal>
          <div
            aria-hidden="true"
            data-sheet-overlay={sheetId}
            data-state={open ? "open" : "closed"}
            className="lg-overlay lg-sheet-overlay fixed inset-0 z-[110] bg-background/60 backdrop-blur-sm"
          />
        </DialogPortal>
        {children}
      </Dialog>
    </TouchDialogContext.Provider>
  );
};
TouchDialog.displayName = "TouchDialog";

const TouchDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogContent>,
  DialogContentProps
>(({ onInteractOutside, ...props }, ref) => {
  const state = React.useContext(TouchDialogContext);

  if (!state?.touchSafe) {
    return <DialogContent ref={ref} onInteractOutside={onInteractOutside} {...props} />;
  }

  const { sheetId } = state;

  return (
    /* WHAT DISMISSES THE SHEET, and why this handler exists at all.
       DismissableLayer guards its POINTER path with isPointerEventsEnabled, so
       a tap inside a nested modal layer (a Select, an AlertDialog) cannot
       dismiss us. Its FOCUS path has NO such guard: the modal branch of Radix's
       Dialog silences it with onFocusOutside preventDefault, the non-modal
       branch does not. Without this, focusing the Share dialog's recipient
       field (or any nested portal) dismissed the sheet underneath and detached
       the dialog mid-interaction, which tests/share-status-live.spec.ts caught.
       The same hole would let a tap in a date Popover, which is NOT a
       pointer-events-disabling layer, close the whole sheet.
       One rule covers all of it: only THIS sheet's own dim dismisses it; every
       other outside interaction is ignored. Matching the dim by id, not merely
       by the attribute, is what keeps a stacked sheet honest — tapping the
       dim of the dialog on top must close that dialog and leave the sheet
       underneath open. Escape is untouched and still closes, and Radix only
       lets the highest layer act on it. */
    <DialogContent
      ref={ref}
      {...props}
      data-sheet-mode="nonmodal"
      onInteractOutside={(event) => {
        onInteractOutside?.(event);
        if (event.defaultPrevented) return;
        const target = event.target as Element | null;
        const dim = target?.closest?.("[data-sheet-overlay]") ?? null;
        if (dim?.getAttribute("data-sheet-overlay") !== sheetId) event.preventDefault();
      }}
    />
  );
});
TouchDialogContent.displayName = "TouchDialogContent";

export { TouchDialog, TouchDialogContent };
