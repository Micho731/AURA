import React, { useState, useEffect } from 'react';
import { Plus, X, Loader2, Save, CalendarOff, CalendarPlus } from 'lucide-react';
import { jsonFetch } from '../api';

/**
 * ScheduleEditor — the instructor sets weekly office hours, slot length, auto-accept, and one-off
 * date overrides (block time off / add extra slots). AURA books appointments only inside these.
 */
const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];
const EMPTY = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

export default function ScheduleEditor({ facultyId }) {
  const [hours, setHours] = useState(EMPTY);
  const [slot, setSlot] = useState(30);
  const [auto, setAuto] = useState(false);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await jsonFetch(`/api/faculty/schedule/${facultyId}`);
        setHours({ ...EMPTY, ...(d.office_hours || {}) });
        setSlot(d.slot_minutes || 30);
        setAuto(!!d.auto_accept);
        setOverrides(d.overrides || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [facultyId]);

  const flash = (what) => { setSaved(what); setTimeout(() => setSaved(''), 2000); };

  const addRange = (day) => setHours(h => ({ ...h, [day]: [...h[day], { start: '10:00', end: '12:00' }] }));
  const rmRange = (day, i) => setHours(h => ({ ...h, [day]: h[day].filter((_, j) => j !== i) }));
  const setRange = (day, i, field, val) =>
    setHours(h => ({ ...h, [day]: h[day].map((r, j) => j === i ? { ...r, [field]: val } : r) }));

  const saveHours = async () => {
    setSaving('hours');
    try {
      await jsonFetch('/api/faculty/schedule', { method: 'POST', body: JSON.stringify({ faculty_id: facultyId, office_hours: hours, slot_minutes: Number(slot) }) });
      flash('Office hours saved');
    } catch (e) { console.error(e); } finally { setSaving(''); }
  };
  const saveAuto = async (val) => {
    setAuto(val);
    try { await jsonFetch('/api/faculty/auto-accept', { method: 'POST', body: JSON.stringify({ faculty_id: facultyId, auto_accept: val }) }); } catch (e) { console.error(e); }
  };
  const saveOverrides = async (next) => {
    setOverrides(next);
    setSaving('ov');
    try { await jsonFetch('/api/faculty/overrides', { method: 'POST', body: JSON.stringify({ faculty_id: facultyId, overrides: next }) }); flash('Exceptions saved'); }
    catch (e) { console.error(e); } finally { setSaving(''); }
  };

  const addOverride = (type) => {
    const today = new Date().toISOString().slice(0, 10);
    const base = { date: today, type, reason: '' };
    if (type === 'extra') { base.start = '16:00'; base.end = '18:00'; }
    saveOverrides([...overrides, base]);
  };
  const setOv = (i, field, val) => setOverrides(o => o.map((r, j) => j === i ? { ...r, [field]: val } : r));
  const rmOv = (i) => saveOverrides(overrides.filter((_, j) => j !== i));

  if (loading) return <div className="card rounded-2xl p-8 text-center text-zinc-600 text-sm"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {saved && <p className="text-emerald-400 text-xs text-center bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-2">{saved}</p>}

      {/* Weekly hours */}
      <div className="card rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Weekly office hours</h2>
        <div className="space-y-3">
          {DAYS.map(([key, label]) => (
            <div key={key}>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 text-sm w-24">{label}</span>
                <button onClick={() => addRange(key)} className="text-aura-cyan/80 hover:text-aura-cyan text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>
              </div>
              {hours[key].length === 0 ? (
                <p className="text-zinc-600 text-xs mt-1">Closed</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {hours[key].map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" value={r.start} onChange={e => setRange(key, i, 'start', e.target.value)}
                        className="bg-zinc-900 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-aura-cyan" />
                      <span className="text-zinc-500">–</span>
                      <input type="time" value={r.end} onChange={e => setRange(key, i, 'end', e.target.value)}
                        className="bg-zinc-900 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-aura-cyan" />
                      <button onClick={() => rmRange(key, i)} className="text-zinc-600 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-white/5">
          <label className="text-zinc-400 text-sm">Slot length</label>
          <select value={slot} onChange={e => setSlot(e.target.value)} className="bg-zinc-900 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-white">
            {[15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          <button onClick={saveHours} disabled={saving === 'hours'}
            className="ml-auto bg-aura-cyan text-aura-ink font-semibold rounded-xl px-4 py-2 text-sm hover:bg-aura-cyan/90 disabled:opacity-50 flex items-center gap-1.5">
            {saving === 'hours' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save hours
          </button>
        </div>
      </div>

      {/* Auto-accept */}
      <div className="card rounded-2xl p-5 flex items-center justify-between">
        <div>
          <p className="text-zinc-200 text-sm font-medium">Auto-accept in-hours requests</p>
          <p className="text-zinc-500 text-xs mt-0.5">Requests that fall inside your office hours are confirmed instantly.</p>
        </div>
        <button onClick={() => saveAuto(!auto)} className={`w-12 h-7 rounded-full transition-colors relative ${auto ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${auto ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {/* Overrides */}
      <div className="card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-300">Exceptions</h2>
          <div className="flex gap-2">
            <button onClick={() => addOverride('block')} className="text-xs flex items-center gap-1 text-amber-300/80 hover:text-amber-300"><CalendarOff className="w-3.5 h-3.5" /> Time off</button>
            <button onClick={() => addOverride('extra')} className="text-xs flex items-center gap-1 text-emerald-300/80 hover:text-emerald-300"><CalendarPlus className="w-3.5 h-3.5" /> Extra slot</button>
          </div>
        </div>
        {overrides.length === 0 ? (
          <p className="text-zinc-600 text-xs">No exceptions. Add a day off or an extra one-time slot.</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((ov, i) => (
              <div key={i} className={`rounded-xl border p-3 ${ov.type === 'block' ? 'border-amber-500/20 bg-amber-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${ov.type === 'block' ? 'text-amber-300' : 'text-emerald-300'}`}>{ov.type === 'block' ? 'OFF' : 'EXTRA'}</span>
                  <input type="date" value={ov.date} onChange={e => setOv(i, 'date', e.target.value)} onBlur={() => saveOverrides(overrides)}
                    className="bg-zinc-900 border border-white/15 rounded-lg px-2 py-1 text-xs text-white" />
                  {ov.type === 'extra' && (
                    <>
                      <input type="time" value={ov.start || '16:00'} onChange={e => setOv(i, 'start', e.target.value)} onBlur={() => saveOverrides(overrides)} className="bg-zinc-900 border border-white/15 rounded-lg px-2 py-1 text-xs text-white" />
                      <span className="text-zinc-500 text-xs">–</span>
                      <input type="time" value={ov.end || '18:00'} onChange={e => setOv(i, 'end', e.target.value)} onBlur={() => saveOverrides(overrides)} className="bg-zinc-900 border border-white/15 rounded-lg px-2 py-1 text-xs text-white" />
                    </>
                  )}
                  <button onClick={() => rmOv(i)} className="ml-auto text-zinc-600 hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
                <input value={ov.reason || ''} onChange={e => setOv(i, 'reason', e.target.value)} onBlur={() => saveOverrides(overrides)} placeholder="Reason (optional)"
                  className="w-full mt-2 bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-zinc-600" />
              </div>
            ))}
          </div>
        )}
        <p className="text-zinc-600 text-xs mt-3">"Time off" with no time = whole day blocked. Exceptions save automatically.</p>
      </div>
    </div>
  );
}
