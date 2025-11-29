import { useState, useEffect, useCallback } from 'react';
import { TaskTimer } from '@/types/task';

export const useTimer = (initialTimer: TaskTimer) => {
  const [timer, setTimer] = useState<TaskTimer>(initialTimer);
  const [displaySeconds, setDisplaySeconds] = useState<number>(() => {
    // Calculate initial display seconds
    if (initialTimer.isRunning && initialTimer.startTime) {
      const elapsed = Math.floor((Date.now() - initialTimer.startTime) / 1000);
      return initialTimer.totalSeconds + elapsed;
    }
    return initialTimer.totalSeconds;
  });

  // Calculate current seconds dynamically
  const getCurrentSeconds = useCallback(() => {
    if (timer.isRunning && timer.startTime) {
      const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
      return timer.totalSeconds + elapsed;
    }
    return timer.totalSeconds;
  }, [timer.isRunning, timer.startTime, timer.totalSeconds]);

  // Update display every second when running
  useEffect(() => {
    if (!timer.isRunning) {
      setDisplaySeconds(timer.totalSeconds);
      return;
    }

    // Update immediately
    setDisplaySeconds(getCurrentSeconds());

    const interval = setInterval(() => {
      setDisplaySeconds(getCurrentSeconds());
    }, 1000);

    return () => clearInterval(interval);
  }, [timer.isRunning, timer.totalSeconds, getCurrentSeconds]);

  // Handle visibility change - update display immediately when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && timer.isRunning) {
        setDisplaySeconds(getCurrentSeconds());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [timer.isRunning, getCurrentSeconds]);

  const startTimer = useCallback(() => {
    const startTime = Date.now();
    setTimer(prev => ({
      ...prev,
      isRunning: true,
      startTime
    }));
  }, []);

  const stopTimer = useCallback(() => {
    setTimer(prev => {
      // Calculate elapsed time and add to totalSeconds
      const elapsed = prev.startTime 
        ? Math.floor((Date.now() - prev.startTime) / 1000)
        : 0;
      return {
        ...prev,
        totalSeconds: prev.totalSeconds + elapsed,
        isRunning: false,
        startTime: undefined
      };
    });
  }, []);

  const resetTimer = useCallback(() => {
    setTimer({
      totalSeconds: 0,
      isRunning: false,
      startTime: undefined
    });
    setDisplaySeconds(0);
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
    displaySeconds,
    startTimer,
    stopTimer,
    resetTimer,
    formatTime,
    getCurrentSeconds
  };
};
