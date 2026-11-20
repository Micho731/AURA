import React, { useState, useRef, useEffect } from 'react';
import Avatar from '../components/Avatar';
import { openFaceChannel, FACE_MSG } from '../lib/faceChannel';

/**
 * Face window — runs OFFLINE on the extended monitor. Pure avatar, no controls, NO network.
 * It receives AURA's audio (as a Blob) + lip-sync visemes from the Display window over the
 * in-browser BroadcastChannel, and plays them. It never calls the server itself.
 *
 * One tap is still needed once to satisfy the browser's audio-autoplay policy.
 */
export default function Face() {
  const [unlocked, setUnlocked] = useState(false);
  const [mouth, setMouth] = useState('neutral');
  const [expression, setExpression] = useState('neutral');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [dim, setDim] = useState({ w: window.innerWidth, h: window.innerHeight });

  const audioRef = useRef(new Audio());
  const visemesRef = useRef([]);
  const mouthRef = useRef('neutral');
  const objUrlRef = useRef(null);
  const chRef = useRef(null);

  // Lip-sync calibration: mouth leads the audio slightly to feel in sync.
  const LIPSYNC_LEAD = 0.06;

  useEffect(() => {
    const onResize = () => setDim({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Lip-sync animation tied to the audio clock
  useEffect(() => {
    const audio = audioRef.current;
    let raf;
    const CYCLE = ['AI', 'CONS', 'OO', 'E', 'MBP'];  // natural talking loop (new viseme labels)
    const tick = () => {
      const ct = audio.currentTime + LIPSYNC_LEAD;
      const vis = visemesRef.current;
      const v = vis.find(x => ct >= x.start && ct <= x.end);
      let next;
      if (v) next = v.mouth;
      else if (!audio.paused && !audio.ended && audio.currentTime > 0.05)
        next = CYCLE[Math.floor(audio.currentTime * 8) % CYCLE.length];
      else next = 'neutral';
      if (next !== mouthRef.current) { mouthRef.current = next; setMouth(next); }
      if (!audio.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setIsSpeaking(true);
      chRef.current?.postMessage({ type: FACE_MSG.STARTED });
      raf = requestAnimationFrame(tick);
    };
    const onEnd  = () => {
      setIsSpeaking(false); mouthRef.current = 'neutral'; setMouth('neutral'); cancelAnimationFrame(raf);
      chRef.current?.postMessage({ type: FACE_MSG.ENDED });
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('pause', onEnd);  // also report if playback is interrupted
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('pause', onEnd);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Receive speak/state messages from the Display window (in-browser, no network)
  useEffect(() => {
    if (!unlocked) return;
    const ch = openFaceChannel();
    chRef.current = ch;
    ch.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === FACE_MSG.SPEAK) {
        setExpression(msg.expression || 'neutral');
        visemesRef.current = msg.visemes || [];
        if (msg.audioBlob) {
          if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
          objUrlRef.current = URL.createObjectURL(msg.audioBlob);
          audioRef.current.src = objUrlRef.current;
          audioRef.current.play().catch(e => console.warn('Audio blocked:', e));
        }
      } else if (msg.type === FACE_MSG.STATE) {
        setExpression(msg.expression || 'neutral');
      } else if (msg.type === FACE_MSG.RESET) {
        try { audioRef.current.pause(); } catch (e) {}
        setExpression('neutral'); setMouth('neutral'); setIsSpeaking(false);
      }
    };
    return () => { chRef.current = null; ch.close(); };
  }, [unlocked]);

  const unlock = () => {
    setUnlocked(true);
    audioRef.current.play().catch(() => {});
    audioRef.current.pause();
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  if (!unlocked) {
    return (
      <div onClick={unlock} className="fixed inset-0 flex flex-col items-center justify-center bg-aura-ink cursor-pointer">{/* tap to activate */}
        <div className="w-24 h-24 rounded-full border border-aura-cyan/30 flex items-center justify-center animate-breath">
          <div className="w-12 h-12 rounded-full bg-aura-cyan/80 shadow-[0_0_40px_rgba(124,231,255,0.6)]" />
        </div>
        <p className="mt-8 text-aura-cyan text-sm tracking-[0.3em] font-light">TAP TO ACTIVATE</p>
        <p className="mt-2 text-zinc-500 text-xs tracking-wider">AURA · FOE Reception · Face</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-aura-ink overflow-hidden">
      <Avatar mouthState={mouth} expression={expression} isSpeaking={isSpeaking} width={dim.w} height={dim.h} />
    </div>
  );
}
