import React, { useState } from 'react';

/**
 * Logo — renders an image from /public/logos, with a graceful text fallback if the file isn't
 * present yet (so the UI never breaks while logos are being added). Loads fully offline.
 *
 * Files expected in frontend/public/logos/:
 *   aura-robot.png · university-seal.png · faculty-shield.png
 */
const SRC = {
  aura: '/logos/aura-robot.png',
  university: '/logos/university-seal.png',
  faculty: '/logos/faculty-shield.png',
};
const FALLBACK = {
  aura: 'AURA',
  university: 'UNI',
  faculty: 'FAC',
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
