import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarClock, Trash2, Loader2, RefreshCw, Plus } from 'lucide-react';
import { jsonFetch } from '../api';

/**
 * InfoBoardManager — Admin tool for time-sensitive info AURA should know:
 * events, deadlines, opening hours, notices. Saved entries are re-ingested so AURA can answer
 * "when does registration close?" / "what's happening this week?".
 */
const KINDS = ['notice', 'event', 'deadline', 'hours'];

export default function InfoBoardManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ kind: 'event', title: '', detail: '', date: '', location: '', campus: '' });

  const load = async () => {
    setLoading(true);
    try { const d = await jsonFetch('/api/admin/info'); setItems(d.info || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!f.title.trim()) { setError('A title is required.'); return; }
    setBusy(true);
    try {
      await jsonFetch('/api/admin/info', { method: 'POST', body: JSON.stringify(f) });
      setF({ kind: 'event', title: '', detail: '', date: '', location: '', campus: '' });
      load();
    } catch (e) { setError(e.message || 'Failed to add'); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm('Remove this entry?')) return;
    try { await jsonFetch(`/api/admin/info/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { console.error(e); }
  };

  const inp = "bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan";

  return (
    <div>
      <form onSubmit={submit} className="space-y-3 mb-6">
        <div className="grid grid-cols-3 gap-3">
          <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} className={inp}>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className={inp} />
          <input value={f.campus} onChange={e => setF({ ...f, campus: e.target.value })} placeholder="Campus (blank = all)" className={inp} />
        </div>
        <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Title (e.g. Registration closes)" className={`w-full ${inp}`} />
        <input value={f.detail} onChange={e => setF({ ...f, detail: e.target.value })} placeholder="Detail (optional)" className={`w-full ${inp}`} />
        <input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} placeholder="Location (optional)" className={`w-full ${inp}`} />
        {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy}
          className="bg-aura-cyan text-aura-ink font-semibold rounded-xl px-4 py-2.5 hover:bg-aura-cyan/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Add entry</>}
        </button>
      </form>

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-zinc-400 text-sm font-semibold">Entries ({items.length})</h3>
        <button onClick={load} className="text-zinc-500 hover:text-aura-cyan"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {loading ? <p className="text-zinc-600 text-sm text-center py-6">Loading…</p>
        : items.length === 0 ? <p className="text-zinc-600 text-sm text-center py-6 border border-dashed border-white/10 rounded-xl">No entries yet.</p>
        : (
        <div className="space-y-2">
          <AnimatePresence>
            {items.map(it => (
              <motion.div key={it.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-aura-cyan/10 text-aura-cyan border border-aura-cyan/25">{it.kind}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">{it.title}</p>
                  <p className="text-zinc-500 text-xs truncate">
                    {[it.date, it.location, it.campus, it.detail].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => remove(it.id)} className="p-2 rounded-lg text-zinc-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
