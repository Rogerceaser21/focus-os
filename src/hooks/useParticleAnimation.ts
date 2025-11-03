import { useRef, useCallback } from 'react';

interface ParticleConfig {
  particleCount?: number;
  colors?: string[];
  animationDuration?: number;
}

export const useParticleAnimation = ({
  particleCount = 12,
  colors = ['#4FD1C5', '#3B82F6', '#06B6D4'],
  animationDuration = 0.6
}: ParticleConfig = {}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const noise = () => (Math.random() - 0.5) * 2;

  const getXY = (i: number, total: number, radius: number) => {
    const step = (Math.PI * 2) / total;
    return {
      x: Math.cos(step * i) * radius,
      y: Math.sin(step * i) * radius
    };
  };

  const createParticle = (x: number, y: number, color: string, time: number) => {
    const particle = document.createElement('div');
    particle.className = 'particle';
    
    const point = document.createElement('div');
    point.className = 'point';
    point.style.background = color;
    point.style.boxShadow = `0 0 10px ${color}`;
    
    particle.appendChild(point);
    
    const scale = 0.5 + Math.random() * 0.5;
    const deg = Math.random() * 360;
    
    particle.style.setProperty('--color', color);
    particle.style.setProperty('--time', `${time}ms`);
    particle.style.setProperty('--start-x', '0px');
    particle.style.setProperty('--start-y', '0px');
    particle.style.setProperty('--end-x', `${x + noise() * 10}px`);
    particle.style.setProperty('--end-y', `${y + noise() * 10}px`);
    particle.style.setProperty('--scale', scale.toString());
    particle.style.setProperty('--rotate', `${deg}deg`);
    
    return particle;
  };

  const triggerParticles = useCallback((element: HTMLElement) => {
    if (!containerRef.current) return;

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Position container at element center
    containerRef.current.style.left = `${centerX}px`;
    containerRef.current.style.top = `${centerY}px`;

    const time = animationDuration * 1000;
    const radius = 40; // Smaller radius for dock buttons

    for (let i = 0; i < particleCount; i++) {
      const pos = getXY(i, particleCount, radius);
      const colorIndex = i % colors.length;
      const particle = createParticle(pos.x, pos.y, colors[colorIndex], time);
      
      containerRef.current.appendChild(particle);
      
      setTimeout(() => {
        particle.remove();
      }, time);
    }
  }, [particleCount, colors, animationDuration]);

  return { triggerParticles, containerRef };
};
