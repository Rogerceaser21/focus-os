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
        d="M8 20C8 17.7909 9.79086 16 12 16H24L28 20H52C54.2091 20 56 21.7909 56 24V44C56 46.2091 54.2091 48 52 48H12C9.79086 48 8 46.2091 8 44V20Z" 
        fill="#3B82F6"
      />
      {/* Folder tab highlight */}
      <path 
        d="M8 20C8 17.7909 9.79086 16 12 16H24L28 20H12C9.79086 20 8 21.7909 8 24V20Z" 
        fill="#60A5FA"
      />
      {/* Plus sign */}
      <line x1="28" y1="28" x2="28" y2="40" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="22" y1="34" x2="34" y2="34" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      {/* Microphone badge */}
      <circle cx="50" cy="52" r="10" fill="#1F2937"/>
      <rect x="47" y="47" width="6" height="8" rx="3" fill="white"/>
      <path d="M45 53C45 56 47.2 58 50 58C52.8 58 55 56 55 53" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <line x1="50" y1="58" x2="50" y2="60" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
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
      <rect x="8" y="14" width="44" height="38" rx="6" fill="#A855F7"/>
      {/* Calendar header */}
      <rect x="8" y="14" width="44" height="12" rx="6" fill="#C084FC"/>
      <rect x="8" y="22" width="44" height="4" fill="#C084FC"/>
      {/* Calendar rings */}
      <line x1="18" y1="10" x2="18" y2="20" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="42" y1="10" x2="42" y2="20" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      {/* Plus sign */}
      <line x1="26" y1="32" x2="26" y2="44" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      <line x1="20" y1="38" x2="32" y2="38" stroke="white" strokeWidth="3" strokeLinecap="round"/>
      {/* Microphone badge */}
      <circle cx="50" cy="52" r="10" fill="#1F2937"/>
      <rect x="47" y="47" width="6" height="8" rx="3" fill="white"/>
      <path d="M45 53C45 56 47.2 58 50 58C52.8 58 55 56 55 53" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <line x1="50" y1="58" x2="50" y2="60" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
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
      <rect x="10" y="12" width="40" height="42" rx="6" fill="#84CC16"/>
      {/* Clipboard clip */}
      <rect x="22" y="6" width="16" height="10" rx="3" fill="#A3E635"/>
      {/* Checkmarks */}
      <path d="M18 26L21 29L27 23" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="32" y1="26" x2="44" y2="26" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      
      <path d="M18 38L21 41L27 35" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="32" y1="38" x2="44" y2="38" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Microphone badge */}
      <circle cx="50" cy="52" r="10" fill="#1F2937"/>
      <rect x="47" y="47" width="6" height="8" rx="3" fill="white"/>
      <path d="M45 53C45 56 47.2 58 50 58C52.8 58 55 56 55 53" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <line x1="50" y1="58" x2="50" y2="60" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
};
