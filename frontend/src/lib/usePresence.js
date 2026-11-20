import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * usePresence — CV-driven engagement detector (anti-passerby).
 *
 * Uses MediaPipe Face Landmarker (fully offline: WASM + model served from /public) to decide when
 * a person is actually ENGAGED with the kiosk vs. just walking past. A person is "engaged" only
 * when, continuously for ENGAGE_MS, there is:
 *   - a face present,
 *   - large enough in frame (close to the device — rejects distant passers-by), and
 *   - facing the camera (head yaw/pitch near zero, with a mount offset).
 *
 * Two presence states drive the kiosk:
 *   DORMANT  → nobody engaged. Mic paused, AURA asleep.
 *   ENGAGED  → a person is in front and looking. Fires onEngage() once on the rising edge.
 * When no face is seen for ABSENCE_MS, it returns to DORMANT and fires onAbsent().
 *
 * Calibration constants live at the top — tune these on-site for the Logitech cam + its mount.
 */

// ---- Calibration (tune on-site) -------------------------------------------
const ENGAGE_MS = 2500;     // must stay engaged this long before waking (2–3s requested)
const ABSENCE_MS = 7000;    // no face for this long → wipe + sleep (7s requested)
const ENGAGE_TOLERANCE_MS = 500; // brief look-away/blink under this won't reset the engage timer

const MIN_FACE_WIDTH = 0.20;  // face bounding-box width as fraction of frame (proximity gate).
                              // Wide-FOV Logitech makes faces smaller → lower if it won't trigger,
                              // raise if distant passers-by trigger it.
const MAX_YAW = 22;           // degrees left/right off-center still counts as "facing it"
const MAX_PITCH = 20;         // degrees up/down still counts as "facing it"
const YAW_OFFSET = 0;         // + if cam is mounted to one side of the screen
const PITCH_OFFSET = 0;       // + if cam is mounted above/below the screen center

const DETECT_INTERVAL_MS = 120; // ~8 detections/sec — plenty for presence, easy on the Tab A CPU

/**
 * Estimate head yaw/pitch (degrees) from face landmarks. Lightweight geometric approximation:
 * yaw from nose-tip horizontal offset between the eyes; pitch from nose vertical position.
 */
function estimatePose(lm) {
  // MediaPipe FaceMesh indices: 1 = nose tip, 33 = right eye outer, 263 = left eye outer,
  // 10 = forehead top, 152 = chin bottom.
  const nose = lm[1], rEye = lm[33], lEye = lm[263], top = lm[10], chin = lm[152];
  if (!nose || !rEye || !lEye || !top || !chin) return { yaw: 99, pitch: 99 };

  const eyeMidX = (rEye.x + lEye.x) / 2;
  const eyeDist = Math.abs(lEye.x - rEye.x) || 1e-3;
  // horizontal nose offset from eye midpoint, normalized by eye distance → ~[-1,1] → degrees
  const yaw = ((nose.x - eyeMidX) / eyeDist) * 90;

  const faceH = Math.abs(chin.y - top.y) || 1e-3;
  const noseRel = (nose.y - top.y) / faceH; // ~0.45 when looking straight
  const pitch = (noseRel - 0.48) * 180;

  return { yaw: yaw - YAW_OFFSET, pitch: pitch - PITCH_OFFSET };
}

function faceWidth(lm) {
  let minX = 1, maxX = 0;
  for (const p of lm) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
  return maxX - minX;
}

export function usePresence({ enabled, deviceLabelHint = 'logitech', onEngage, onAbsent, onError }) {
  const [presence, setPresence] = useState('dormant'); // 'dormant' | 'engaged'
  const [status, setStatus] = useState('idle');        // 'idle'|'camera'|'model'|'running'|'error'
  const [stream, setStream] = useState(null);          // the live camera stream (for a self-view preview)
  const [debug, setDebug] = useState({ face: false, width: 0, yaw: 0, pitch: 0, engaging: 0 });

  const videoRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const intervalRef = useRef(null);

  const engagedSinceRef = useRef(0);     // when the current continuous engagement began
  const lastGoodRef = useRef(0);         // last time the engage criteria were met (tolerance)
  const lastFaceRef = useRef(0);         // last time ANY face was seen (absence)
  const presenceRef = useRef('dormant');
  const onEngageRef = useRef(onEngage);
  const onAbsentRef = useRef(onAbsent);
  const onErrorRef = useRef(onError);

  useEffect(() => { onEngageRef.current = onEngage; }, [onEngage]);
  useEffect(() => { onAbsentRef.current = onAbsent; }, [onAbsent]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { presenceRef.current = presence; }, [presence]);

  // Pick the camera: prefer the one saved from the test page, then a Logitech by label, else default.
  const pickCamera = useCallback(async () => {
    try {
      const saved = localStorage.getItem('aura_camera_id');
      if (saved) return { deviceId: { exact: saved } };
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      const hint = (deviceLabelHint || '').toLowerCase();
      const match = cams.find(c => c.label.toLowerCase().includes(hint));
      return match ? { deviceId: { exact: match.deviceId } } : true;
    } catch {
      return true;
    }
  }, [deviceLabelHint]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        // 1) Open the camera FIRST — so the webcam light comes on immediately and any camera
        //    problem surfaces right away (rather than being hidden behind a model-load failure).
        setStatus('camera');
        const videoConstraint = await pickCamera();
        const wanted = typeof videoConstraint === 'object'
          ? { ...videoConstraint, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } };

        // Opening a webcam on Windows can transiently fail with "Timeout starting video source" if
        // the device is still releasing from a previous open. Retry a few times with backoff, and
        // fall back to any camera if the preferred (Logitech) one keeps failing.
        const CANCELLED = Symbol('cancelled');
        // getUserMedia can HANG forever on Windows when the camera is contended (it neither resolves
        // nor rejects). Race each attempt against a timeout so a hang becomes a retryable failure.
        const getMediaWithTimeout = (constraint, ms) => Promise.race([
          navigator.mediaDevices.getUserMedia({ video: constraint }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('camera open timed out')), ms)),
        ]);
        const openCam = async (constraint, attempts) => {
          let lastErr;
          for (let i = 0; i < attempts; i++) {
            if (cancelled) throw CANCELLED;
            try { return await getMediaWithTimeout(constraint, 4000); }
            catch (err) {
              lastErr = err;
              console.warn(`[presence] camera open attempt ${i + 1} failed:`, err?.name || err?.message || err);
              await new Promise(r => setTimeout(r, 600));
            }
          }
          throw lastErr;
        };

        let stream;
        try {
          stream = await openCam(wanted, 4);
        } catch (camErr) {
          if (camErr === CANCELLED || cancelled) return; // teardown, not a real error
          console.warn('[presence] preferred camera failed, trying any camera', camErr);
          stream = await openCam(true, 3); // any camera, plain video:true
        }
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setStream(stream);  // expose for the self-view preview (same stream, no second camera open)

        const video = document.createElement('video');
        video.autoplay = true; video.muted = true; video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        videoRef.current = video;
        console.log('[presence] camera live:', stream.getVideoTracks()[0]?.label);

        // 2) Load the model + WASM from local /public (no network). Try GPU, fall back to CPU.
        setStatus('model');
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        let landmarker;
        try {
          landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO', numFaces: 1,
          });
        } catch (gpuErr) {
          console.warn('[presence] GPU delegate failed, falling back to CPU', gpuErr);
          landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'CPU' },
            runningMode: 'VIDEO', numFaces: 1,
          });
        }
        if (cancelled) { landmarker.close?.(); stream.getTracks().forEach(t => t.stop()); return; }
        landmarkerRef.current = landmarker;
        setStatus('running');

        // 3) Detection loop on an interval (lighter than every rAF frame).
        intervalRef.current = setInterval(() => {
          const lmk = landmarkerRef.current;
          const v = videoRef.current;
          if (!lmk || !v || v.readyState < 2) return;

          let res;
          try { res = lmk.detectForVideo(v, performance.now()); }
          catch { return; }

          const now = performance.now();
          const hasFace = res && res.faceLandmarks && res.faceLandmarks.length > 0;

          let engagedCriteria = false, w = 0, yaw = 0, pitch = 0;
          if (hasFace) {
            lastFaceRef.current = now;
            const lm = res.faceLandmarks[0];
            w = faceWidth(lm);
            const pose = estimatePose(lm);
            yaw = pose.yaw; pitch = pose.pitch;
            engagedCriteria = w >= MIN_FACE_WIDTH && Math.abs(yaw) <= MAX_YAW && Math.abs(pitch) <= MAX_PITCH;
          }

          // Engagement timer with tolerance for brief flickers.
          if (engagedCriteria) {
            if (!engagedSinceRef.current) engagedSinceRef.current = now;
            lastGoodRef.current = now;
          } else if (now - lastGoodRef.current > ENGAGE_TOLERANCE_MS) {
            engagedSinceRef.current = 0;
          }

          const engagingFor = engagedSinceRef.current ? now - engagedSinceRef.current : 0;
          setDebug({ face: hasFace, width: +w.toFixed(3), yaw: Math.round(yaw), pitch: Math.round(pitch), engaging: Math.round(engagingFor) });

          // Transitions
          if (presenceRef.current === 'dormant') {
            if (engagingFor >= ENGAGE_MS) {
              presenceRef.current = 'engaged';
              setPresence('engaged');
              onEngageRef.current?.();
            }
          } else { // engaged
            if (now - lastFaceRef.current > ABSENCE_MS) {
              presenceRef.current = 'dormant';
              setPresence('dormant');
              engagedSinceRef.current = 0;
              onAbsentRef.current?.();
            }
          }
        }, DETECT_INTERVAL_MS);
      } catch (e) {
        if (cancelled) return; // effect was torn down — not a real error
        console.error('[presence] init failed', e);
        setStatus('error');
        onErrorRef.current?.(e);
      }
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { landmarkerRef.current?.close?.(); } catch {}
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      landmarkerRef.current = null; streamRef.current = null; videoRef.current = null;
      setStream(null);
    };
    // Only (re)initialize when enabled flips. Callbacks are read via refs so re-renders don't
    // tear down and restart the camera (which previously thrashed getUserMedia ~50x/sec).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { presence, status, stream, debug };
}
