'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Children, cloneElement, ReactElement, useState } from 'react';

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
              <div key={index} className="relative">
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
                {item.isRecording && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse z-50" />
                )}
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
