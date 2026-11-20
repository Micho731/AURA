import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ImagePlus, Trash2, Loader2, RefreshCw, UploadCloud } from 'lucide-react';
import { API, jsonFetch } from '../api';

/**
 * MediaManager — Admin tool to upload tagged images/flowcharts the kiosk can show on demand.
 * Upload writes the file to data/media/, records it in the manifest, and re-ingests the brain so
 * AURA can match it by caption/tags. Lives in the Admin page.
 */
export default function MediaManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try { const d = await jsonFetch('/api/admin/media'); setItems(d.media || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError('');
  };

  const upload = async (e) => {
    e.preventDefault();
    setError('');
    if (!file) { setError('Choose an image first.'); return; }
    if (!caption.trim()) { setError('A caption is required — it is how AURA matches the image.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('caption', caption.trim());
      fd.append('tags', tags.trim());
      fd.append('category', category.trim());
      const res = await fetch(`${API}/api/admin/media`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setFile(null); setPreview(''); setCaption(''); setTags(''); setCategory('');
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f) => {
    if (!confirm('Remove this image from the library?')) return;
    try { await jsonFetch(`/api/admin/media/${encodeURIComponent(f)}`, { method: 'DELETE' }); load(); }
    catch (e) { console.error(e); }
  };

  return (
    <div>
      {/* Upload form */}
      <form onSubmit={upload} className="space-y-3 mb-6">
        <label className="block">
          <div className="rounded-xl border border-dashed border-white/15 bg-white/3 hover:border-aura-cyan/40 transition-colors cursor-pointer p-4 flex items-center gap-3">
            {preview
              ? <img src={preview} alt="" className="w-20 h-20 object-cover rounded-lg" />
              : <div className="w-20 h-20 rounded-lg bg-white/5 flex items-center justify-center"><UploadCloud className="w-7 h-7 text-zinc-500" /></div>}
            <div className="text-sm">
              <p className="text-zinc-300">{file ? file.name : 'Click to choose an image / flowchart'}</p>
              <p className="text-zinc-600 text-xs mt-0.5">JPG, PNG, WEBP, GIF</p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => pick(e.target.files?.[0])} />
        </label>

        <input value={caption} onChange={e => setCaption(e.target.value)}
          placeholder="Caption — what it is (e.g. 'Mechatronics Engineering course flowchart / study plan')"
          className="w-full bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan" />
        <div className="grid grid-cols-2 gap-3">
          <input value={tags} onChange={e => setTags(e.target.value)}
            placeholder="Tags (comma-separated): mechatronics, flowchart, MTE"
            className="bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan" />
          <input value={category} onChange={e => setCategory(e.target.value)}
            placeholder="Category (optional): flowcharts"
            className="bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan" />
        </div>

        {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

        <button type="submit" disabled={busy}
          className="w-full bg-aura-cyan text-aura-ink font-semibold rounded-xl px-4 py-2.5 hover:bg-aura-cyan/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading & indexing…</> : <>Upload image</>}
        </button>
        <p className="text-zinc-600 text-xs">The caption and tags are how AURA decides when to show this image, so describe it the way a student would ask.</p>
      </form>

      {/* Library */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-zinc-400 text-sm font-semibold">Library ({items.length})</h3>
        <button onClick={load} className="text-zinc-500 hover:text-aura-cyan"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {loading ? (
        <p className="text-zinc-600 text-sm text-center py-6">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-6 border border-dashed border-white/10 rounded-xl">No images yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <AnimatePresence>
            {items.map(m => (
              <motion.div key={m.file} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="rounded-xl overflow-hidden border border-white/10 bg-black/30 group relative">
                <img src={`${API}${m.url}`} alt={m.caption} className="w-full h-28 object-cover" />
                <div className="p-2">
                  <p className="text-zinc-300 text-xs line-clamp-2">{m.caption}</p>
                  {m.tags?.length > 0 && <p className="text-zinc-600 text-[10px] mt-1 truncate">{m.tags.join(', ')}</p>}
                </div>
                <button onClick={() => remove(m.file)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-zinc-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
