import TrueFocus from './TrueFocus';

const HeroSection = () => {
  return (
    <div className="relative w-full h-[133px] overflow-hidden z-[5]">
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
