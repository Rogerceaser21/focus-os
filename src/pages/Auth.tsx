import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';
import { IS_SHELL } from '@/lib/shell';
import AuthCard, { type AuthMode } from '@/components/AuthCard';

/* The /auth page (logout target, shell entry, deep links). Same AuthCard as
   the landing's dialog; only the wrapper differs. */
const Auth = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('signin');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/home');
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md relative z-10 backdrop-blur-sm bg-card/90 border-2">
        {/* Way back to the landing page — the dialog's own close, mirrored.
            Hidden in the shell: there "/" just redirects straight back here. */}
        {!IS_SHELL && (
          <button
            type="button"
            aria-label="Back to the Focus OS home page"
            onClick={() => navigate('/')}
            className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <CardContent className="pt-6">
          <AuthCard
            mode={mode}
            onModeChange={setMode}
            // Shell: "/" redirects straight back here (empty-form flash); go direct.
            onAuthed={() => navigate(IS_SHELL ? '/home' : '/')}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
