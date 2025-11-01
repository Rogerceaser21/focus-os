import RippleGrid from './RippleGrid';
import TrueFocus from './TrueFocus';

const HeroSection = () => {
  return (
    <div className="relative w-full h-[70px] overflow-hidden z-[5]">
      {/* Ripple Grid Background */}
      <div className="absolute inset-0">
        <RippleGrid
          gridColor="#4FD1C5"
          rippleIntensity={0.08}
          gridSize={8.0}
          gridThickness={12.0}
          fadeDistance={1.8}
          vignetteStrength={1.5}
          glowIntensity={0.15}
          opacity={0.6}
          mouseInteraction={true}
          mouseInteractionRadius={1.2}
        />
      </div>
      
      {/* Text Overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <TrueFocus
          sentence="Brain Dump"
          manualMode={false}
          blurAmount={8}
          borderColor="#4FD1C5"
          glowColor="rgba(79, 209, 197, 0.8)"
          animationDuration={0.6}
          pauseBetweenAnimations={1.5}
        />
      </div>
    </div>
  );
};

export default HeroSection;
