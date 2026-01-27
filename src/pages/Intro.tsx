import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import DarkVeil from '@/components/DarkVeil';

const Intro = () => {
  const navigate = useNavigate();

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

      {/* Minimal header */}
      <header className="relative z-10 flex justify-between items-center p-4 sm:p-6">
        <h1 
          className="text-xl sm:text-2xl font-bold text-foreground cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => navigate('/')}
        >
          Focus OS
        </h1>
        <Button 
          onClick={() => navigate('/auth')}
        >
          Try It Free
        </Button>
      </header>

      {/* Full-focus video */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-5xl glass-card rounded-2xl overflow-hidden shadow-2xl">
          <video
            className="w-full h-auto"
            controls
            autoPlay
            muted
            playsInline
          >
            <source src="/Focus_Os_Intro.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        <div className="mt-6 text-center">
          <p className="text-muted-foreground mb-4">
            Voice-powered task management with visual planning
          </p>
          <Button 
            size="lg" 
            onClick={() => navigate('/auth')}
          >
            Get Started
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Intro;
