import { useState, useEffect, useCallback } from 'react';
import { TaskTimer } from '@/types/task';

export const useTimer = (initialTimer: TaskTimer) => {
  const [timer, setTimer] = useState<TaskTimer>(initialTimer);

  useEffect(() => {
    if (!timer.isRunning) return;

    const interval = setInterval(() => {
      setTimer(prev => ({
        ...prev,
        totalSeconds: prev.totalSeconds + 1
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [timer.isRunning]);

  const startTimer = useCallback(() => {
    setTimer(prev => ({
      ...prev,
      isRunning: true,
      startTime: Date.now()
    }));
  }, []);

  const stopTimer = useCallback(() => {
    setTimer(prev => ({
      ...prev,
      isRunning: false,
      startTime: undefined
    }));
  }, []);

  const resetTimer = useCallback(() => {
    setTimer({
      totalSeconds: 0,
      isRunning: false,
      startTime: undefined
    });
  }, []);

  const formatTime = useCallback((seconds: number, showSeconds: boolean = true) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const formattedHrs = String(hrs).padStart(2, '0');
    const formattedMins = String(mins).padStart(2, '0');
    const formattedSecs = String(secs).padStart(2, '0');
    
    if (showSeconds) {
      return `${formattedHrs}h ${formattedMins}m ${formattedSecs}s`;
    } else {
      return `${formattedHrs}h ${formattedMins}m`;
    }
  }, []);

  return {
    timer,
    startTimer,
    stopTimer,
    resetTimer,
    formatTime
  };
};
