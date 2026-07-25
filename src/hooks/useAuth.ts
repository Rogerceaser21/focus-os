import { useState, useEffect, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// Module-level snapshot of the last known auth state. Every mount used to start at
// user=null/loading=true and re-resolve via async getSession, so each route change
// painted ≥1 frame of the loading gate (the remount blink, flicker fault A). Seeding
// from the snapshot makes the user known at FIRST render on remounts; the effect
// below still re-validates against getSession and the auth listener as before.
let lastKnownUser: User | null = null;
let lastKnownSession: Session | null = null;

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(lastKnownUser);
  const [session, setSession] = useState<Session | null>(lastKnownSession);
  const [loading, setLoading] = useState(lastKnownUser === null);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Set up auth state listener FIRST (as per Supabase docs)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        lastKnownSession = newSession;
        lastKnownUser = newSession?.user ?? null;
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
        lastKnownSession = existingSession;
        lastKnownUser = existingSession?.user ?? null;
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

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
  };

  return { user, session, loading, signOut };
};