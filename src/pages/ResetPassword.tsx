import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import DarkVeil from '@/components/DarkVeil';
import { Eye, EyeOff } from 'lucide-react';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isCream = theme === 'cream';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    // Check if already in recovery mode from URL hash
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      toast.error('Please fill in both fields');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated successfully!');
      navigate('/app');
    }
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4 bg-background">
        {!isCream && <DarkVeil hueShift={108} noiseIntensity={0} scanlineIntensity={0} speed={0.3} scanlineFrequency={0} warpAmount={0.4} resolutionScale={0.6} />}
        {!isCream && <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />}
        <Card className="w-full max-w-md relative z-10 backdrop-blur-sm bg-card/90 border-2">
          <CardHeader>
            <CardTitle className="text-2xl">Verifying...</CardTitle>
            <CardDescription>Please wait while we verify your reset link. If this takes too long, the link may have expired.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => navigate('/auth')}>
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4">
      <DarkVeil hueShift={108} noiseIntensity={0} scanlineIntensity={0} speed={0.3} scanlineFrequency={0} warpAmount={0.4} resolutionScale={0.6} />
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />
      <Card className="w-full max-w-md relative z-10 backdrop-blur-sm bg-card/90 border-2">
        <CardHeader>
          <CardTitle className="text-2xl">Set New Password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => navigate('/auth')}>
              Back to Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
