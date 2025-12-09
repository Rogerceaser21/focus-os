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
        stroke="white"
        strokeWidth="2"
      />
      {/* Folder tab highlight */}
      <path 
        d="M8 20C8 17.7909 9.79086 16 12 16H24L28 20H12C9.79086 20 8 21.7909 8 24V20Z" 
        fill="#60A5FA"
      />
      {/* Plus sign */}
      <line x1="32" y1="28" x2="32" y2="44" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="24" y1="36" x2="40" y2="36" stroke="white" strokeWidth="3" strokeLinecap="round"/>
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
      <rect x="8" y="16" width="48" height="42" rx="6" fill="#A855F7" stroke="white" strokeWidth="2"/>
      {/* Calendar header */}
      <rect x="8" y="16" width="48" height="14" rx="6" fill="#C084FC"/>
      <rect x="8" y="24" width="48" height="6" fill="#C084FC"/>
      {/* Calendar rings */}
      <line x1="20" y1="10" x2="20" y2="22" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="44" y1="10" x2="44" y2="22" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      {/* Plus sign */}
      <line x1="32" y1="36" x2="32" y2="52" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="24" y1="44" x2="40" y2="44" stroke="white" strokeWidth="3" strokeLinecap="round"/>
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
      <rect x="10" y="14" width="44" height="46" rx="6" fill="#84CC16" stroke="white" strokeWidth="2"/>
      {/* Clipboard clip */}
      <rect x="22" y="8" width="20" height="12" rx="3" fill="#A3E635" stroke="white" strokeWidth="2"/>
      {/* Checkmarks */}
      <path d="M18 30L22 34L28 26" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="34" y1="30" x2="48" y2="30" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      
      <path d="M18 44L22 48L28 40" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="34" y1="44" x2="48" y2="44" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
};
