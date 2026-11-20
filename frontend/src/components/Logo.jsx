import React, { useState } from 'react';

/**
 * Logo — renders an image from /public/logos, with a graceful text fallback if the file isn't
 * present yet (so the UI never breaks while logos are being added). Loads fully offline.
 *
 * Files expected in frontend/public/logos/:
 *   aura-robot.png · aust-seal.png · foe-shield.png
 */
const SRC = {
  aura: '/logos/aura-robot.png',
  aust: '/logos/aust-seal.png',
  foe: '/logos/foe-shield.png',
};
const FALLBACK = {
  aura: 'AURA',
  aust: 'AUST',
  foe: 'FOE',
};

export default function Logo({ name, className = '', style, alt }) {
  const [failed, setFailed] = useState(false);
  if (failed || !SRC[name]) {
    return (
      <span
        className={`inline-flex items-center justify-center font-display font-black text-aura-cyan/80 ${className}`}
        style={style}
      >
        {FALLBACK[name] || '?'}
      </span>
    );
  }
  return (
    <img
      src={SRC[name]}
      alt={alt || FALLBACK[name]}
      className={className}
      style={style}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
