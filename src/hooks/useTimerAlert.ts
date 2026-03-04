import { useEffect, useRef } from 'react';

interface UseTimerAlertOptions {
  isRunning: boolean;
  displaySeconds: number;
  intervalMinutes: number;
  enabled: boolean;
  taskTitle?: string;
  userId?: string;
}

export function useTimerAlert({ isRunning, displaySeconds, intervalMinutes, enabled, taskTitle, userId }: UseTimerAlertOptions) {
  const lastAlertAt = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !isRunning || intervalMinutes <= 0) return;

    const intervalSeconds = intervalMinutes * 60;
    const currentInterval = Math.floor(displaySeconds / intervalSeconds);
    const lastInterval = Math.floor(lastAlertAt.current / intervalSeconds);

    if (currentInterval > lastInterval && displaySeconds > 0) {
      lastAlertAt.current = displaySeconds;
      
      const minutesElapsed = Math.floor(displaySeconds / 60);
      const title = taskTitle ? `"${taskTitle}"` : 'your task';

      // Show browser notification if permitted
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏱️ Timer Check-in', {
          body: `You've been working on ${title} for ${minutesElapsed} minutes. Time for a break?`,
          icon: '/icon-192.png',
        });
      }
    }
  }, [displaySeconds, isRunning, intervalMinutes, enabled, taskTitle]);

  // Reset when timer stops
  useEffect(() => {
    if (!isRunning) {
      lastAlertAt.current = 0;
    }
  }, [isRunning]);
}
