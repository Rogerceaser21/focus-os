import { useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

const Landing = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { setTheme } = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Force cream theme on Landing page
  useEffect(() => {
    setTheme('cream');
  }, [setTheme]);

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
    }
  };

  useEffect(() => {
    if (!loading && user) {
      navigate('/home');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex flex-col bg-background">
      
      {/* Main content with video */}
      <main className="relative z-10 flex flex-col items-center pt-4 sm:pt-6 px-4 pb-8">
        {/* 3-column grid: buttons left, headline center, empty right */}
        <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] items-start gap-4 mb-0 sm:mb-6">
          {/* Left - buttons stacked (hidden on mobile) */}
          <div className="hidden sm:flex flex-col gap-2">
            <Button 
              variant="outline" 
              onClick={() => navigate('/auth')}
              className="glass-subtle"
            >
              Sign In
            </Button>
            <Button 
              onClick={() => navigate('/auth')}
            >
              Get Started
            </Button>
          </div>
          
          {/* Center - headline */}
          <div className="text-center">
            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-0 sm:mb-2 whitespace-nowrap">
              Focus OS, Stress Less.
            </h1>
            <p className="hidden sm:block text-muted-foreground text-sm sm:text-lg whitespace-nowrap">
              Voice-powered task management with visual planning and time tracking
            </p>
          </div>
          
          {/* Right - empty spacer */}
          <div className="w-[100px]"></div>
        </div>

        {/* Video container */}
        <div className="w-full max-w-lg glass-card rounded-2xl overflow-hidden shadow-2xl">
          <video
            ref={videoRef}
            className="w-full h-auto"
            controls
            autoPlay
            muted
            loop
            playsInline
            poster=""
            onPlay={handlePlay}
          >
            <source src="/Focus_Os_Intro.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        {/* CTA below video */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex gap-3">
            <Button 
              variant="outline"
              onClick={() => navigate('/auth')}
              className="sm:hidden glass-subtle"
            >
              Sign In
            </Button>
            <Button 
              size="lg" 
              onClick={() => navigate('/auth')}
              className="text-lg px-8"
            >
              Start Free Today
            </Button>
          </div>
          <p className="hidden sm:block text-sm text-muted-foreground">No credit card required</p>
        </div>
      </main>
    </div>
  );
};

export default Landing;
