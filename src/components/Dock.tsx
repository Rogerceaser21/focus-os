'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Children, cloneElement, ReactElement, useState } from 'react';
import { Mic } from 'lucide-react';

import './Dock.css';

interface DockItemProps {
  children: ReactElement;
  className?: string;
  onClick?: (e?: React.MouseEvent<HTMLElement>) => void;
  baseItemSize: number;
}

function DockItem({ children, className = '', onClick, baseItemSize }: DockItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        width: baseItemSize,
        height: baseItemSize
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      onClick={(e) => onClick?.(e as any)}
      className={`dock-item ${className}`}
      tabIndex={0}
      role="button"
      aria-haspopup="true"
    >
      {Children.map(children, child => cloneElement(child, { isHovered } as any))}
    </div>
  );
}

interface DockLabelProps {
  children: React.ReactNode;
  className?: string;
  isHovered?: boolean;
}

function DockLabel({ children, className = '', isHovered }: DockLabelProps) {
  return (
    <AnimatePresence>
      {isHovered && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={`dock-label ${className}`}
          role="tooltip"
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DockIconProps {
  children: React.ReactNode;
  className?: string;
}

function DockIcon({ children, className = '' }: DockIconProps) {
  return <div className={`dock-icon ${className}`}>{children}</div>;
}

export interface DockItem {
  icon: React.ReactNode;
  label: string;
  permanentLabel?: string;
  onClick: (e?: React.MouseEvent<HTMLElement>) => void;
  className?: string;
  isRecording?: boolean;
  tourStepId?: string;
}

interface DockProps {
  items: DockItem[];
  className?: string;
  panelHeight?: number;
  baseItemSize?: number;
}

export default function Dock({
  items,
  className = '',
  panelHeight = 68,
  baseItemSize = 50
}: DockProps) {
  return (
    <div style={{ height: panelHeight, scrollbarWidth: 'none' }} className="dock-outer">
      <div
        className={`dock-panel ${className}`}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        <div className="flex flex-col items-center gap-2 h-full">
          <div className="flex items-center justify-center gap-3 flex-1">
            {items.map((item, index) => (
              <div 
                key={index} 
                className="relative"
                {...(item.tourStepId ? { 'data-tour-step': item.tourStepId } : {})}
              >
                <DockItem
                  onClick={item.onClick}
                  className={item.className}
                  baseItemSize={baseItemSize}
                >
                  <>
                    <DockIcon>{item.icon}</DockIcon>
                    <DockLabel>{item.label}</DockLabel>
                  </>
                </DockItem>
                {item.permanentLabel && item.permanentLabel !== 'Settings' && (() => {
                  const getBadgeColors = (label: string) => {
                    switch (label) {
                      case '+Projects': return { bg: 'bg-blue-950 border-blue-800', icon: 'text-blue-400' };
                      case '+Tasks': return { bg: 'bg-green-950 border-green-800', icon: 'text-green-400' };
                      case '+Today': return { bg: 'bg-purple-950 border-purple-800', icon: 'text-purple-400' };
                      default: return { bg: 'bg-red-950 border-red-800', icon: 'text-red-400' };
                    }
                  };
                  const colors = getBadgeColors(item.permanentLabel);
                  return (
                    <span className={`absolute -top-1 -right-1 w-4 h-4 ${colors.bg} border rounded-full z-50 pointer-events-none flex items-center justify-center`}>
                      <Mic className={`w-2.5 h-2.5 ${colors.icon}`} />
                    </span>
                  );
                })()}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 pb-2" style={{ width: `${baseItemSize * items.length + (items.length - 1) * 12}px` }}>
            {items.map((item, index) => (
              <div 
                key={index} 
                className="dock-permanent-label"
                style={{ width: baseItemSize }}
              >
                {item.permanentLabel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
