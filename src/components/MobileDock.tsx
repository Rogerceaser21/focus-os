'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { DockItem } from './Dock';

interface MobileDockProps {
  items: DockItem[];
}

export default function MobileDock({ items }: MobileDockProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleItemClick = (item: DockItem, e?: React.MouseEvent<HTMLElement>) => {
    item.onClick(e);
    setIsOpen(false);
  };

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-[90]"
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Slide-in Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 bottom-0 top-0 w-20 bg-background/95 backdrop-blur-lg border-l border-border z-[100] flex flex-col items-center justify-center gap-6 py-8"
          >
            {items.map((item, index) => (
              <motion.button
                key={index}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={(e) => handleItemClick(item, e)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted/50 transition-colors ${item.className || ''}`}
                {...(item.tourStepId ? { 'data-tour-step': item.tourStepId } : {})}
              >
                <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-muted/50">
                  {item.icon}
                </div>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {item.permanentLabel || item.label}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB Button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg z-[100] flex items-center justify-center"
        whileTap={{ scale: 0.95 }}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X className="w-6 h-6" />
            </motion.div>
          ) : (
            <motion.div
              key="menu"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Menu className="w-6 h-6" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}
