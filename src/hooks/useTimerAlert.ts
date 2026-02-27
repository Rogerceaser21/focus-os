import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
    if (!enabled || !isRunning || intervalMinutes <= 0 || !userId) return;

    const intervalSeconds = intervalMinutes * 60;
    
    // Check if we've crossed a new interval boundary
    const currentInterval = Math.floor(displaySeconds / intervalSeconds);
    const lastInterval = Math.floor(lastAlertAt.current / intervalSeconds);

    if (currentInterval > lastInterval && displaySeconds > 0) {
      lastAlertAt.current = displaySeconds;
      
      const minutesElapsed = Math.floor(displaySeconds / 60);
      const title = taskTitle ? `"${taskTitle}"` : 'your task';

      // Send push notification
      (async () => {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_id: userId,
              payload: {
                title: '⏱️ Timer Check-in',
                body: `You've been working on ${title} for ${minutesElapsed} minutes. Time for a break?`,
                url: '/app'
              }
            }
          });
        } catch (err) {
          console.error('[TimerAlert] Failed to send:', err);
        }
      })();
    }
  }, [displaySeconds, isRunning, intervalMinutes, enabled, taskTitle, userId]);

  // Reset when timer stops
  useEffect(() => {
    if (!isRunning) {
      lastAlertAt.current = 0;
    }
  }, [isRunning]);
}
