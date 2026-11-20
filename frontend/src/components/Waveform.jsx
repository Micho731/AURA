import React, { useRef, useEffect } from 'react';

/**
 * Waveform — an audio-spectrum visualizer rendered on canvas.
 *
 * Modes:
 *   'listening' — bars react live to the mic spectrum (the student is speaking / can speak)
 *   'thinking'  — a calm travelling pulse (AURA is processing)
 *   'speaking'  — animated bars while AURA talks
 *   'idle'      — same as listening but calmer
 *
 * Pass `spectrum` (array 0..1) for live mic data. For thinking/speaking we self-animate.
 */
export default function Waveform({ mode = 'listening', spectrum = [], color = '#7CE7FF' }) {
  const canvasRef = useRef(null);
  const specRef = useRef(spectrum);
  const smoothRef = useRef([]);
  const rafRef = useRef(null);
  const tRef = useRef(0);

  useEffect(() => { specRef.current = spectrum; }, [spectrum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const BARS = 36;
    if (smoothRef.current.length !== BARS) smoothRef.current = new Array(BARS).fill(0);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      tRef.current += 0.05;
      const t = tRef.current;

      const live = specRef.current || [];
      const target = new Array(BARS);
      for (let i = 0; i < BARS; i++) {
        const center = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2); // 0 at edges, 1 in middle
        if (mode === 'thinking') {
          // travelling soft wave
          target[i] = 0.12 + 0.20 * Math.max(0, Math.sin(t * 1.6 - i * 0.4)) * (0.4 + 0.6 * center);
        } else if (mode === 'speaking') {
          // lively multi-frequency bounce
          target[i] = 0.18 + (0.55 * Math.abs(Math.sin(t * 2.3 + i * 0.5)) * (0.5 + 0.5 * center));
        } else {
          // listening / idle — driven by the live mic spectrum
          const v = live[i] != null ? live[i] : 0;
          const idleFloor = 0.04 + 0.03 * Math.sin(t * 1.2 + i * 0.6);
          target[i] = Math.max(idleFloor, Math.min(1, v * 1.4)) * (0.45 + 0.55 * center);
        }
      }

      // smooth toward target
      const sm = smoothRef.current;
      for (let i = 0; i < BARS; i++) sm[i] += (target[i] - sm[i]) * 0.35;

      const gap = 4;
      const bw = (w - gap * (BARS - 1)) / BARS;
      for (let i = 0; i < BARS; i++) {
        const bh = Math.max(3, sm[i] * h * 0.9);
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        const r = bw / 2;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5 + 0.5 * sm[i];
        // rounded bar
        ctx.beginPath();
        ctx.moveTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.arcTo(x + bw, y, x + bw, y + r, r);
        ctx.lineTo(x + bw, y + bh - r);
        ctx.arcTo(x + bw, y + bh, x + bw - r, y + bh, r);
        ctx.arcTo(x, y + bh, x, y + bh - r, r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [mode, color]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}
