import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { supabase } from '@/integrations/supabase/client';

/**
 * Syncs the user's saved theme preference from Supabase to next-themes.
 * Runs once after auth is established, ensuring cross-device persistence.
 */
export const ThemeSyncer = () => {
  const { setTheme } = useTheme();
  const hasSynced = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session?.user?.id || hasSynced.current) return;
      hasSynced.current = true;

      try {
        const { data } = await (supabase as any)
          .from('focusos_user_preferences')
          .select('theme')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (data?.theme) {
          setTheme(data.theme);
        }
      } catch (err) {
        console.error('ThemeSyncer: failed to load theme', err);
      }
    });

    return () => subscription.unsubscribe();
  }, [setTheme]);

  return null;
};
