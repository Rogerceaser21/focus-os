import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import './GooeyNav.css';

const TrueFocus = ({
  sentence = 'True Focus',
  manualMode = false,
  blurAmount = 5,
  borderColor = 'green',
  glowColor = 'rgba(0, 255, 0, 0.6)',
  animationDuration = 0.5,
  pauseBetweenAnimations = 1,
  particleCount = 15,
  particleDistances = [90, 10],
  particleR = 100,
  timeVariance = 300,
  colors = [1, 2, 3, 1, 2, 3, 1, 4]
}) => {
  const words = sentence.split(' ');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastActiveIndex, setLastActiveIndex] = useState(null);
  const containerRef = useRef(null);
  const wordRefs = useRef([]);
  const particleContainerRef = useRef(null);
  const [focusRect, setFocusRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    if (!manualMode) {
      const interval = setInterval(
        () => {
          setCurrentIndex(prev => (prev + 1) % words.length);
        },
        (animationDuration + pauseBetweenAnimations) * 1000
      );

      return () => clearInterval(interval);
    }
  }, [manualMode, animationDuration, pauseBetweenAnimations, words.length]);

  const noise = (n = 1) => n / 2 - Math.random() * n;

  const getXY = (distance, pointIndex, totalPoints) => {
    const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  };

  const createParticle = (i, t, d, r) => {
    let rotate = noise(r / 10);
    return {
      start: getXY(d[0], particleCount - i, particleCount),
      end: getXY(d[1] + noise(7), particleCount - i, particleCount),
      time: t,
      scale: 1 + noise(0.2),
      color: colors[Math.floor(Math.random() * colors.length)],
      rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10
    };
  };

  const makeParticles = () => {
    if (!particleContainerRef.current) return;
    
    const element = particleContainerRef.current;
    const d = particleDistances;
    const r = particleR;
    const bubbleTime = animationDuration * 2000 + timeVariance;

    // Clear existing particles
    const existingParticles = element.querySelectorAll('.particle');
    existingParticles.forEach(p => {
      try {
        element.removeChild(p);
      } catch {
        // Do nothing
      }
    });

    for (let i = 0; i < particleCount; i++) {
      const t = animationDuration * 2000 + noise(timeVariance * 2);
      const p = createParticle(i, t, d, r);

      setTimeout(() => {
        const particle = document.createElement('span');
        const point = document.createElement('span');
        particle.classList.add('particle');
        particle.style.setProperty('--start-x', `${p.start[0]}px`);
        particle.style.setProperty('--start-y', `${p.start[1]}px`);
        particle.style.setProperty('--end-x', `${p.end[0]}px`);
        particle.style.setProperty('--end-y', `${p.end[1]}px`);
        particle.style.setProperty('--time', `${p.time}ms`);
        particle.style.setProperty('--scale', `${p.scale}`);
        particle.style.setProperty('--color', `var(--color-${p.color}, white)`);
        particle.style.setProperty('--rotate', `${p.rotate}deg`);

        point.classList.add('point');
        particle.appendChild(point);
        element.appendChild(particle);

        setTimeout(() => {
          try {
            element.removeChild(particle);
          } catch {
            // Do nothing
          }
        }, t);
      }, 30);
    }
  };

  useEffect(() => {
    if (currentIndex === null || currentIndex === -1) return;
    if (!wordRefs.current[currentIndex] || !containerRef.current) return;

    const parentRect = containerRef.current.getBoundingClientRect();
    const activeRect = wordRefs.current[currentIndex].getBoundingClientRect();

    setFocusRect({
      x: activeRect.left - parentRect.left,
      y: activeRect.top - parentRect.top,
      width: activeRect.width,
      height: activeRect.height
    });

    // Trigger particle animation on word change
    makeParticles();
  }, [currentIndex, words.length]);

  const handleMouseEnter = index => {
    if (manualMode) {
      setLastActiveIndex(index);
      setCurrentIndex(index);
    }
  };

  const handleMouseLeave = () => {
    if (manualMode) {
      setCurrentIndex(lastActiveIndex);
    }
  };

  return (
    <div className="relative flex gap-4 justify-center items-center flex-wrap" ref={containerRef}>
      {/* Particle container positioned around active word */}
      <div 
        ref={particleContainerRef}
        className="gooey-effect-container absolute"
        style={{
          left: `${focusRect.x + focusRect.width / 2}px`,
          top: `${focusRect.y + focusRect.height / 2}px`,
          transition: `left ${animationDuration}s ease, top ${animationDuration}s ease`
        }}
      />
      
      {words.map((word, index) => {
        const isActive = index === currentIndex;
        return (
          <span
            key={index}
            ref={el => (wordRefs.current[index] = el)}
            className="relative text-2xl font-black cursor-pointer"
            style={{
              filter: manualMode
                ? isActive
                  ? `blur(0px)`
                  : `blur(${blurAmount}px)`
                : isActive
                  ? `blur(0px)`
                  : `blur(${blurAmount}px)`,
              transition: `filter ${animationDuration}s ease`
            } as React.CSSProperties}
            onMouseEnter={() => handleMouseEnter(index)}
            onMouseLeave={handleMouseLeave}
          >
            {word}
          </span>
        );
      })}

      <motion.div
        className="absolute top-0 left-0 pointer-events-none box-border border-0"
        animate={{
          x: focusRect.x,
          y: focusRect.y,
          width: focusRect.width,
          height: focusRect.height,
          opacity: currentIndex >= 0 ? 1 : 0
        }}
        transition={{
          duration: animationDuration
        }}
      >
        <span
          className="absolute w-3 h-3 border-[2px] rounded-[2px] top-[-6px] left-[-6px] border-r-0 border-b-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 3px var(--border-color))'
          }}
        ></span>
        <span
          className="absolute w-3 h-3 border-[2px] rounded-[2px] top-[-6px] right-[-6px] border-l-0 border-b-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 3px var(--border-color))'
          }}
        ></span>
        <span
          className="absolute w-3 h-3 border-[2px] rounded-[2px] bottom-[-6px] left-[-6px] border-r-0 border-t-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 3px var(--border-color))'
          }}
        ></span>
        <span
          className="absolute w-3 h-3 border-[2px] rounded-[2px] bottom-[-6px] right-[-6px] border-l-0 border-t-0"
          style={{
            borderColor: 'var(--border-color)',
            filter: 'drop-shadow(0 0 3px var(--border-color))'
          }}
        ></span>
      </motion.div>
    </div>
  );
};

export default TrueFocus;
