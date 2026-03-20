import { useState, useEffect, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Safety timeout — if auth never resolves, stop loading after 5s
    const timeout = setTimeout(() => {
      if (!initializedRef.current) {
        console.warn('[useAuth] Session restore timed out after 5s — clearing loading state');
        initializedRef.current = true;
        setLoading(false);
      }
    }, 5000);

    // Set up auth state listener FIRST (as per Supabase docs)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (initializedRef.current) {
          setLoading(false);
        }
      }
    );

    // getSession is the single source of truth for initial session
    supabase.auth.getSession()
      .then(({ data: { session: existingSession } }) => {
        setSession(existingSession);
        setUser(existingSession?.user ?? null);
        initializedRef.current = true;
        setLoading(false);
      })
      .catch((err) => {
        console.error('[useAuth] getSession failed:', err);
        initializedRef.current = true;
        setLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
  };

  return { user, session, loading, signOut };
};