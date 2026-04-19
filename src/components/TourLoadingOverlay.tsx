import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface TourLoadingOverlayProps {
  /** Tour name to display, e.g. "Tasks Tour". Null/undefined hides the overlay. */
  label: string | null;
}

/**
 * Fullscreen loading overlay shown briefly while a tour is being launched
 * (e.g. waiting for the sidebar Sheet to close before the spotlight measures).
 * Rendered via portal so it sits above any closing Sheet/backdrop.
 */
export const TourLoadingOverlay = ({ label }: TourLoadingOverlayProps) => {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {label && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          style={{ zIndex: 100001 }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-5 shadow-2xl"
          >
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <div className="text-center">
              <div className="text-sm font-semibold text-foreground">
                Loading {label}…
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Setting things up for you
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
