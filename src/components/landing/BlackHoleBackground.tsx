'use client';

import { useEffect, useMemo, useRef } from 'react';

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Star {
  x: string;
  y: string;
  size: number;
  delay: string;
  duration: string;
  opacity: number;
}

function makeStars(count: number): Star[] {
  const rand = seededRand(424242);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: `${(rand() * 100).toFixed(2)}%`,
      y: `${(rand() * 100).toFixed(2)}%`,
      size: 1 + rand() * 1.8,
      delay: `${(rand() * 6).toFixed(2)}s`,
      duration: `${(2.5 + rand() * 4.5).toFixed(2)}s`,
      opacity: 0.25 + rand() * 0.55,
    });
  }
  return stars;
}

export function BlackHoleBackground() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const stars = useMemo(() => makeStars(110), []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let sx = 0;
    let sy = 0;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const onPointer = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 16;
      ty = (e.clientY / window.innerHeight - 0.5) * 12;
    };

    const tick = () => {
      sx += (tx - sx) * 0.045;
      sy += (ty - sy) * 0.045;
      scene.style.transform = `translate3d(${sx.toFixed(2)}px, ${sy.toFixed(
        2
      )}px, 0) rotateX(${(-8 - sy / 3).toFixed(2)}deg) rotateY(${(
        sx / 2
      ).toFixed(2)}deg)`;
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black">
      {/* deep-space nebula base */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_-20%,#1c1c28_0%,#0a0a0f_45%,#000_75%)]" />

      {/* starfield */}
      {stars.map((star, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: star.x,
            top: star.y,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            animation: `twinkle ${star.duration} ease-in-out ${star.delay} infinite`,
            boxShadow: '0 0 6px rgba(255,255,255,0.55)',
          }}
        />
      ))}

      {/* 3D scene (parallax layer) */}
      <div
        ref={sceneRef}
        className="absolute inset-0"
        style={{ perspective: '1100px', transformStyle: 'preserve-3d' }}
      >
        {/* slow swirling nebula behind the hole */}
        <div
          className="absolute left-1/2 top-[52%] h-[130vmax] w-[130vmax] -translate-x-1/2 -translate-y-1/2"
          style={{ animation: 'spin 70s linear infinite' }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, transparent 0deg, rgba(251,146,60,0.14) 55deg, transparent 120deg, rgba(59,130,246,0.10) 190deg, transparent 260deg, rgba(168,85,247,0.10) 315deg, transparent 360deg)',
              filter: 'blur(36px)',
            }}
          />
          <div
            className="absolute inset-[12%] rounded-full"
            style={{
              background:
                'conic-gradient(from 180deg, transparent 0deg, rgba(249,115,22,0.14) 70deg, transparent 150deg, rgba(251,191,36,0.12) 225deg, transparent 300deg, rgba(217,70,239,0.14) 340deg, transparent 360deg)',
              filter: 'blur(30px)',
              animation: 'spin 46s linear infinite reverse',
            }}
          />
        </div>

        {/* tilted accretion disk — the classic black hole swirl */}
        <div
          className="absolute left-1/2 top-[58%] h-[92vmin] w-[92vmin]"
          style={{
            transform: 'translate(-50%, -50%) rotateX(74deg)',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* outer diffuse swirl */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, transparent 0deg, rgba(251,146,60,0.35) 38deg, rgba(251,191,36,0.45) 90deg, rgba(255,255,255,0.20) 135deg, transparent 195deg, rgba(168,85,247,0.22) 255deg, transparent 335deg, transparent 360deg)',
              filter: 'blur(16px)',
              animation: 'spin 26s linear infinite reverse',
            }}
          />
          {/* mid glowing band */}
          <div
            className="absolute inset-[12%] rounded-full"
            style={{
              background:
                'conic-gradient(from 120deg, transparent 0deg, rgba(255,237,213,0.9) 28deg, rgba(251,146,60,0.95) 68deg, rgba(251,191,36,0.9) 118deg, rgba(255,255,255,0.7) 158deg, transparent 210deg, rgba(217,70,239,0.5) 272deg, transparent 332deg, transparent 360deg)',
              filter: 'blur(6px)',
              animation: 'spin 11s linear infinite',
            }}
          />
          {/* inner white-hot band */}
          <div
            className="absolute inset-[26%] rounded-full"
            style={{
              background:
                'conic-gradient(from 60deg, rgba(255,255,255,1) 0deg, rgba(253,230,138,0.98) 22deg, rgba(251,146,60,0.92) 48deg, rgba(255,255,255,0.95) 80deg, rgba(255,251,235,0.85) 118deg, rgba(249,115,22,0.8) 158deg, rgba(255,255,255,0.9) 215deg, rgba(240,171,252,0.7) 270deg, rgba(255,255,255,1) 330deg, rgba(255,255,255,1) 360deg)',
              filter: 'blur(2px)',
              boxShadow: '0 0 60px 6px rgba(251,191,36,0.45)',
              animation: 'spin 5.5s linear infinite',
            }}
          />
        </div>

        {/* photon ring + event horizon (face-on) */}
        <div
          className="absolute left-1/2 top-[58%] h-[38vmin] w-[38vmin] -translate-x-1/2 -translate-y-1/2"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* rotating shimmer arcs around the ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ animation: 'spin 8s linear infinite' }}
          >
            <span
              className="absolute left-1/2 top-0 h-8 w-px -translate-x-1/2"
              style={{
                background:
                  'linear-gradient(to bottom, transparent, rgba(255,255,255,0.95), rgba(251,191,36,0.7), transparent)',
                filter: 'blur(1px)',
                boxShadow: '0 0 10px rgba(255,255,255,0.85)',
              }}
            />
          </div>
          {/* glowing photon ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle, transparent 56%, rgba(255,255,255,0.8) 61%, rgba(253,230,138,0.6) 66%, rgba(251,146,60,0.45) 71%, transparent 79%)',
              boxShadow:
                '0 0 70px 14px rgba(251,191,36,0.42), 0 0 150px 45px rgba(249,115,22,0.22), inset 0 0 60px rgba(251,146,60,0.5)',
              animation: 'glow 4.5s ease-in-out infinite',
            }}
          />
          {/* black sphere core */}
          <div
            className="absolute inset-[12%] rounded-full"
            style={{
              background:
                'radial-gradient(circle at 40% 32%, #16161f 0%, #000 48%, #000 100%)',
              boxShadow:
                'inset 0 0 80px 16px #000, 0 0 120px 40px rgba(0,0,0,0.95)',
            }}
          />
        </div>

        {/* orbiting light streaks being pulled into the hole */}
        <div
          className="absolute left-1/2 top-[58%] h-[46vmin] w-[46vmin]"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          <div className="absolute inset-0" style={{ animation: 'spin 3.6s linear infinite' }}>
            <span
              className="absolute left-1/2 top-0 h-14 w-[2px] -translate-x-1/2"
              style={{
                background:
                  'linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.95) 40%, rgba(251,191,36,0.7) 70%, rgba(249,115,22,0.4) 100%)',
                filter: 'blur(1px)',
                boxShadow: '0 0 10px rgba(255,255,255,0.9)',
              }}
            />
          </div>
        </div>
        <div
          className="absolute left-1/2 top-[58%] h-[52vmin] w-[52vmin]"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          <div
            className="absolute inset-0"
            style={{ animation: 'spin 5.2s linear infinite reverse' }}
          >
            <span
              className="absolute left-1/2 top-0 h-16 w-[2px] -translate-x-1/2"
              style={{
                background:
                  'linear-gradient(to bottom, transparent 0%, rgba(255,237,213,0.8) 45%, rgba(249,115,22,0.55) 75%, transparent 100%)',
                filter: 'blur(1px)',
                boxShadow: '0 0 8px rgba(251,191,36,0.8)',
              }}
            />
          </div>
        </div>

        {/* front arc of the disk — passes in front of the event horizon */}
        <div
          className="absolute left-1/2 top-[58%] h-[92vmin] w-[92vmin]"
          style={{
            transform: 'translate(-50%, -50%) rotateX(74deg)',
            transformStyle: 'preserve-3d',
            clipPath: 'polygon(0 100%, 100% 100%, 100% 52%, 0 52%)',
          }}
        >
          <div
            className="absolute inset-[12%] rounded-full"
            style={{
              background:
                'conic-gradient(from 120deg, transparent 0deg, rgba(255,237,213,0.95) 28deg, rgba(251,146,60,0.98) 68deg, rgba(251,191,36,0.95) 118deg, rgba(255,255,255,0.8) 158deg, transparent 210deg, rgba(217,70,239,0.55) 272deg, transparent 332deg, transparent 360deg)',
              filter: 'blur(4px)',
              animation: 'spin 11s linear infinite',
            }}
          />
          <div
            className="absolute inset-[26%] rounded-full"
            style={{
              background:
                'conic-gradient(from 60deg, rgba(255,255,255,1) 0deg, rgba(253,230,138,0.98) 22deg, rgba(251,146,60,0.95) 48deg, rgba(255,255,255,1) 80deg, rgba(255,251,235,0.9) 118deg, rgba(249,115,22,0.85) 158deg, rgba(255,255,255,0.95) 215deg, rgba(240,171,252,0.75) 270deg, rgba(255,255,255,1) 330deg, rgba(255,255,255,1) 360deg)',
              filter: 'blur(1.5px)',
              boxShadow: '0 0 70px 10px rgba(251,191,36,0.55)',
              animation: 'spin 5.5s linear infinite',
            }}
          />
        </div>
      </div>

      {/* bottom lensing glow — light bending under the hole */}
      <div
        className="absolute left-0 bottom-0 h-[55vh] w-full"
        style={{
          background:
            'radial-gradient(ellipse 62% 100% at 50% 100%, rgba(251,146,60,0.22) 0%, rgba(249,115,22,0.12) 30%, rgba(0,0,0,0.88) 55%, transparent 82%)',
          filter: 'blur(14px)',
        }}
      />

      {/* readability vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_78%_at_50%_40%,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.55)_60%,rgba(0,0,0,0.94)_100%)]" />
    </div>
  );
}