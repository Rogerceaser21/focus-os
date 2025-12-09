import React from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

export const ProjectsIcon: React.FC<IconProps> = ({ className = "w-8 h-8", size }) => {
  const style = size ? { width: size, height: size } : undefined;
  
  return (
    <svg 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      {/* Folder body */}
      <path 
        d="M8 18C8 15.7909 9.79086 14 12 14H24L28 18H52C54.2091 18 56 19.7909 56 22V50C56 52.2091 54.2091 54 52 54H12C9.79086 54 8 52.2091 8 50V18Z" 
        fill="white" 
        stroke="#1a1a1a" 
        strokeWidth="2"
      />
      {/* Folder tab */}
      <path 
        d="M8 18C8 15.7909 9.79086 14 12 14H24L28 18H8V18Z" 
        fill="#E5E7EB" 
        stroke="#1a1a1a" 
        strokeWidth="2"
      />
      {/* Microphone */}
      <g transform="translate(32, 28)">
        <rect x="4" y="0" width="8" height="14" rx="4" fill="#3B82F6" stroke="#1a1a1a" strokeWidth="1.5"/>
        <path d="M2 10C2 10 2 16 8 16C14 16 14 10 14 10" stroke="#1a1a1a" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <line x1="8" y1="16" x2="8" y2="20" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="4" y1="20" x2="12" y2="20" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round"/>
      </g>
      {/* Plus badge */}
      <circle cx="52" cy="14" r="10" fill="#3B82F6" stroke="#1a1a1a" strokeWidth="1.5"/>
      <line x1="52" y1="9" x2="52" y2="19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="47" y1="14" x2="57" y2="14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
};

export const TodayIcon: React.FC<IconProps> = ({ className = "w-8 h-8", size }) => {
  const style = size ? { width: size, height: size } : undefined;
  
  return (
    <svg 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      {/* Calendar body */}
      <rect x="8" y="14" width="40" height="44" rx="4" fill="white" stroke="#1a1a1a" strokeWidth="2"/>
      {/* Calendar header */}
      <rect x="8" y="14" width="40" height="12" rx="4" fill="#A855F7"/>
      <rect x="8" y="22" width="40" height="4" fill="#A855F7"/>
      {/* Calendar rings */}
      <line x1="18" y1="10" x2="18" y2="18" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="38" y1="10" x2="38" y2="18" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Calendar grid - 5x4 dots */}
      {[0, 1, 2, 3, 4].map((col) =>
        [0, 1, 2, 3].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={14 + col * 7}
            y={32 + row * 6}
            width="4"
            height="4"
            rx="1"
            fill="#D1D5DB"
          />
        ))
      )}
      {/* Microphone */}
      <g transform="translate(42, 32)">
        <rect x="2" y="0" width="7" height="12" rx="3.5" fill="#A855F7" stroke="#1a1a1a" strokeWidth="1.2"/>
        <path d="M0 8C0 8 0 13 5.5 13C11 13 11 8 11 8" stroke="#1a1a1a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <line x1="5.5" y1="13" x2="5.5" y2="16" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="2.5" y1="16" x2="8.5" y2="16" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
      </g>
      {/* Plus badge */}
      <circle cx="52" cy="14" r="10" fill="#A855F7" stroke="#1a1a1a" strokeWidth="1.5"/>
      <line x1="52" y1="9" x2="52" y2="19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="47" y1="14" x2="57" y2="14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
};

export const TasksIcon: React.FC<IconProps> = ({ className = "w-8 h-8", size }) => {
  const style = size ? { width: size, height: size } : undefined;
  
  return (
    <svg 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      {/* Clipboard body */}
      <rect x="10" y="12" width="36" height="48" rx="4" fill="white" stroke="#1a1a1a" strokeWidth="2"/>
      {/* Clipboard clip */}
      <rect x="20" y="8" width="16" height="10" rx="2" fill="#E5E7EB" stroke="#1a1a1a" strokeWidth="2"/>
      <rect x="24" y="6" width="8" height="4" rx="1" fill="#84CC16" stroke="#1a1a1a" strokeWidth="1"/>
      {/* List items */}
      <circle cx="18" cy="28" r="3" fill="#84CC16"/>
      <line x1="24" y1="28" x2="40" y2="28" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/>
      
      <circle cx="18" cy="38" r="3" fill="#84CC16"/>
      <line x1="24" y1="38" x2="40" y2="38" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/>
      
      <circle cx="18" cy="48" r="3" fill="#84CC16"/>
      <line x1="24" y1="48" x2="40" y2="48" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/>
      
      {/* Microphone */}
      <g transform="translate(40, 30)">
        <rect x="2" y="0" width="7" height="12" rx="3.5" fill="#84CC16" stroke="#1a1a1a" strokeWidth="1.2"/>
        <path d="M0 8C0 8 0 13 5.5 13C11 13 11 8 11 8" stroke="#1a1a1a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <line x1="5.5" y1="13" x2="5.5" y2="16" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="2.5" y1="16" x2="8.5" y2="16" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
      </g>
      {/* Plus badge */}
      <circle cx="52" cy="12" r="10" fill="#84CC16" stroke="#1a1a1a" strokeWidth="1.5"/>
      <line x1="52" y1="7" x2="52" y2="17" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="47" y1="12" x2="57" y2="12" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
};
