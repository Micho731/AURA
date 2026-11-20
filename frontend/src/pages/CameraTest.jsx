import React, { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * /cameratest — a self-contained diagnostics + calibration page for the presence camera.
 *
 * Shows the live video, lists all cameras (pick the Logitech), overlays the detected face box,
 * and prints live metrics (face width, yaw, pitch) with PASS/FAIL against the engage thresholds.
 * Use it to find where to stand and to choose threshold values, then copy those into usePresence.js.
 */

// Mirror the defaults in usePresence.js so the test reflects the real engage rule.
const MIN_FACE_WIDTH = 0.20;
const MAX_YAW = 22;
const MAX_PITCH = 20;

function estimatePose(lm) {
  const nose = lm[1], rEye = lm[33], lEye = lm[263], top = lm[10], chin = lm[152];
  if (!nose || !rEye || !lEye || !top || !chin) return { yaw: 99, pitch: 99 };
  const eyeMidX = (rEye.x + lEye.x) / 2;
  const eyeDist = Math.abs(lEye.x - rEye.x) || 1e-3;
  const yaw = ((nose.x - eyeMidX) / eyeDist) * 90;
  const faceH = Math.abs(chin.y - top.y) || 1e-3;
  const pitch = ((nose.y - top.y) / faceH - 0.48) * 180;
  return { yaw, pitch };
}
function bbox(lm) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

export default function CameraTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const lmkRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const [cams, setCams] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [log, setLog] = useState('starting…');
  const [saved, setSaved] = useState(false);
  const [m, setM] = useState({ face: false, w: 0, yaw: 0, pitch: 0, fps: 0 });

  // Load model once
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setLog('loading vision model…');
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        let lmk;
        try {
          lmk = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO', numFaces: 1,
          });
        } catch (e) {
          lmk = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'CPU' },
            runningMode: 'VIDEO', numFaces: 1,
          });
        }
        if (dead) { lmk.close?.(); return; }
        lmkRef.current = lmk;
        setLog('model ready — pick a camera');
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        setCams(devs);
        const logi = devs.find(d => d.label.toLowerCase().includes('logitech'));
        setDeviceId((logi || devs[0])?.deviceId || '');
      } catch (e) {
        setLog('model load FAILED: ' + (e?.message || e));
      }
    })();
    return () => { dead = true; lmkRef.current?.close?.(); };
  }, []);

  // (Re)open the selected camera
  useEffect(() => {
    if (!deviceId) return;
    let dead = false;
    (async () => {
      try {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        setLog('opening camera…');
        const getWithTimeout = (c, ms) => Promise.race([
          navigator.mediaDevices.getUserMedia({ video: c }),
          new Promise((_, r) => setTimeout(() => r(new Error('timed out')), ms)),
        ]);
        let stream;
        try { stream = await getWithTimeout({ deviceId: { exact: deviceId }, width: { ideal: 640 } }, 5000); }
        catch (e) { setLog('exact device failed (' + (e.message||e) + '), trying any…'); stream = await getWithTimeout(true, 5000); }
        if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
        setLog('camera live: ' + (stream.getVideoTracks()[0]?.label || 'unknown'));
        loop();
      } catch (e) {
        setLog('camera FAILED: ' + (e?.name || '') + ' ' + (e?.message || e));
      }
    })();
    return () => { dead = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const loop = () => {
    let last = performance.now(), frames = 0, fps = 0;
    const tick = () => {
      const v = videoRef.current, lmk = lmkRef.current, c = canvasRef.current;
      if (v && lmk && c && v.readyState >= 2) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        let res; try { res = lmk.detectForVideo(v, performance.now()); } catch {}
        const has = res && res.faceLandmarks && res.faceLandmarks.length > 0;
        if (has) {
          const lm = res.faceLandmarks[0];
          const b = bbox(lm);
          const { yaw, pitch } = estimatePose(lm);
          const pass = b.w >= MIN_FACE_WIDTH && Math.abs(yaw) <= MAX_YAW && Math.abs(pitch) <= MAX_PITCH;
          ctx.strokeStyle = pass ? '#34D399' : '#FCD34D';
          ctx.lineWidth = 4;
          ctx.strokeRect(b.minX * c.width, b.minY * c.height, b.w * c.width, b.h * c.height);
          setM({ face: true, w: +b.w.toFixed(3), yaw: Math.round(yaw), pitch: Math.round(pitch), fps });
        } else {
          setM(prev => ({ ...prev, face: false, fps }));
        }
        frames++;
        const now = performance.now();
        if (now - last >= 1000) { fps = frames; frames = 0; last = now; }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const wPass = m.w >= MIN_FACE_WIDTH;
  const yawPass = Math.abs(m.yaw) <= MAX_YAW;
  const pitchPass = Math.abs(m.pitch) <= MAX_PITCH;
  const allPass = m.face && wPass && yawPass && pitchPass;

  const Row = ({ label, value, pass, hint }) => (
    <div className="flex items-center justify-between py-2 border-b border-white/5">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-lg">{value}{' '}
        <span className={pass ? 'text-emerald-400' : 'text-amber-400'}>{pass ? '✓' : '✗'}</span>
        {hint && <span className="text-zinc-600 text-xs ml-2">{hint}</span>}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-aura-ink text-zinc-100 p-6">
      <h1 className="text-2xl font-display font-bold mb-1">Camera / Presence Test</h1>
      <p className="text-zinc-500 text-sm mb-4">{log}</p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* live video + overlay */}
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black" style={{ width: 640, maxWidth: '100%' }}>
          <video ref={videoRef} muted playsInline className="w-full block" />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          <div className={`absolute top-3 left-3 px-3 py-1 rounded-full text-sm font-semibold ${allPass ? 'bg-emerald-500/80' : 'bg-amber-500/80'} text-black`}>
            {allPass ? 'WOULD ENGAGE ✓' : m.face ? 'face seen — not engaged' : 'no face'}
          </div>
        </div>

        {/* controls + metrics */}
        <div className="flex-1 max-w-md">
          <label className="block text-sm text-zinc-400 mb-1">Camera</label>
          <select value={deviceId} onChange={e => { setDeviceId(e.target.value); }}
            className="w-full bg-zinc-900 border border-white/15 rounded-xl px-3 py-2 text-sm mb-3">
            {cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${c.deviceId.slice(0,6)}`}</option>)}
          </select>
          <button
            onClick={() => { localStorage.setItem('aura_camera_id', deviceId); setSaved(true); setTimeout(() => setSaved(false), 2500); }}
            disabled={!deviceId}
            className="w-full mb-5 bg-aura-cyan text-aura-ink font-semibold rounded-xl px-4 py-2.5 hover:bg-aura-cyan/90 transition-colors disabled:opacity-40">
            {saved ? '✓ Saved — AURA will use this camera' : 'Use this camera for AURA'}
          </button>

          <Row label="Face detected" value={String(m.face)} pass={m.face} />
          <Row label="Face width" value={m.w} pass={wPass} hint={`need ≥ ${MIN_FACE_WIDTH} (closer = bigger)`} />
          <Row label="Yaw (L/R)" value={`${m.yaw}°`} pass={yawPass} hint={`need ≤ ${MAX_YAW}°`} />
          <Row label="Pitch (U/D)" value={`${m.pitch}°`} pass={pitchPass} hint={`need ≤ ${MAX_PITCH}°`} />
          <Row label="Detection FPS" value={m.fps} pass={m.fps > 0} />

          <div className="mt-6 text-sm text-zinc-400 leading-relaxed bg-white/5 rounded-xl p-4">
            <p className="font-semibold text-zinc-200 mb-2">How to calibrate</p>
            <p>1. Stand where a student normally would. Note the <span className="text-aura-cyan">Face width</span> value.</p>
            <p>2. If it's below {MIN_FACE_WIDTH} even up close, lower <code className="text-aura-cyan">MIN_FACE_WIDTH</code> in usePresence.js.</p>
            <p>3. Look straight at the screen; yaw/pitch should be near 0. If facing-straight reads high, adjust <code className="text-aura-cyan">YAW_OFFSET / PITCH_OFFSET</code> (camera mount offset).</p>
            <p>4. The box turns <span className="text-emerald-400">green</span> when all checks pass — that's when AURA would wake.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
