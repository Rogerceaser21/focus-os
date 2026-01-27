import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import DarkVeil from '@/components/DarkVeil';

const Landing = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      navigate('/app');
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
    <div className="min-h-screen relative flex flex-col">
      <DarkVeil 
        hueShift={108} 
        noiseIntensity={0} 
        scanlineIntensity={0} 
        speed={0.3} 
        scanlineFrequency={0} 
        warpAmount={0.4} 
        resolutionScale={0.6} 
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/70 pointer-events-none z-[1]" />
      
      {/* Auth buttons - top right */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10 flex gap-3">
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

      {/* Main content with video */}
      <main className="relative z-10 flex-1 flex flex-col items-center pt-16 sm:pt-20 px-4 pb-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-3">
            Focus OS, Stress Less.
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Voice-powered task management with visual planning and time tracking
          </p>
        </div>

        {/* Video container */}
        <div className="w-full max-w-lg glass-card rounded-2xl overflow-hidden shadow-2xl">
          <video
            className="w-full h-auto"
            controls
            autoPlay
            muted
            loop
            playsInline
            poster=""
          >
            <source src="/Focus_Os_Intro.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        {/* CTA below video */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 items-center">
          <Button 
            size="lg" 
            onClick={() => navigate('/auth')}
            className="text-lg px-8"
          >
            Start Free Today
          </Button>
          <p className="text-sm text-muted-foreground">No credit card required</p>
        </div>
      </main>
    </div>
  );
};

export default Landing;
