import React from 'react';
import Logo from './Logo';

/**
 * BrandFooter — the institutional branding (AUST seal + Faculty of Engineering shield), shown
 * together with a subtle divider. One source of truth, reused on Home, Faculty, Admin, and a
 * corner of the Display.
 */
export default function BrandFooter({ className = '', size = 'md' }) {
  const h = size === 'sm' ? 'h-10' : size === 'lg' ? 'h-20' : 'h-14';
  const div = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-16' : 'h-10';
  return (
    <div className={`flex items-center justify-center gap-8 opacity-90 ${className}`}>
      <Logo name="aust" className={`${h} w-auto object-contain`} alt="American University of Science & Technology" />
      <span className={`w-px ${div} bg-white/15`} />
      <Logo name="foe" className={`${h} w-auto object-contain`} alt="Faculty of Engineering" />
    </div>
  );
}
