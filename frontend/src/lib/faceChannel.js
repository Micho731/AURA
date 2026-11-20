/**
 * In-browser link between the Display window (brain client) and the offline Face window.
 *
 * Uses the browser's BroadcastChannel — a same-origin, in-memory message bus. No network, no
 * server, no polling. The display fetches AURA's audio once, then sends it here as a Blob along
 * with the lip-sync visemes + expression; the face plays it. Both windows must be open in the
 * same browser on the kiosk (one per monitor).
 */
export const FACE_CHANNEL = 'aura-face';

export function openFaceChannel() {
  return new BroadcastChannel(FACE_CHANNEL);
}

// Message types
export const FACE_MSG = {
  SPEAK: 'speak',     // display → face: { audioBlob, visemes, expression }
  STATE: 'state',     // display → face: { expression }  (set a mood without speaking)
  RESET: 'reset',     // display → face: clear/return to idle
  STARTED: 'started', // face → display: audio actually began playing
  ENDED: 'ended',     // face → display: audio actually finished playing
};
