import React, { useRef, useEffect } from 'react';

/**
 * AURA face — minimalist, friendly, portrait-oriented.
 * Nothing but eyes, mouth, and a soft halo. No HUD, no text, no telemetry.
 *
 * Rendered on a DPI-scaled canvas so it stays crisp on phone screens.
 */

const EYE = '#7CE7FF';
const EYE_GLOW = 'rgba(124, 231, 255, 0.55)';
const HALO = 'rgba(124, 231, 255, 0.10)';

// ---------- Eye shapes -----------------------------------------------------

function drawEye(ctx, x, y, r, blink, expression, t, isLeft) {
  ctx.save();

  if (expression === 'happy') {
    // Closed-arc smile-eye
    ctx.strokeStyle = EYE;
    ctx.lineWidth = r * 0.28;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 24;
    ctx.shadowColor = EYE_GLOW;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.3, r, Math.PI + 0.25, -0.25);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (expression === 'thinking') {
    // Rotating arc + dot
    const angle = t * 0.0025 * (isLeft ? 1 : -1);
    ctx.strokeStyle = EYE;
    ctx.lineWidth = r * 0.18;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 18;
    ctx.shadowColor = EYE_GLOW;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.95, angle, angle + Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (expression === 'sad') {
    // Tilted, smaller eyes with droop
    const eyeH = r * (1 - blink) * 0.8;
    if (eyeH < 1) { ctx.restore(); return; }
    ctx.translate(x, y);
    ctx.rotate(isLeft ? 0.35 : -0.35);
    ctx.shadowBlur = 20;
    ctx.shadowColor = EYE_GLOW;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, '#d6f7ff');
    grad.addColorStop(0.6, EYE);
    grad.addColorStop(1, 'rgba(124,231,255,0.3)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, eyeH * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Neutral — soft circular eye with inner highlight
  const eyeH = r * (1 - blink);
  if (eyeH < 1) {
    // Closed: thin horizontal line
    ctx.strokeStyle = EYE;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 16;
    ctx.shadowColor = EYE_GLOW;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.9, y);
    ctx.lineTo(x + r * 0.9, y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.shadowBlur = 28;
  ctx.shadowColor = EYE_GLOW;
  const grad = ctx.createRadialGradient(x - r * 0.1, y - r * 0.15, r * 0.05, x, y, r);
  grad.addColorStop(0, '#eafcff');
  grad.addColorStop(0.5, EYE);
  grad.addColorStop(1, 'rgba(124, 231, 255, 0.55)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x, y, r, eyeH, 0, 0, Math.PI * 2);
  ctx.fill();

  // White highlight
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.32, y - eyeH * 0.3, r * 0.18, eyeH * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ---------- Lip model ------------------------------------------------------
// Each viseme is a set of numeric params the renderer morphs between, so lips flow like real speech.
//   open   : vertical gap (0 shut .. 1 wide)
//   width  : horizontal spread (1 = neutral; <1 pursed, >1 spread)
//   round  : corner pull-in for o/oo (0 none .. 1 tight)
//   teeth  : show upper teeth band (0..1)
//   tongue : tongue hint for L/TH (0..1)
//   curve  : smile(+)/frown(-) of the rest line (idle expressions)
const REST = { open: 0.04, width: 1.0, round: 0, teeth: 0, tongue: 0, curve: 0 };
const VISEME_SHAPES = {
  rest:    { ...REST },
  neutral: { ...REST },
  MBP:     { open: 0.0,  width: 1.0,  round: 0.0, teeth: 0,   tongue: 0,   curve: 0 },   // m/b/p lips shut
  FV:      { open: 0.12, width: 1.02, round: 0.0, teeth: 0.8, tongue: 0,   curve: 0 },   // f/v lip to teeth
  AI:      { open: 0.85, width: 1.05, round: 0.0, teeth: 0.2, tongue: 0,   curve: 0 },   // "ah" wide open
  E:       { open: 0.42, width: 1.30, round: 0.0, teeth: 0.5, tongue: 0,   curve: 0 },   // "ee" wide spread
  O:       { open: 0.62, width: 0.78, round: 0.7, teeth: 0,   tongue: 0,   curve: 0 },   // "oh" open round
  OO:      { open: 0.34, width: 0.55, round: 1.0, teeth: 0,   tongue: 0,   curve: 0 },   // "oo"/w tight round
  L:       { open: 0.45, width: 1.05, round: 0.0, teeth: 0.2, tongue: 1.0, curve: 0 },   // tongue tip
  TH:      { open: 0.30, width: 1.05, round: 0.0, teeth: 0.4, tongue: 0.7, curve: 0 },   // tongue-teeth
  R:       { open: 0.40, width: 0.90, round: 0.4, teeth: 0.2, tongue: 0,   curve: 0 },   // slight round
  CONS:    { open: 0.22, width: 1.05, round: 0.0, teeth: 0.6, tongue: 0,   curve: 0 },   // generic consonant
  // legacy labels (back-compat with any stale viseme) → nearest new shape
  open:    { open: 0.8,  width: 1.05, round: 0.0, teeth: 0.2, tongue: 0,   curve: 0 },
  rounded: { open: 0.4,  width: 0.6,  round: 1.0, teeth: 0,   tongue: 0,   curve: 0 },
  closed:  { open: 0.0,  width: 1.0,  round: 0,   teeth: 0,   tongue: 0,   curve: 0 },
  teeth:   { open: 0.25, width: 1.05, round: 0,   teeth: 0.8, tongue: 0,   curve: 0 },
  // idle expression mouths
  smile:   { open: 0.06, width: 1.15, round: 0,   teeth: 0,   tongue: 0,   curve: 1 },
  frown:   { open: 0.06, width: 0.95, round: 0,   teeth: 0,   tongue: 0,   curve: -1 },
};

export function shapeFor(label) {
  return VISEME_SHAPES[label] || REST;
}

// Draw lips from an interpolated param vector `p` (already morphed). Cyan AURA aesthetic.
function drawLips(ctx, cx, cy, scale, p, t, isSpeaking) {
  const halfW = (56 * scale) * (p.width);
  const gap = (52 * scale) * p.open;                 // vertical opening
  const corner = (1 - p.round) ;                      // 1 = corners out, 0 = pulled in
  const xL = cx - halfW * (0.55 + 0.45 * corner);
  const xR = cx + halfW * (0.55 + 0.45 * corner);
  const topRest = cy + (p.curve ? -p.curve * 10 * scale : 0);
  const upperY = cy - gap * 0.5;
  const lowerY = cy + gap * 0.5 + (p.curve < 0 ? -p.curve * 8 * scale : 0);
  const lipPeak = 10 * scale;                         // cupid's-bow height of the upper lip

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 18;
  ctx.shadowColor = EYE_GLOW;

  // --- mouth interior (dark) when open ---
  if (gap > 2 * scale) {
    ctx.beginPath();
    ctx.moveTo(xL, topRest);
    ctx.quadraticCurveTo(cx, upperY, xR, topRest);
    ctx.quadraticCurveTo(cx, lowerY, xL, topRest);
    ctx.closePath();
    const ig = ctx.createLinearGradient(0, upperY, 0, lowerY);
    ig.addColorStop(0, 'rgba(8,20,34,0.95)');
    ig.addColorStop(1, 'rgba(10,28,46,0.85)');
    ctx.fillStyle = ig;
    ctx.shadowBlur = 0;
    ctx.fill();

    // upper teeth band
    if (p.teeth > 0.05) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xL, topRest);
      ctx.quadraticCurveTo(cx, upperY, xR, topRest);
      ctx.lineTo(xR, topRest);
      ctx.quadraticCurveTo(cx, upperY + 7 * scale * p.teeth, xL, topRest);
      ctx.closePath();
      ctx.fillStyle = `rgba(220,248,255,${0.55 * p.teeth})`;
      ctx.fill();
      ctx.restore();
    }
    // tongue hint
    if (p.tongue > 0.05) {
      ctx.beginPath();
      ctx.ellipse(cx, lowerY - 4 * scale, halfW * 0.32, gap * 0.18 + 2 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(124,231,255,${0.30 * p.tongue})`;
      ctx.fill();
    }
  }

  // --- lip outline (glowing cyan) ---
  ctx.shadowBlur = 20;
  ctx.shadowColor = EYE_GLOW;
  ctx.strokeStyle = EYE;
  ctx.lineWidth = 7 * scale;

  // upper lip: cupid's bow
  ctx.beginPath();
  ctx.moveTo(xL, topRest);
  ctx.quadraticCurveTo(cx - halfW * 0.45, upperY - lipPeak * 0.4, cx - halfW * 0.16, upperY);
  ctx.quadraticCurveTo(cx, upperY + 3 * scale, cx + halfW * 0.16, upperY);
  ctx.quadraticCurveTo(cx + halfW * 0.45, upperY - lipPeak * 0.4, xR, topRest);
  ctx.stroke();

  // lower lip
  ctx.beginPath();
  ctx.moveTo(xL, topRest);
  ctx.quadraticCurveTo(cx, lowerY, xR, topRest);
  ctx.stroke();

  ctx.restore();
}

// ---------- Background and halo --------------------------------------------

function drawBackground(ctx, w, h, t, isSpeaking) {
  // Pure dark vignette
  const grad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, '#0A1628');
  grad.addColorStop(1, '#050810');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Soft halo around the face when speaking
  const haloR = Math.min(w, h) * 0.45;
  const pulse = isSpeaking ? 1 + Math.sin(t * 0.005) * 0.04 : 1;
  const haloGrad = ctx.createRadialGradient(w / 2, h / 2, haloR * 0.6 * pulse, w / 2, h / 2, haloR * 1.4 * pulse);
  haloGrad.addColorStop(0, HALO);
  haloGrad.addColorStop(1, 'rgba(124, 231, 255, 0)');
  ctx.fillStyle = haloGrad;
  ctx.fillRect(0, 0, w, h);
}

// ---------- Main draw ------------------------------------------------------

// Resolve which lip shape the mouth should target right now.
function targetShape(state) {
  // Idle (not speaking): show the expression's mouth (smile/frown) or a soft rest.
  if (!state.isSpeaking) {
    if (state.expression === 'happy') return VISEME_SHAPES.smile;
    if (state.expression === 'sad') return VISEME_SHAPES.frown;
    return REST;
  }
  return shapeFor(state.mouth);
}

function draw(ctx, w, h, t, state) {
  drawBackground(ctx, w, h, t, state.isSpeaking);

  const cx = w / 2;
  const cy = h / 2;
  // Zoomed-in face: base the scale on the screen height so the features fill the display
  // (works for the 1920x1200 tablet in landscape). Larger divisor denominator = smaller face.
  const scale = h / 300;

  // Subtle breathing
  const breath = Math.sin(t * 0.0014) * 3 * scale;
  const faceCy = cy + breath;

  const eyeR = 42 * scale;
  const eyeSpacing = 120 * scale;
  const eyeY = faceCy - 60 * scale;
  const mouthY = faceCy + 80 * scale;

  drawEye(ctx, cx - eyeSpacing, eyeY, eyeR, state.blink, state.expression, t, true);
  drawEye(ctx, cx + eyeSpacing, eyeY, eyeR, state.blink, state.expression, t, false);

  drawLips(ctx, cx, mouthY, scale, state.lip, t, state.isSpeaking);
}

// ---------- Component ------------------------------------------------------

export default function Avatar({
  mouthState = 'neutral',
  expression = 'neutral',
  isSpeaking = false,
  width,
  height,
}) {
  const canvasRef = useRef(null);
  // `lip` is the LIVE param vector that morphs toward the target shape every frame.
  const stateRef = useRef({
    mouth: 'neutral', expression: 'neutral', isSpeaking: false, blink: 0,
    lip: { ...REST },
  });
  const blinkPhaseRef = useRef(0);

  // Sync incoming props into refs (so the rAF loop reads current values)
  useEffect(() => { stateRef.current.mouth = mouthState; }, [mouthState]);
  useEffect(() => { stateRef.current.expression = expression; }, [expression]);
  useEffect(() => { stateRef.current.isSpeaking = isSpeaking; }, [isSpeaking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Blink scheduler
    let nextBlinkAt = performance.now() + 2500 + Math.random() * 3000;

    let rafId;
    const loop = (t) => {
      // Blink state machine
      if (t >= nextBlinkAt && blinkPhaseRef.current === 0) {
        blinkPhaseRef.current = 1; // closing
      }
      if (blinkPhaseRef.current === 1) {
        stateRef.current.blink += 0.22;
        if (stateRef.current.blink >= 1) {
          stateRef.current.blink = 1;
          blinkPhaseRef.current = -1;
        }
      } else if (blinkPhaseRef.current === -1) {
        stateRef.current.blink -= 0.22;
        if (stateRef.current.blink <= 0) {
          stateRef.current.blink = 0;
          blinkPhaseRef.current = 0;
          nextBlinkAt = t + 2500 + Math.random() * 3500;
        }
      }

      // Morph the live lip params toward the current target shape (this is what makes the lips
      // FLOW between sounds like real speech instead of snapping). Speaking morphs fast; idle slow.
      const tgt = targetShape(stateRef.current);
      const cur = stateRef.current.lip;
      const k = stateRef.current.isSpeaking ? 0.45 : 0.18;
      for (const key in REST) {
        cur[key] += ((tgt[key] ?? 0) - cur[key]) * k;
      }

      draw(ctx, width, height, t, stateRef.current);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
    />
  );
}
