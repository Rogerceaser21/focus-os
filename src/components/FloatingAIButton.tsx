import { useEffect, useRef, useState } from 'react';

interface FloatingAIButtonProps {
  onClick: () => void;
}

export const FloatingAIButton = ({ onClick }: FloatingAIButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const particleContainerRef = useRef<HTMLDivElement>(null);
  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

  // Particle generation helpers (adapted from TrueFocus)
  const noise = () => (Math.random() - 0.5) * 2;
  
  const getXY = (mag: number = 1) => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * mag;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  };

  const createParticle = (container: HTMLElement, x: number, y: number) => {
    const particle = document.createElement("div");
    particle.className = "particle";
    
    const point = document.createElement("div");
    point.className = "point";
    particle.appendChild(point);

    const offset = getXY(80);
    const time = 0.8 + Math.random() * 0.4;
    const scale = 0.3 + Math.random() * 0.7;
    const rotate = noise() * 360;

    particle.style.setProperty("--start-x", "0px");
    particle.style.setProperty("--start-y", "0px");
    particle.style.setProperty("--end-x", `${offset.x}px`);
    particle.style.setProperty("--end-y", `${offset.y}px`);
    particle.style.setProperty("--time", `${time}s`);
    particle.style.setProperty("--scale", `${scale}`);
    particle.style.setProperty("--rotate", `${rotate}deg`);
    particle.style.setProperty("--color", "hsl(var(--primary))");

    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;

    container.appendChild(particle);

    setTimeout(() => {
      particle.remove();
    }, time * 1000);
  };

  const makeParticles = () => {
    if (!particleContainerRef.current || !buttonRect) return;

    const count = 6 + Math.floor(Math.random() * 4);
    const centerX = buttonRect.width / 2;
    const centerY = buttonRect.height / 2;

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        createParticle(particleContainerRef.current!, centerX, centerY);
      }, i * 30);
    }
  };

  // Update button rect on mount and resize
  useEffect(() => {
    const updateRect = () => {
      if (buttonRef.current) {
        setButtonRect(buttonRef.current.getBoundingClientRect());
      }
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, []);

  // Continuous particle generation
  useEffect(() => {
    if (!buttonRect) return;

    const interval = setInterval(() => {
      makeParticles();
    }, 1200);

    return () => clearInterval(interval);
  }, [buttonRect]);

  return (
    <div className="fixed top-8 right-8 z-50">
      <div className="relative">
        {/* Particle Container */}
        <div
          ref={particleContainerRef}
          className="particle-container absolute"
          style={{
            width: buttonRect?.width || 0,
            height: buttonRect?.height || 0,
            top: 0,
            left: 0,
          }}
        />

        {/* Button */}
        <button
          ref={buttonRef}
          onClick={onClick}
          className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary text-primary-foreground font-black text-2xl sm:text-3xl shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:scale-105 transition-all duration-300 flex items-center justify-center border-2 border-primary-foreground/10"
          aria-label="Open AI Task Creator"
        >
          P
        </button>
      </div>
    </div>
  );
};
