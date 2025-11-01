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

  const formatTime = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }, []);

  return {
    timer,
    startTimer,
    stopTimer,
    resetTimer,
    formatTime
  };
};
