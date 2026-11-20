import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Trash2, Loader2, RefreshCw, UploadCloud, FileText, StickyNote } from 'lucide-react';
import { API, jsonFetch } from '../api';

/**
 * KnowledgeManager — the heart of AURA's expandable knowledge. Upload ANY document (PDF, Word,
 * text) or image, or type a note; AURA extracts the text and learns it. Every source needs a
 * title + description + tags so AURA knows when to use it.
 */
export default function KnowledgeManager() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('file');     // 'file' | 'note'
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try { const d = await jsonFetch('/api/admin/knowledge'); setDocs(d.docs || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const reset = () => { setFile(null); setTitle(''); setDescription(''); setTags(''); setContent(''); if (fileRef.current) fileRef.current.value = ''; };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setOk('');
    if (!title.trim()) { setError('A title is required.'); return; }
    if (mode === 'file' && !file) { setError('Choose a file to upload.'); return; }
    if (mode === 'note' && !content.trim()) { setError('Write the note content.'); return; }
    setBusy(true);
    try {
      if (mode === 'file') {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', title.trim());
        fd.append('description', description.trim());
        fd.append('tags', tags.trim());
        const res = await fetch(`${API}/api/admin/knowledge`, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        setOk(`Learned "${data.entry.title}" (${data.entry.chars} characters).`);
      } else {
        const fd = new FormData();
        fd.append('title', title.trim());
        fd.append('description', description.trim());
        fd.append('tags', tags.trim());
        fd.append('content', content.trim());
        const res = await fetch(`${API}/api/admin/knowledge/note`, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        setOk(`Note "${data.entry.title}" added.`);
      }
      reset();
      load();
      setTimeout(() => setOk(''), 4000);
    } catch (e) {
      setError(e.message || 'Failed to add knowledge');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Remove this knowledge source? AURA will forget it.')) return;
    try { await jsonFetch(`/api/admin/knowledge/${id}`, { method: 'DELETE' }); load(); }
    catch (e) { console.error(e); }
  };

  const inp = "bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan";

  return (
    <div>
      <p className="text-zinc-400 text-sm mb-4">
        Upload a document (PDF, Word, text) or image, or type a note — AURA reads it and adds it to
        what it knows. Give each one a clear title, description, and tags so AURA surfaces it correctly.
      </p>

      {/* mode toggle */}
      <div className="flex gap-1 bg-white/3 border border-white/5 rounded-xl p-1 mb-4 w-fit">
        <button onClick={() => setMode('file')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 ${mode==='file' ? 'bg-aura-cyan text-aura-ink' : 'text-zinc-400'}`}>
          <FileText className="w-4 h-4" /> Upload file
        </button>
        <button onClick={() => setMode('note')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 ${mode==='note' ? 'bg-aura-cyan text-aura-ink' : 'text-zinc-400'}`}>
          <StickyNote className="w-4 h-4" /> Type a note
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3 mb-6">
        {mode === 'file' && (
          <label className="block">
            <div className="rounded-xl border border-dashed border-white/15 bg-white/3 hover:border-aura-cyan/40 transition-colors cursor-pointer p-4 flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg bg-white/5 flex items-center justify-center">
                <UploadCloud className="w-6 h-6 text-zinc-500" />
              </div>
              <div className="text-sm">
                <p className="text-zinc-300">{file ? file.name : 'Click to choose a file'}</p>
                <p className="text-zinc-600 text-xs mt-0.5">PDF, Word (.docx), text/markdown, or image</p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.csv,image/*" className="hidden"
              onChange={e => { setFile(e.target.files?.[0]); setError(''); }} />
          </label>
        )}

        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title — what is this? (e.g. 2026 Scholarship Policy)" className={`w-full ${inp}`} />
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description — when should AURA use this?" className={`w-full ${inp}`} />
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated): scholarship, financial aid, policy" className={`w-full ${inp}`} />

        {mode === 'note' && (
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
            placeholder="Type the information AURA should know…" className={`w-full ${inp} resize-y`} />
        )}

        {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        {ok && <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{ok}</p>}

        <button type="submit" disabled={busy}
          className="bg-aura-cyan text-aura-ink font-semibold rounded-xl px-4 py-2.5 hover:bg-aura-cyan/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading &amp; learning…</> : <><BookOpen className="w-4 h-4" /> Teach AURA</>}
        </button>
      </form>

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-zinc-400 text-sm font-semibold">Learned sources ({docs.length})</h3>
        <button onClick={load} className="text-zinc-500 hover:text-aura-cyan"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {loading ? <p className="text-zinc-600 text-sm text-center py-6">Loading…</p>
        : docs.length === 0 ? <p className="text-zinc-600 text-sm text-center py-6 border border-dashed border-white/10 rounded-xl">Nothing uploaded yet.</p>
        : (
        <div className="space-y-2">
          <AnimatePresence>
            {docs.map(d => (
              <motion.div key={d.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-aura-cyan/10 text-aura-cyan border border-aura-cyan/25">{d.source_kind}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">{d.title}</p>
                  <p className="text-zinc-500 text-xs truncate">
                    {[d.description, (d.tags||[]).join(', '), `${d.chars} chars`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => remove(d.id)} className="p-2 rounded-lg text-zinc-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
