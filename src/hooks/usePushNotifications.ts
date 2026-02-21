import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Augment ServiceWorkerRegistration to include pushManager
declare global {
  interface ServiceWorkerRegistration {
    pushManager: PushManager;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

let cachedVapidKey: string | null = null;

async function getVapidPublicKey(): Promise<string> {
  if (cachedVapidKey) return cachedVapidKey;

  const { data, error } = await supabase.functions.invoke('get-vapid-public-key');
  if (error || !data?.publicKey) {
    throw new Error('Failed to fetch VAPID public key');
  }
  cachedVapidKey = data.publicKey;
  return data.publicKey;
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);
  const [isiOS, setIsiOS] = useState(false);
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsiOS(isIOSDevice);

    const isPWAMode = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    setIsPWA(isPWAMode);

    const hasServiceWorker = 'serviceWorker' in navigator;
    const hasPushManager = 'PushManager' in window;
    const hasNotification = 'Notification' in window;

    if (isIOSDevice && !isPWAMode) {
      setIsSupported(false);
    } else {
      setIsSupported(hasServiceWorker && hasPushManager && hasNotification);
    }

    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    checkSubscription();
  }, []);

  const checkSubscription = async () => {
    try {
      if (!('serviceWorker' in navigator)) return;
      const registration = await navigator.serviceWorker.getRegistration('/sw-push.js');
      if (!registration) {
        setIsSubscribed(false);
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (error) {
      console.error('[Push] Error checking subscription:', error);
      setIsSubscribed(false);
    }
  };

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      throw new Error('Push notifications are not supported');
    }

    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        throw new Error('Notification permission denied');
      }

      const registration = await navigator.serviceWorker.register('/sw-push.js', {
        scope: '/'
      });

      await navigator.serviceWorker.ready;

      const vapidPublicKey = await getVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer
      });

      const p256dhKey = subscription.getKey('p256dh');
      const authKey = subscription.getKey('auth');

      if (!p256dhKey || !authKey) {
        throw new Error('Failed to get subscription keys');
      }

      const p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)));
      const auth = btoa(String.fromCharCode(...new Uint8Array(authKey)));

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      const { error } = await supabase
        .from('push_subscriptions' as any)
        .upsert({
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh,
          auth
        }, {
          onConflict: 'user_id,endpoint'
        });

      if (error) {
        console.error('[Push] Error storing subscription:', error);
        throw error;
      }

      setIsSubscribed(true);
    } catch (error) {
      console.error('[Push] Error subscribing:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw-push.js');
      if (!registration) {
        setIsSubscribed(false);
        return;
      }

      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await (supabase
            .from('push_subscriptions' as any)
            .delete()
            .eq('user_id', user.id)
            .eq('endpoint', subscription.endpoint));
        }
      }

      setIsSubscribed(false);
    } catch (error) {
      console.error('[Push] Error unsubscribing:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    isiOS,
    isPWA,
    subscribe,
    unsubscribe
  };
}
