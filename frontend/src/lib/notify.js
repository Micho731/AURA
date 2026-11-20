/**
 * Instructor notifications.
 *
 * Two layers:
 *  - In-app (always works, even on plain http/LAN): browser Notification + a beep, raised by the
 *    Faculty dashboard when its poll sees a NEW pending request.
 *  - Web Push (only on a secure context / HTTPS): registers the service worker and subscribes so the
 *    instructor is notified even with the app closed. Silently skipped otherwise.
 */
import { API } from '../api';

export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  }
  return Notification.permission;
}

// Short two-tone beep via WebAudio (no asset needed).
export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const tones = [880, 1175];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* ignore */ }
}

export function showLocalNotification(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/logos/aura-robot.png', tag: 'aura-appointment', renotify: true });
    }
  } catch { /* ignore */ }
  beep();
}

const urlBase64ToUint8Array = (b64) => {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

/**
 * Register the SW + Web Push subscription. No-op unless secure context + configured VAPID key.
 * Safe to call on every login; subscriptions are de-duplicated server-side by endpoint.
 */
export async function setupWebPush(facultyId) {
  try {
    if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, reason: 'unsupported' };

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const r = await fetch(`${API}/api/push/vapid-public-key`);
    const { key, configured } = await r.json();
    if (!configured || !key) return { ok: false, reason: 'not-configured' };

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await fetch(`${API}/api/push/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faculty_id: facultyId, subscription: sub.toJSON() }),
    });
    return { ok: true };
  } catch (e) {
    console.warn('web push setup skipped:', e);
    return { ok: false, reason: 'error' };
  }
}

// Also register the SW for installability even when push isn't available (http).
export async function registerServiceWorker() {
  try { if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js'); } catch { /* ignore */ }
}
