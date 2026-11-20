// Centralised API base (all local).
// - During Vite dev (port 5173) the page talks to the backend on :8000 of the same host.
// - When the built app is served BY the backend itself (single port 8000) it uses the same origin.
// Works on localhost and on the LAN IP with no config either way.
const _origin = `${window.location.protocol}//${window.location.host}`;
const _devApi = `${window.location.protocol}//${window.location.hostname}:8000`;
export const API = window.location.port === '5173' ? _devApi : _origin;

export async function jsonFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}
