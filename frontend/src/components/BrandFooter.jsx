import React from 'react';
import Logo from './Logo';
import { INSTITUTION_NAME, FACULTY_NAME } from '../config';

/**
 * BrandFooter — the institutional branding (university seal + faculty shield), shown
 * together with a subtle divider. One source of truth, reused on Home, Faculty, Admin, and a
 * corner of the Display.
 */
export default function BrandFooter({ className = '', size = 'md' }) {
  const h = size === 'sm' ? 'h-10' : size === 'lg' ? 'h-20' : 'h-14';
  const div = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-16' : 'h-10';
  return (
    <div className={`flex items-center justify-center gap-8 opacity-90 ${className}`}>
      <Logo name="university" className={`${h} w-auto object-contain`} alt={INSTITUTION_NAME} />
      <span className={`w-px ${div} bg-white/15`} />
      <Logo name="faculty" className={`${h} w-auto object-contain`} alt={FACULTY_NAME} />
    </div>
  );
}
