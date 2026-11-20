import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Trash2, Loader2, RefreshCw, Plus } from 'lucide-react';
import { jsonFetch } from '../api';

/**
 * OfficesManager — Admin tool for the office directory (financial aid, registrar, IT, bursar…).
 * Saved entries are re-ingested so AURA can route students: "who do I ask about tuition?" →
 * names the office + location + hours.
 */
export default function OfficesManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', purpose: '', location: '', hours: '', phone: '', email: '', campus: '' });

  const load = async () => {
    setLoading(true);
    try { const d = await jsonFetch('/api/admin/offices'); setItems(d.offices || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!f.name.trim()) { setError('Office name is required.'); return; }
    setBusy(true);
    try {
      await jsonFetch('/api/admin/offices', { method: 'POST', body: JSON.stringify(f) });
      setF({ name: '', purpose: '', location: '', hours: '', phone: '', email: '', campus: '' });
      load();
    } catch (e) { setError(e.message || 'Failed to add'); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm('Remove this office?')) return;
    try { await jsonFetch(`/api/admin/offices/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { console.error(e); }
  };

  const inp = "bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan";

  return (
    <div>
      <form onSubmit={submit} className="space-y-3 mb-6">
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Office name (e.g. Financial Aid Office)" className={`w-full ${inp}`} />
        <input value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} placeholder="Handles (e.g. scholarships, tuition payment, installments)" className={`w-full ${inp}`} />
        <div className="grid grid-cols-2 gap-3">
          <input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} placeholder="Location (Block A, Room 110)" className={inp} />
          <input value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} placeholder="Hours (Mon–Fri 9–4)" className={inp} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="Phone (opt.)" className={inp} />
          <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="Email (opt.)" className={inp} />
          <input value={f.campus} onChange={e => setF({ ...f, campus: e.target.value })} placeholder="Campus (blank=all)" className={inp} />
        </div>
        {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy}
          className="bg-aura-cyan text-aura-ink font-semibold rounded-xl px-4 py-2.5 hover:bg-aura-cyan/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Plus className="w-4 h-4" /> Add office</>}
        </button>
      </form>

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-zinc-400 text-sm font-semibold">Offices ({items.length})</h3>
        <button onClick={load} className="text-zinc-500 hover:text-aura-cyan"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {loading ? <p className="text-zinc-600 text-sm text-center py-6">Loading…</p>
        : items.length === 0 ? <p className="text-zinc-600 text-sm text-center py-6 border border-dashed border-white/10 rounded-xl">No offices yet.</p>
        : (
        <div className="space-y-2">
          <AnimatePresence>
            {items.map(o => (
              <motion.div key={o.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">{o.name}</p>
                  <p className="text-zinc-500 text-xs truncate">
                    {[o.purpose, o.location, o.hours, o.campus].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => remove(o.id)} className="p-2 rounded-lg text-zinc-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
