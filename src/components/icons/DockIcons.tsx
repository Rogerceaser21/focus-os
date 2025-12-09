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
        d="M8 20C8 17.7909 9.79086 16 12 16H24L28 20H52C54.2091 20 56 21.7909 56 24V48C56 50.2091 54.2091 52 52 52H12C9.79086 52 8 50.2091 8 48V20Z" 
        fill="#3B82F6"
      />
      {/* Folder tab highlight */}
      <path 
        d="M8 20C8 17.7909 9.79086 16 12 16H24L28 20H12C9.79086 20 8 21.7909 8 24V20Z" 
        fill="#60A5FA"
      />
      {/* Microphone icon */}
      <rect x="26" y="28" width="12" height="16" rx="6" fill="white"/>
      <path d="M23 40C23 45 27 48 32 48C37 48 41 45 41 40" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="32" y1="48" x2="32" y2="52" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Plus badge */}
      <circle cx="50" cy="18" r="10" fill="#22C55E"/>
      <line x1="50" y1="13" x2="50" y2="23" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="45" y1="18" x2="55" y2="18" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
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
      <rect x="8" y="16" width="48" height="42" rx="6" fill="#A855F7"/>
      {/* Calendar header */}
      <rect x="8" y="16" width="48" height="14" rx="6" fill="#C084FC"/>
      <rect x="8" y="24" width="48" height="6" fill="#C084FC"/>
      {/* Calendar rings */}
      <line x1="20" y1="10" x2="20" y2="22" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="44" y1="10" x2="44" y2="22" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      {/* Microphone icon */}
      <rect x="26" y="34" width="12" height="14" rx="6" fill="white"/>
      <path d="M24 44C24 48 27.5 51 32 51C36.5 51 40 48 40 44" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      <line x1="32" y1="51" x2="32" y2="54" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      {/* Plus badge */}
      <circle cx="50" cy="18" r="10" fill="#22C55E"/>
      <line x1="50" y1="13" x2="50" y2="23" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="45" y1="18" x2="55" y2="18" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
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
      <rect x="10" y="14" width="44" height="46" rx="6" fill="#84CC16"/>
      {/* Clipboard clip */}
      <rect x="22" y="8" width="20" height="12" rx="3" fill="#A3E635"/>
      {/* Checkmark */}
      <path d="M18 30L24 36L34 24" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Microphone icon */}
      <rect x="26" y="40" width="10" height="12" rx="5" fill="white"/>
      <path d="M23 49C23 52.5 27 55 31 55C35 55 39 52.5 39 49" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      <line x1="31" y1="55" x2="31" y2="58" stroke="white" strokeWidth="2" strokeLinecap="round"/>
      {/* Plus badge */}
      <circle cx="50" cy="18" r="10" fill="#22C55E"/>
      <line x1="50" y1="13" x2="50" y2="23" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="45" y1="18" x2="55" y2="18" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
};
