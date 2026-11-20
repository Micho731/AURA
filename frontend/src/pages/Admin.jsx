import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Trash2, Building2, Copy, Eye, EyeOff, RefreshCw, ShieldCheck, MapPin, Users, ImagePlus, CalendarClock, BookOpen } from 'lucide-react';
import { jsonFetch } from '../api';
import Logo from '../components/Logo';
import BrandFooter from '../components/BrandFooter';
import Section from '../components/Section';
import MediaManager from '../components/MediaManager';
import InfoBoardManager from '../components/InfoBoardManager';
import OfficesManager from '../components/OfficesManager';
import KnowledgeManager from '../components/KnowledgeManager';

const DEPT_COLOR = {
  CCE: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  MTE: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  BME: 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400',
  EE:  'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
};

export default function Admin() {
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', dept: '', office: '', title: '' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [newRecord, setNewRecord] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [campus, setCampus] = useState('');
  const [campusOptions, setCampusOptions] = useState([]);
  const [campusSaved, setCampusSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await jsonFetch('/api/admin/faculty');
      setFaculty(data.faculty || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const s = await jsonFetch('/api/admin/settings');
      setCampus(s.home_campus || '');
      setCampusOptions(s.campuses || []);
    } catch (e) { console.error(e); }
  };

  const saveCampus = async (value) => {
    setCampus(value);
    try {
      await jsonFetch('/api/admin/settings/home-campus', { method: 'POST', body: JSON.stringify({ campus: value }) });
      setCampusSaved(true);
      setTimeout(() => setCampusSaved(false), 2500);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); loadSettings(); }, []);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.dept.trim() || !form.office.trim()) {
      setError('Name, department, and office are required.');
      return;
    }
    setAdding(true);
    try {
      const data = await jsonFetch('/api/admin/faculty', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setNewRecord(data.faculty);
      setForm({ name: '', dept: '', office: '', title: '' });
      load();
    } catch (e) {
      setError(e.message || 'Failed to add faculty');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Remove this instructor permanently?')) return;
    await jsonFetch(`/api/admin/faculty/${id}`, { method: 'DELETE' });
    load();
  };

  const copy = (text) => navigator.clipboard.writeText(text);

  return (
    <div className="min-h-screen vignette text-zinc-100 p-5">
      <div className="max-w-2xl mx-auto space-y-6">

        <header className="flex items-center gap-3 mb-2">
          <Logo name="aura" className="h-11 w-auto" />
          <div>
            <h1 className="text-xl font-display font-bold text-white">Admin · Staff Database</h1>
            <p className="text-zinc-500 text-xs">Faculty of Engineering &amp; Computer Science · {faculty.length} instructor{faculty.length === 1 ? '' : 's'} registered</p>
          </div>
        </header>

        {/* Kiosk settings: campus selector — set THIS kiosk's location before deploying */}
        <Section icon={MapPin} title="Kiosk Settings" subtitle="Set this kiosk's campus before deploying" defaultOpen>
          <p className="text-zinc-500 text-xs mb-3">AURA scopes instructors, offices and appointments to this campus and never asks visitors which campus they're at.</p>
          <div className="flex items-center gap-3">
            <select value={campus} onChange={e => saveCampus(e.target.value)}
              className="flex-1 bg-zinc-900 border border-white/15 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-aura-cyan">
              {campusOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {campusSaved && <span className="text-emerald-400 text-sm font-medium whitespace-nowrap">✓ Saved</span>}
          </div>
        </Section>

        {/* Knowledge hub — upload anything AURA should learn */}
        <Section icon={BookOpen} title="Knowledge" subtitle="Upload documents, images, or notes for AURA to learn" defaultOpen>
          <KnowledgeManager />
        </Section>

        {/* Instructors: add form + credentials + directory */}
        <Section icon={Users} title="Instructors" subtitle={`${faculty.length} registered`} defaultOpen>
        <div className="card rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-aura-cyan" /> Register new instructor
          </h2>
          <form onSubmit={add} className="space-y-3">
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Full name (e.g. Dr. Sarah Khalil)"
              className="w-full bg-zinc-900 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
            />
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="Title (optional, e.g. Department Chair)"
              className="w-full bg-zinc-900 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                value={form.dept}
                onChange={e => setForm({ ...form, dept: e.target.value.toUpperCase() })}
                placeholder="Dept"
                className="bg-zinc-900 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
              />
              <input
                value={form.office}
                onChange={e => setForm({ ...form, office: e.target.value })}
                placeholder="Office (Block A, Room 201)"
                className="col-span-2 bg-zinc-900 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={adding}
              className="w-full bg-aura-cyan text-aura-ink font-semibold rounded-xl py-3 text-sm hover:bg-aura-cyan/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {adding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {adding ? 'Registering…' : 'Register & generate credentials'}
            </button>
          </form>
        </div>

        {/* Just-created credentials */}
        <AnimatePresence>
          {newRecord && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-emerald-300 text-xs font-semibold tracking-wider">CREDENTIALS GENERATED</p>
                <button onClick={() => setNewRecord(null)} className="text-zinc-500 text-xs hover:text-zinc-300">DISMISS</button>
              </div>
              <p className="text-white font-display font-bold text-lg">{newRecord.name}</p>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="bg-aura-ink/60 border border-white/5 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Username</p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-emerald-300">@{newRecord.username}</span>
                    <button onClick={() => copy(newRecord.username)} className="text-zinc-500 hover:text-white">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="bg-aura-ink/60 border border-white/5 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Password</p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-emerald-300">{newRecord.password}</span>
                    <button onClick={() => copy(newRecord.password)} className="text-zinc-500 hover:text-white">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Instructor directory list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-zinc-400 text-sm font-semibold">Directory</h3>
            <button onClick={load} className="text-zinc-500 hover:text-aura-cyan">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <p className="text-zinc-600 text-sm text-center py-8">Loading…</p>
          ) : faculty.length === 0 ? (
            <div className="card rounded-2xl p-8 text-center text-zinc-500 text-sm border-dashed">
              No instructors yet. Use the form above.
            </div>
          ) : (
            faculty.map(f => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="card rounded-2xl p-4 flex items-center gap-4"
              >
                <div className="w-11 h-11 rounded-xl bg-aura-cyan/10 border border-aura-cyan/25 flex items-center justify-center flex-shrink-0">
                  <span className="text-aura-cyan font-display font-bold text-sm">{f.name.split(' ').slice(-1)[0][0]}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white font-semibold truncate">{f.name}</p>
                  {f.title && <p className="text-zinc-500 text-xs truncate">{f.title}</p>}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${DEPT_COLOR[f.dept] || 'bg-zinc-800 border-white/5 text-zinc-400'}`}>
                      {f.dept}
                    </span>
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                      <Building2 className="w-3 h-3" />{f.office}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 font-mono text-[10px] text-zinc-500">
                    <span>@{f.username}</span>
                    {f.password && (
                      <>
                        <span>·</span>
                        <span>{revealed[f.id] ? f.password : '••••••••'}</span>
                        <button onClick={() => setRevealed(p => ({ ...p, [f.id]: !p[f.id] }))} className="text-zinc-600 hover:text-zinc-300">
                          {revealed[f.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => remove(f.id)}
                  className="p-2 rounded-xl border border-white/8 bg-white/3 text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))
          )}
        </div>
        </Section>

        {/* Images & flowcharts */}
        <Section icon={ImagePlus} title="Images & Flowcharts" subtitle="Pictures AURA can show on screen">
          <MediaManager />
        </Section>

        {/* Live info board */}
        <Section icon={CalendarClock} title="Info Board" subtitle="Events, deadlines, opening hours">
          <InfoBoardManager />
        </Section>

        {/* Office directory / routing */}
        <Section icon={Building2} title="Offices" subtitle="Who/where for student services">
          <OfficesManager />
        </Section>

        <BrandFooter className="pt-6 pb-2" size="sm" />
      </div>
    </div>
  );
}
