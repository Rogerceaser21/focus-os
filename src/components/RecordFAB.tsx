import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface RecordFABProps {
  onBrainDump?: () => void;
  /** If provided, called instead of navigating to /meetings?new=true */
  onMeeting?: () => void;
  /** Compact mode: hide expand menu, only double-tap-to-home works. */
  compact?: boolean;
}

const DOUBLE_TAP_DELAY = 300;

const RecordFAB: React.FC<RecordFABProps> = ({ onBrainDump, onMeeting, compact = false }) => {
  const [fabExpanded, setFabExpanded] = useState(false);
  const navigate = useNavigate();
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMainClick = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastTapRef.current;
    lastTapRef.current = now;

    if (elapsed < DOUBLE_TAP_DELAY) {
      // Double-tap → go home
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      setFabExpanded(false);
      navigate('/home');
      return;
    }

    if (compact) {
      // Compact mode: single tap → brain dump (debounced so a double-tap to home wins).
      if (!onBrainDump) return;
      tapTimerRef.current = setTimeout(() => {
        onBrainDump();
      }, DOUBLE_TAP_DELAY);
      return;
    }

    // Wait to see if a second tap comes
    tapTimerRef.current = setTimeout(() => {
      setFabExpanded(prev => !prev);
    }, DOUBLE_TAP_DELAY);
  }, [navigate, compact]);

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {fabExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99] bg-black/20"
            onClick={() => setFabExpanded(false)}
          />
        )}
      </AnimatePresence>

      <div
        className="fixed right-6 z-[100]"
        style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}
        data-tour-step="menu-fab"
      >
        {/* Brain Dump button - appears above */}
        <AnimatePresence>
          {fabExpanded && (
            <motion.button
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: 1, y: -66, scale: 1 }}
              exit={{ opacity: 0, y: 0, scale: 0.8, transition: { duration: 0.15, ease: 'easeOut' } }}
              transition={{ type: 'spring', duration: 0.45, bounce: 0.25 }}
              className="absolute bottom-[6px] right-[6px] w-[44px] h-[44px] rounded-full bg-card border-2 border-border shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
              onClick={() => {
                setFabExpanded(false);
                onBrainDump();
              }}
            >
              {/* mini orb — same visual language as the Home brain-dump orb */}
              <span
                aria-hidden
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: 'radial-gradient(circle at 40% 35%, #ffffff, #e3e6ea)',
                  border: '1.5px solid rgba(20, 24, 40, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: 'radial-gradient(circle at 38% 32%, #ff5a52, #c81e1e 70%)',
                    boxShadow: '0 1px 4px rgba(200, 30, 30, 0.5)',
                  }}
                />
              </span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Record Meeting button - appears to the left */}
        <AnimatePresence>
          {fabExpanded && (
            <motion.button
              initial={{ opacity: 0, x: 0, scale: 0.8 }}
              animate={{ opacity: 1, x: -66, scale: 1 }}
              exit={{ opacity: 0, x: 0, scale: 0.8, transition: { duration: 0.15, ease: 'easeOut' } }}
              transition={{ type: 'spring', duration: 0.45, bounce: 0.25, delay: 0.05 }}
              className="absolute bottom-[6px] right-[6px] w-[44px] h-[44px] rounded-full bg-card border-2 border-border shadow-lg flex items-center justify-center hover:scale-110 transition-transform"
              onClick={() => {
                setFabExpanded(false);
                if (onMeeting) {
                  onMeeting();
                } else {
                  navigate('/meetings?new=true');
                }
              }}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-primary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Main record button */}
        <motion.button
          animate={{ rotate: fabExpanded ? 45 : 0 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
          onClick={handleMainClick}
          className="relative w-[56px] h-[56px] rounded-full flex items-center justify-center lg-fab-main"
        >
          <div
            className="rounded-full transition-all duration-200"
            style={{
              width: 14,
              height: 14,
              backgroundColor: 'hsl(var(--destructive))',
            }}
          />
        </motion.button>
      </div>
    </>
  );
};

export default RecordFAB;
