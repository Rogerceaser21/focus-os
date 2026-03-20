import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import DarkVeil from '@/components/DarkVeil';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Shield } from 'lucide-react';

const Auth = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);

  // Admin reset state
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminVerified, setAdminVerified] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/home');
      }
    });
  }, [navigate]);

  const handleGoogleSignIn = async () => {
    const isCustomDomain =
      !window.location.hostname.includes("lovable.app") &&
      !window.location.hostname.includes("lovableproject.com") &&
      !window.location.hostname.includes("localhost");

    if (isCustomDomain) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/home`,
          skipBrowserRedirect: true,
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      }
    } else {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/home`,
        },
      });
      if (error) {
        toast.error(error.message);
      }
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !firstName.trim() || !lastName.trim()) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/home`,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }
      }
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Account created! Logging you in...');
      navigate('/');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error('Please enter your email');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password reset link sent! Check your email.');
      setForgotPassword(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Welcome back!');
      navigate('/');
    }
  };

  const handleAdminVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPassword) {
      toast.error('Please enter the admin password');
      return;
    }
    setAdminLoading(true);
    try {
      const { data, error } = await supabase
        .from('app_configuration')
        .select('settings_password')
        .limit(1)
        .single();
      
      if (error || !data) {
        toast.error('Could not verify admin credentials');
        setAdminLoading(false);
        return;
      }

      if (adminPassword !== data.settings_password) {
        toast.error('Invalid admin password');
        setAdminLoading(false);
        return;
      }

      setAdminVerified(true);
      toast.success('Admin verified');
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
    }
    setAdminLoading(false);
  };

  const handleAdminReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail || !resetNewPassword) {
      toast.error('Please fill in all fields');
      return;
    }
    setAdminLoading(true);
    try {
      const res = await supabase.functions.invoke('focusos-admin-reset-password', {
        body: {
          userEmail: resetEmail.trim().toLowerCase(),
          newPassword: resetNewPassword,
        },
      });

      if (res.error) {
        toast.error(res.error.message || 'Failed to reset password');
      } else if (res.data?.error) {
        toast.error(res.data.error);
      } else {
        toast.success(`Password reset for ${resetEmail}!`);
        setResetEmail('');
        setResetNewPassword('');
      }
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong');
    }
    setAdminLoading(false);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-background">
      {isDark && <DarkVeil hueShift={108} noiseIntensity={0} scanlineIntensity={0} speed={0.3} scanlineFrequency={0} warpAmount={0.4} resolutionScale={0.6} />}
      {isDark && <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />}
      
      <Card className="w-full max-w-md relative z-10 backdrop-blur-sm bg-card/90 border-2">
        <CardHeader>
          <CardTitle className="text-3xl">Focus OS Login</CardTitle>
          <CardDescription>Organize your work with timers and visual planning</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full mb-4 gap-2"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </Button>

          <div className="relative mb-4">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2 border-0 bg-transparent">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              {forgotPassword ? (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input id="forgot-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full text-sm" onClick={() => setForgotPassword(false)}>
                    Back to Sign In
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input id="signin-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input id="signin-password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign In'}
                  </Button>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setForgotPassword(true)}
                    >
                      Forgot Password?
                    </button>
                    <Dialog open={adminDialogOpen} onOpenChange={(open) => {
                      setAdminDialogOpen(open);
                      if (!open) {
                        setAdminVerified(false);
                        setAdminPassword('');
                        setResetEmail('');
                        setResetNewPassword('');
                      }
                    }}>
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                        >
                          <Shield className="h-3 w-3" />
                          Admin Reset
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        {!adminVerified ? (
                          <>
                            <DialogHeader>
                              <DialogTitle>Sign-Up Access</DialogTitle>
                              <DialogDescription>
                                Enter the administrator password to access the password reset form
                              </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleAdminVerify} className="space-y-4">
                              <div className="space-y-2">
                                <Input
                                  type="password"
                                  placeholder="Enter administrator password"
                                  value={adminPassword}
                                  onChange={e => setAdminPassword(e.target.value)}
                                  disabled={adminLoading}
                                />
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setAdminDialogOpen(false)}>
                                  Cancel
                                </Button>
                                <Button type="submit" disabled={adminLoading}>
                                  {adminLoading ? 'Verifying...' : 'Verify'}
                                </Button>
                              </div>
                            </form>
                          </>
                        ) : (
                          <>
                            <DialogHeader>
                              <DialogTitle>Admin Password Reset</DialogTitle>
                              <DialogDescription>
                                Change password for any user account
                              </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleAdminReset} className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="reset-user-email">User Email</Label>
                                <Input
                                  id="reset-user-email"
                                  type="email"
                                  placeholder="user@example.com"
                                  value={resetEmail}
                                  onChange={e => setResetEmail(e.target.value)}
                                  disabled={adminLoading}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="reset-new-pw">New Password</Label>
                                <Input
                                  id="reset-new-pw"
                                  type="password"
                                  placeholder="New password"
                                  value={resetNewPassword}
                                  onChange={e => setResetNewPassword(e.target.value)}
                                  disabled={adminLoading}
                                />
                              </div>
                              <Button type="submit" className="w-full" disabled={adminLoading}>
                                {adminLoading ? 'Resetting...' : 'Update User Password'}
                              </Button>
                            </form>
                          </>
                        )}
                      </DialogContent>
                    </Dialog>
                  </div>
                </form>
              )}
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="signup-firstname">First Name</Label>
                    <Input id="signup-firstname" type="text" placeholder="John" value={firstName} onChange={e => setFirstName(e.target.value)} disabled={loading} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-lastname">Surname</Label>
                    <Input id="signup-lastname" type="text" placeholder="Smith" value={lastName} onChange={e => setLastName(e.target.value)} disabled={loading} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Creating account...' : 'Sign Up'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
