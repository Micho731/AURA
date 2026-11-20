import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, Keyboard, Send } from 'lucide-react';
import { API, jsonFetch } from '../api';
import { VoiceListener } from '../lib/recorder';
import Waveform from '../components/Waveform';
import Logo from '../components/Logo';
import BrandFooter from '../components/BrandFooter';
import { SmartCard } from '../components/Cards';
import { openFaceChannel, FACE_MSG } from '../lib/faceChannel';
import { usePresence } from '../lib/usePresence';

/**
 * Belly display — minimal, voice-first. The single "brain client": it captures speech, calls the
 * backend over on-device loopback, shows the transcript + waveform, and forwards AURA's audio to
 * the offline Face window via the in-browser BroadcastChannel (no network for the face).
 *
 * Memory is NOT cleared on a timer — the conversation persists until the next student arrives
 * (a fresh page load / kiosk relaunch clears it).
 */

const WAKE_PATTERN = /^\s*(hey|hi|hello|ok|okay)?\s*(aura|aurora|aurelia|ora|hara|oora|orla)\b/i;
const MODES = { IDLE: 'idle', PROCESSING: 'processing', SPEAKING: 'speaking' };

// AURA's self-introduction, spoken when a new visitor engages.
const GREETING = "Hi there! I'm AURA, the assistant for the Faculty of Engineering and Computer Science at AUST. What can I do for you?";

// Varied, friendly lines for when AURA can't understand the speech — picked at random so it never
// sounds like a broken record.
const REPHRASE_LINES = [
  "Hmm, I didn't quite catch that — could you say it again?",
  "Sorry, I missed that. Could you repeat it for me?",
  "I didn't get that one. Mind saying it again, in English?",
  "Oops, that didn't come through clearly — one more time?",
  "I want to get this right — could you rephrase that?",
  "Let's try that again — what would you like to know?",
];
const pickRephrase = () => REPHRASE_LINES[Math.floor(Math.random() * REPHRASE_LINES.length)];

// Silent hint lines that gently rotate on the dormant screen so visitors learn what AURA can do.
const ATTRACT_HINTS = [
  'Ask me about programs, labs, or admissions.',
  'Want to meet an instructor? Just ask.',
  'Looking for an office or a building? I can help.',
  'Ask about courses, computer science, or the campuses.',
];

export default function Display() {
  const [mode, setMode] = useState(MODES.IDLE);
  const [turns, setTurns] = useState([]);        // [{role:'user'|'aura', text}]
  const [capturing, setCapturing] = useState(false);
  const [spectrum, setSpectrum] = useState([]);
  const [time, setTime] = useState(new Date());
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState('');
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const [engaged, setEngaged] = useState(false);   // CV presence: is a person in front & looking?
  const [hintIdx, setHintIdx] = useState(0);        // rotating attract hint on the dormant screen
  const [card, setCard] = useState(null);           // rich SmartCard shown below the transcript
  const engagedRef = useRef(false);

  const vlRef = useRef(null);
  const modeRef = useRef(MODES.IDLE);
  const speakingTimeoutRef = useRef(null);
  const cooldownUntilRef = useRef(0);
  const historyRef = useRef([]);
  const apptWatchRef = useRef(null);
  const processingGuardRef = useRef(null);
  const faceChRef = useRef(null);
  const lastRephraseAtRef = useRef(0);   // circuit-breaker: stops the "didn't catch that" loop

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { engagedRef.current = engaged; }, [engaged]);
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Silent attract-hint rotation — only runs while dormant; never plays audio.
  useEffect(() => {
    if (engaged) return;
    const id = setInterval(() => setHintIdx(i => (i + 1) % ATTRACT_HINTS.length), 5000);
    return () => clearInterval(id);
  }, [engaged]);

  // Open the in-browser link to the offline Face window.
  // End the SPEAKING state: resume the mic (after a short cooldown so it doesn't catch the tail).
  const endSpeaking = useCallback(() => {
    if (speakingTimeoutRef.current) { clearTimeout(speakingTimeoutRef.current); speakingTimeoutRef.current = null; }
    cooldownUntilRef.current = Date.now() + 1500;  // ignore the audio tail so re-engagement is clean
    setMode(MODES.IDLE);
    vlRef.current?.resume();
  }, []);

  useEffect(() => {
    const ch = openFaceChannel();
    faceChRef.current = ch;
    ch.postMessage({ type: FACE_MSG.RESET });
    // The face window reports when its audio ACTUALLY starts/ends — the accurate source of truth.
    ch.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === FACE_MSG.STARTED) {
        if (speakingTimeoutRef.current) { clearTimeout(speakingTimeoutRef.current); speakingTimeoutRef.current = null; }
        setMode(MODES.SPEAKING);
        vlRef.current?.pause();
      } else if (msg.type === FACE_MSG.ENDED) {
        endSpeaking();
      }
    };
    return () => { faceChRef.current = null; ch.close(); };
  }, [endSpeaking]);

  // Fetch AURA's audio once and forward it (as a Blob) + lip-sync to the Face window. We enter
  // SPEAKING immediately; the face's real STARTED/ENDED messages keep it accurate. A long
  // duration-based fallback only fires if the face window isn't open to report back.
  const speakToFace = useCallback(async (audioUrl, visemes, expression) => {
    if (!audioUrl) return;
    let blob = null, durationMs = 0;
    try {
      const res = await fetch(`${API}${audioUrl}`);
      blob = await res.blob();
      // measure true audio length so the fallback can't cut off early
      durationMs = await new Promise((resolve) => {
        const a = new Audio(URL.createObjectURL(blob));
        a.addEventListener('loadedmetadata', () => resolve((a.duration || 0) * 1000));
        a.addEventListener('error', () => resolve(0));
        setTimeout(() => resolve(0), 2000);
      });
    } catch (e) { console.warn('audio fetch failed', e); }

    faceChRef.current?.postMessage({ type: FACE_MSG.SPEAK, audioBlob: blob, visemes: visemes || [], expression: expression || 'neutral' });

    setMode(MODES.SPEAKING);
    vlRef.current?.pause();
    // Fallback end: true duration + 1.2s buffer (or a safe 12s if duration unknown). The face's
    // ENDED message normally ends it first; this only guards against a missing face window.
    const fallbackMs = durationMs > 0 ? durationMs + 1200 : 12000;
    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    speakingTimeoutRef.current = setTimeout(endSpeaking, fallbackMs);
  }, [endSpeaking]);

  const pushTurn = (role, text) => setTurns(prev => [...prev.slice(-5), { role, text }]);

  // Show a rich card below the transcript. Plain text/idle replies don't need a card (the big
  // transcript already shows the words), so those just clear any previous card.
  const RICH_CARDS = ['media', 'faculty', 'faculty_list', 'location', 'programs', 'faq', 'appointment_sent', 'appointment_result'];
  const applyCard = (display) => {
    if (display && RICH_CARDS.includes(display.type)) setCard(display);
    else setCard(null);
  };

  // Make AURA speak a fixed line (used for the auto-greeting) without going through the LLM.
  const speakText = useCallback(async (text, expression = 'happy') => {
    pushTurn('aura', text);
    try {
      const ann = await jsonFetch('/api/chat/announce', {
        method: 'POST',
        body: JSON.stringify({ reply: text, expression, display_type: 'text', display_data: { title: 'AURA', body: text } }),
      });
      if (ann?.audio_url) await speakToFace(ann.audio_url, ann.visemes, ann.expression);
    } catch (e) { console.warn('greet failed', e); }
  }, [speakToFace]);

  // Ask the visitor to repeat — but at most once every ~12s. Without this guard, a noisy room makes
  // every captured noise blob transcribe to a hallucination → rephrase → that audio is captured →
  // rephrase again → an endless "Sorry, I didn't catch that" loop. The guard breaks the loop: after
  // one prompt AURA just keeps listening quietly. A successful answer resets it (see sendQuery).
  const REPHRASE_GUARD_MS = 12000;
  const maybeRephrase = useCallback(() => {
    const now = Date.now();
    if (now - lastRephraseAtRef.current < REPHRASE_GUARD_MS) return;
    lastRephraseAtRef.current = now;
    speakText(pickRephrase(), 'thinking');
  }, [speakText]);

  // CV presence → engagement. A NEW person engaging wipes all prior context (privacy + no bleed-over).
  const handleEngage = useCallback(() => {
    setEngaged(true);
    historyRef.current = [];   // blank slate for the new user
    setTurns([]);
    setCard(null);
    setMode(MODES.IDLE);
    cooldownUntilRef.current = 0;
    // Auto-greet with a self-introduction; the mic resumes when the greeting audio ends.
    speakText(GREETING, 'happy');
  }, [speakText]);

  // Person walked away (no face for the grace window) → wipe memory + sleep.
  const handleAbsent = useCallback(() => {
    setEngaged(false);
    historyRef.current = [];
    setTurns([]);
    setCard(null);
    setMode(MODES.IDLE);
    vlRef.current?.pause();
    faceChRef.current?.postMessage({ type: FACE_MSG.RESET });
  }, []);

  const { presence, status: presenceStatus, stream: camStream, debug: presenceDebug } = usePresence({
    enabled: micEnabled,
    deviceLabelHint: 'logitech',
    onEngage: handleEngage,
    onAbsent: handleAbsent,
    onError: (e) => setMicError('Camera/presence error: ' + (e?.message || e)),
  });

  // Clear any stale presence error once the camera+model are actually running.
  useEffect(() => { if (presenceStatus === 'running') setMicError(''); }, [presenceStatus]);

  const sendQuery = useCallback(async (text) => {
    const clean = text.trim().replace(/^[,.\s]+/, '');
    if (clean.length < 2) return;
    // Recovery: a 1-word, very short transcript is usually a misfire — ask the visitor to rephrase
    // instead of guessing at an answer. (Pure noise is already dropped server-side and never arrives.)
    const wordCount = clean.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2 && clean.length < 8) {
      maybeRephrase();
      return;
    }
    pushTurn('user', clean);
    setMode(MODES.PROCESSING);
    if (processingGuardRef.current) clearTimeout(processingGuardRef.current);
    processingGuardRef.current = setTimeout(() => setMode(MODES.IDLE), 20000);
    try {
      const recent = historyRef.current.slice(-10);
      const data = await jsonFetch('/api/chat/ask', {
        method: 'POST',
        body: JSON.stringify({ message: clean, history: recent }),
      });
      clearTimeout(processingGuardRef.current);
      historyRef.current.push({ role: 'user', content: clean });
      if (data?.reply) {
        historyRef.current.push({ role: 'assistant', content: data.reply });
        pushTurn('aura', data.reply);
        lastRephraseAtRef.current = 0;   // a real answer happened → allow a fresh rephrase next miss
      }
      applyCard(data?.display);
      // Hand the voice to the offline face; this also sets SPEAKING + pauses the mic.
      if (data?.audio_url) await speakToFace(data.audio_url, data.visemes, data.expression);
      else setMode(MODES.IDLE);
      if (data?.appointment_id) watchAppointment(data.appointment_id);
    } catch (e) {
      clearTimeout(processingGuardRef.current);
      console.error('ask failed:', e);
      setMicError('Backend unreachable — is the server running on :8000?');
      setMode(MODES.IDLE);
      setTimeout(() => setMicError(''), 5000);
    }
  }, [speakToFace, maybeRephrase]);

  const handleTranscript = useCallback((text) => {
    if (!text) return;
    if (!engagedRef.current) return;   // ignore all speech until a person is engaged (anti-passerby)
    if (modeRef.current === MODES.SPEAKING || modeRef.current === MODES.PROCESSING) return;
    if (Date.now() < cooldownUntilRef.current) return;
    let q = text.trim();
    const m = q.match(WAKE_PATTERN);
    if (m) q = q.slice(m[0].length).trim().replace(/^[,.\s]+/, '') || q;
    sendQuery(q);
  }, [sendQuery]);

  const transcribeBlob = useCallback(async (blob) => {
    try {
      const form = new FormData();
      form.append('audio', blob, 'utterance.wav');
      const r = await fetch(`${API}/api/chat/transcribe`, { method: 'POST', body: form });
      const d = await r.json();
      const text = (d.text || '').trim();
      if (text) {
        handleTranscript(text);
      } else if (d.dropped && engagedRef.current
                 && modeRef.current !== MODES.SPEAKING && modeRef.current !== MODES.PROCESSING
                 && Date.now() >= cooldownUntilRef.current) {
        // Heard speech but it wasn't understandable English → ask the visitor to repeat (guarded).
        maybeRephrase();
      }
      // else: pure silence → ignore quietly.
    } catch (e) { console.error('transcribe failed:', e); }
  }, [handleTranscript, maybeRephrase]);

  const watchAppointment = useCallback((appointmentId) => {
    if (apptWatchRef.current) clearInterval(apptWatchRef.current);
    const startedAt = Date.now();
    apptWatchRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 180000) { clearInterval(apptWatchRef.current); apptWatchRef.current = null; return; }
      try {
        const r = await fetch(`${API}/api/chat/appointment/${appointmentId}`);
        const d = await r.json();
        if (!d.found || d.appointment.status === 'pending') return;
        clearInterval(apptWatchRef.current); apptWatchRef.current = null;
        const a = d.appointment;
        const name = a.faculty_name || 'The instructor';
        const where = [a.faculty_campus, a.faculty_office].filter(Boolean).join(' — ');
        const reply = a.status === 'accepted'
          ? `Good news! ${name} accepted your meeting. Please head to ${where || 'their office'}.`
          : `I'm sorry, ${name} can't meet right now. Please try again later.`;
        const ann = await jsonFetch('/api/chat/announce', {
          method: 'POST',
          body: JSON.stringify({
            reply,
            expression: a.status === 'accepted' ? 'happy' : 'sad',
            display_type: 'appointment_result',
            display_data: { status: a.status, faculty_name: name, faculty_office: a.faculty_office || '', faculty_campus: a.faculty_campus || '', topic: a.topic || '' },
          }),
        });
        pushTurn('aura', reply);
        applyCard(ann?.display || { type: 'appointment_result', data: { status: a.status, faculty_name: name, faculty_office: a.faculty_office || '', faculty_campus: a.faculty_campus || '', topic: a.topic || '' } });
        if (ann?.audio_url) await speakToFace(ann.audio_url, ann.visemes, ann.expression);
      } catch (e) { /* keep polling */ }
    }, 3000);
  }, [speakToFace]);

  const enableMic = useCallback(async () => {
    setMicError('');
    // Camera requires a secure context (https or localhost). On a plain LAN IP it silently fails.
    if (!window.isSecureContext) {
      setMicError('Camera needs a secure page. Open this on http://localhost:5173 (not the LAN IP), or enable HTTPS.');
    }
    try {
      // NOTE: we do NOT probe the camera here. Opening it then releasing it and letting usePresence
      // reopen it causes Windows "Timeout starting video source". usePresence opens the camera once
      // and keeps it; the permission prompt appears there.
      const vl = new VoiceListener({
        onUtterance: (blob) => transcribeBlob(blob),
        // Only push spectrum updates while a student is engaged — otherwise this fires ~50x/sec
        // and re-renders the whole page even when dormant (which thrashed the camera effect).
        onSpectrum: (s) => { if (engagedRef.current) setSpectrum(s); },
        onSpeechStart: () => setCapturing(true),
        onSpeechEnd: () => setCapturing(false),
      });
      await vl.start();
      vl.pause();   // stay quiet until the CV layer reports someone is engaged
      vlRef.current = vl;
      setMicEnabled(true);
      // Kiosk polish: go fullscreen on this user gesture (browsers require a gesture).
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch (e) {
      console.error('mic error:', e);
      if (e.name === 'NotAllowedError') setMicError('Microphone permission denied. Allow it in the address bar and retry.');
      else if (e.name === 'NotFoundError') setMicError('No microphone found. Plug one in and retry.');
      else setMicError('Could not start the microphone. ' + (e.message || ''));
    }
  }, [transcribeBlob]);

  useEffect(() => () => { vlRef.current?.stop(); }, []);

  const submitTyped = (e) => {
    e.preventDefault();
    if (!typed.trim()) return;
    sendQuery(typed);
    setTyped('');
  };

  // ---- Mic enable overlay -----------------------------------------------
  if (!micEnabled) {
    return (
      <div className="min-h-screen vignette text-zinc-100 flex flex-col items-center justify-center p-8">
        <Logo name="aura" className="h-40 w-auto mb-8 animate-float" />
        <button
          onClick={enableMic}
          className="group relative px-12 py-5 rounded-full bg-aura-cyan/10 border-2 border-aura-cyan/50 hover:bg-aura-cyan/20 hover:border-aura-cyan/80 transition-all flex items-center gap-3 shadow-[0_0_60px_rgba(124,231,255,0.3)]"
        >
          <Mic className="w-7 h-7 text-aura-cyan" />
          <span className="text-aura-cyan text-lg font-semibold tracking-[0.2em]">TAP TO START</span>
        </button>
        <p className="text-zinc-400 text-base mt-8 leading-relaxed max-w-lg text-center">
          Enables the <span className="text-aura-cyan font-semibold">microphone and camera</span>.
          AURA wakes automatically when someone steps up and looks at the screen.
        </p>
        {micError && (
          <div className="mt-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm max-w-lg text-center">{micError}</div>
        )}
        <BrandFooter className="mt-14" size="md" />
      </div>
    );
  }

  // ---- State label + waveform mode --------------------------------------
  const waveMode = mode === MODES.SPEAKING ? 'speaking'
    : mode === MODES.PROCESSING ? 'thinking'
    : 'listening';
  const waveColor = mode === MODES.SPEAKING ? '#7CE7FF'
    : mode === MODES.PROCESSING ? '#FCD34D'
    : '#34D399';
  // Status pill: dot color + text. AURA speaking is an explicit GREEN "AURA is speaking".
  const status = mode === MODES.SPEAKING
      ? { text: 'AURA is speaking', dot: 'bg-emerald-400', ring: 'border-emerald-500/40 bg-emerald-500/10', textCls: 'text-emerald-300' }
    : mode === MODES.PROCESSING
      ? { text: 'Thinking…', dot: 'bg-amber-400', ring: 'border-amber-500/40 bg-amber-500/10', textCls: 'text-amber-300' }
    : capturing
      ? { text: 'Listening to you…', dot: 'bg-sky-400', ring: 'border-sky-500/40 bg-sky-500/10', textCls: 'text-sky-300' }
      : { text: 'Speak now', dot: 'bg-emerald-400', ring: 'border-emerald-500/30 bg-emerald-500/5', textCls: 'text-emerald-300' };

  const lastUser = [...turns].reverse().find(t => t.role === 'user');
  const lastAura = [...turns].reverse().find(t => t.role === 'aura');

  const showDebug = new URLSearchParams(window.location.search).has('debug');

  // ---- DORMANT screen: nobody engaged. Shows a self-view + standing guide. -
  if (!engaged) {
    // Live coaching based on what the camera currently sees.
    const d = presenceDebug;
    let guide, guideColor;
    if (presenceStatus !== 'running') {
      guide = presenceStatus === 'camera' ? 'Starting camera…'
        : presenceStatus === 'model' ? 'Getting ready…'
        : presenceStatus === 'error' ? 'Camera unavailable — please tell the front desk.'
        : 'Initializing…';
      guideColor = 'text-amber-300';
    } else if (!d.face) {
      guide = 'Step in front of the screen';
      guideColor = 'text-zinc-300';
    } else if (d.width < 0.20) {
      guide = 'Come a little closer';
      guideColor = 'text-amber-300';
    } else if (Math.abs(d.yaw) > 22 || Math.abs(d.pitch) > 20) {
      guide = 'Look at the screen';
      guideColor = 'text-amber-300';
    } else {
      guide = 'Perfect — hold still';
      guideColor = 'text-emerald-300';
    }
    const aligned = presenceStatus === 'running' && d.face && d.width >= 0.20 && Math.abs(d.yaw) <= 22 && Math.abs(d.pitch) <= 20;

    return (
      <div className="min-h-screen w-full vignette text-zinc-100 flex flex-col items-center justify-between py-10 px-8 relative">
        {/* Top: hero logo + welcome */}
        <div className="flex flex-col items-center">
          <Logo name="aura" className="h-28 w-auto mb-5 animate-float" />
          <h1 className="text-6xl lg:text-7xl font-display font-bold text-white mb-3 text-glow text-center leading-tight">
            Welcome to the Faculty of<br />Engineering &amp; Computer Science
          </h1>
          <p className="text-zinc-400 text-2xl lg:text-3xl text-center">Stand inside the circle and look at the screen — AURA will greet you.</p>
        </div>

        {/* Middle: self-view with a standing guide ring (bigger) */}
        <div className="relative" style={{ width: 460, height: 460 }}>
          <div className={`absolute inset-0 rounded-full overflow-hidden border-4 transition-colors duration-300 ${aligned ? 'border-emerald-400 shadow-[0_0_80px_rgba(52,211,153,0.6)]' : 'border-aura-cyan/40'}`}>
            <CamPreview stream={camStream} />
          </div>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 460 460">
            <ellipse cx="230" cy="210" rx="104" ry="130"
              fill="none" stroke={aligned ? '#34D399' : 'rgba(124,231,255,0.5)'} strokeWidth="3" strokeDasharray="9 9" />
          </svg>
          {d.engaging > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none -rotate-90" viewBox="0 0 460 460">
              <circle cx="230" cy="230" r="226" fill="none" stroke="#34D399" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 226}
                strokeDashoffset={2 * Math.PI * 226 * (1 - Math.min(1, d.engaging / 2500))} />
            </svg>
          )}
        </div>

        {/* Bottom: guide + hint + brand footer, stacked so they never overlap */}
        <div className="flex flex-col items-center gap-3">
          <p className={`text-4xl font-display font-semibold ${guideColor}`}>{guide}</p>
          <div className="h-7">
            <AnimatePresence mode="wait">
              <motion.p key={hintIdx}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="text-zinc-500 text-xl">
                {ATTRACT_HINTS[hintIdx]}
              </motion.p>
            </AnimatePresence>
          </div>
          {micError && presenceStatus === 'error' && (
            <div className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-base max-w-xl text-center">{micError}</div>
          )}
          <BrandFooter className="mt-2" size="lg" />
        </div>

        {showDebug && (
          <div className="absolute bottom-2 left-4 text-xs font-mono text-zinc-500 bg-black/40 rounded-lg px-3 py-2">
            status:{presenceStatus} · face:{String(d.face)} w:{d.width} yaw:{d.yaw} pitch:{d.pitch} eng:{d.engaging}ms · presence:{presence}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full vignette text-zinc-100 flex flex-col">
      {/* header: AURA mark + clock */}
      <div className="px-12 py-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Logo name="aura" className="h-14 w-auto" />
          <span className="text-zinc-500 text-lg font-display tracking-widest uppercase hidden md:inline">Engineering &amp; Computer Science</span>
        </div>
        <span className="font-mono text-xl text-zinc-500">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* BIG transcript + card — scroll-contained so it NEVER pushes the waveform off-screen */}
      <div className="flex-1 min-h-0 flex flex-col justify-center px-20 overflow-hidden">
        <div className="max-w-7xl mx-auto w-full flex flex-col min-h-0">
          {/* what the student said */}
          <AnimatePresence mode="wait">
            {lastUser && (
              <motion.p
                key={'u' + lastUser.text}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-4xl md:text-5xl text-zinc-500 font-light text-right mb-8 shrink-0"
              >
                {lastUser.text}
              </motion.p>
            )}
          </AnimatePresence>

          {/* AURA's answer. A card needs the room, so the reply shrinks when one is shown. */}
          <AnimatePresence mode="wait">
            <motion.p
              key={'a' + (lastAura?.text || mode)}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`font-display font-semibold text-white leading-tight text-glow shrink-0 ${
                card?.type === 'media' ? 'text-3xl md:text-4xl mb-3'
                : card ? 'text-4xl md:text-5xl mb-2'
                : 'text-6xl md:text-7xl'}`}
            >
              {lastAura ? lastAura.text : (mode === MODES.PROCESSING ? '…' : 'How can I help you?')}
            </motion.p>
          </AnimatePresence>

          {/* Rich card — fills the remaining space and scrolls inside its box if too tall, so the
              waveform/status below ALWAYS stay on screen. */}
          <AnimatePresence mode="wait">
            {card && (
              <motion.div
                key={'card' + card.type + JSON.stringify(card.data?.items || card.data?.name || card.data?.title || '').slice(0, 24)}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-3 mx-auto w-full flex justify-center min-h-0 overflow-y-auto"
              >
                <SmartCard type={card.type} data={card.data} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Waveform + state label — always pinned at the bottom, never covered by a card */}
      <div className="px-12 pb-8 shrink-0">
        <div className="max-w-4xl mx-auto">
          <div className="h-24 md:h-28">
            <Waveform mode={waveMode} spectrum={spectrum} color={waveColor} />
          </div>
          <div className="flex justify-center mt-3">
            <div className={`flex items-center gap-3 px-7 py-3 rounded-full border ${status.ring}`}>
              <span className={`relative flex h-3.5 w-3.5`}>
                <span className={`absolute inline-flex h-full w-full rounded-full ${status.dot} opacity-60 animate-ping`} />
                <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${status.dot}`} />
              </span>
              <span className={`text-2xl font-display font-semibold tracking-wide ${status.textCls}`}>{status.text}</span>
            </div>
          </div>
        </div>
      </div>

      {micError && (
        <div className="mx-auto mb-4 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{micError}</div>
      )}

      {/* keyboard fallback (corner) */}
      {showType ? (
        <form onSubmit={submitTyped} className="px-8 py-4 border-t border-white/5 bg-aura-ink/40 flex items-center gap-3">
          <input
            value={typed} onChange={e => setTyped(e.target.value)} autoFocus
            placeholder="Type your question (fallback)…"
            className="flex-1 bg-zinc-900 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
          />
          <button type="submit" disabled={!typed.trim() || mode === MODES.PROCESSING}
            className="bg-aura-cyan text-aura-ink font-semibold rounded-xl px-5 py-3 hover:bg-aura-cyan/90 transition-colors disabled:opacity-40 flex items-center gap-2">
            <Send className="w-4 h-4" /> Send
          </button>
          <button type="button" onClick={() => { setShowType(false); setTyped(''); }} className="text-zinc-500 hover:text-zinc-300 text-sm px-3 py-3">Cancel</button>
        </form>
      ) : (
        <div className="px-8 py-2 flex justify-end">
          <button onClick={() => setShowType(true)} title="Keyboard (fallback)"
            className="flex items-center gap-1.5 text-zinc-700 hover:text-zinc-400 transition-colors text-xs">
            <Keyboard className="w-3.5 h-3.5" /> Keyboard
          </button>
        </div>
      )}
    </div>
  );
}

// Self-view: attaches the SHARED presence stream to a mirrored <video>. No second camera open.
function CamPreview({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (v && stream) { v.srcObject = stream; v.play?.().catch(() => {}); }
  }, [stream]);
  if (!stream) {
    return <div className="w-full h-full flex items-center justify-center bg-black/40 text-zinc-600 text-sm">camera…</div>;
  }
  return <video ref={ref} muted playsInline className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />;
}
