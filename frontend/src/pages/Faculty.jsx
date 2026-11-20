import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, User, LogIn, LogOut, MapPin, Check, X, Loader2, RefreshCw, Inbox, Clock, Bell } from 'lucide-react';
import { jsonFetch } from '../api';
import Logo from '../components/Logo';
import BrandFooter from '../components/BrandFooter';
import ScheduleEditor from '../components/ScheduleEditor';
import { ensureNotificationPermission, registerServiceWorker, setupWebPush, showLocalNotification } from '../lib/notify';

const STATUSES = [
  { key: 'Available', color: 'bg-emerald-500', text: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
  { key: 'In Class',  color: 'bg-amber-500',   text: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  { key: 'In Meeting',color: 'bg-blue-500',    text: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  { key: 'Busy',      color: 'bg-orange-500',  text: 'text-orange-400 bg-orange-500/15 border-orange-500/30' },
  { key: 'Away',      color: 'bg-zinc-500',    text: 'text-zinc-400 bg-zinc-500/15 border-zinc-500/30' },
];

// ---------- Login screen ---------------------------------------------------

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await jsonFetch('/api/faculty/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(data.faculty);
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 vignette">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card rounded-3xl p-8 w-full max-w-sm shadow-2xl"
      >
        <div className="text-center mb-7">
          <Logo name="aura" className="h-16 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-display font-bold text-white">Faculty Portal</h1>
          <p className="text-zinc-500 text-sm mt-1">Faculty of Engineering · sign in to manage appointments</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              className="w-full bg-zinc-900 border border-white/15 rounded-xl py-3 pl-10 pr-4 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full bg-zinc-900 border border-white/15 rounded-xl py-3 pl-10 pr-4 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-aura-cyan focus:bg-zinc-800 transition-colors"
            />
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-red-400 text-xs text-center bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-aura-cyan text-aura-ink font-semibold py-3 rounded-xl hover:bg-aura-cyan/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loading ? 'Authenticating…' : 'Sign in'}
          </button>
        </form>

        <BrandFooter className="mt-7" size="sm" />
      </motion.div>
    </div>
  );
}

// ---------- Logged-in dashboard -------------------------------------------

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso + 'Z').getTime();
  const min = Math.round(diff / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)   return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

function Dashboard({ faculty, onLogout }) {
  const [status, setStatus] = useState(faculty.status || 'Away');
  const [updating, setUpdating] = useState(false);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('inbox');
  const [banner, setBanner] = useState(null);
  const seenIdsRef = useRef(null);   // ids known on the previous poll (null until first load)

  const refresh = useCallback(async () => {
    try {
      const all = await jsonFetch(`/api/faculty/appointments/${faculty.id}`);
      const rows = all.appointments || [];
      const pend = rows.filter(r => r.status === 'pending');
      setPending(pend);
      setHistory(rows.filter(r => r.status !== 'pending'));

      // Detect genuinely NEW pending requests since the last poll → notify in-app.
      const ids = new Set(pend.map(p => p.id));
      if (seenIdsRef.current) {
        const fresh = pend.filter(p => !seenIdsRef.current.has(p.id));
        if (fresh.length) {
          const a = fresh[0];
          const when = a.slot_label ? ` · ${a.slot_label}` : '';
          showLocalNotification('New meeting request', `${a.student_name}${when}`);
          setBanner({ name: a.student_name, topic: a.topic, slot: a.slot_label, count: fresh.length });
          setTab('inbox');
        }
      }
      seenIdsRef.current = ids;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [faculty.id]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // One-time setup: ask for notification permission + register SW / web push (push only on HTTPS).
  useEffect(() => {
    ensureNotificationPermission();
    registerServiceWorker();
    setupWebPush(faculty.id);
  }, [faculty.id]);

  const changeStatus = async (newStatus) => {
    setUpdating(true);
    try {
      await jsonFetch('/api/faculty/status', {
        method: 'POST',
        body: JSON.stringify({ faculty_id: faculty.id, status: newStatus }),
      });
      setStatus(newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(false);
    }
  };

  const respond = async (appointmentId, accept) => {
    await jsonFetch('/api/faculty/appointments/respond', {
      method: 'POST',
      body: JSON.stringify({ appointment_id: appointmentId, accept }),
    });
    refresh();
  };

  return (
    <div className="min-h-screen vignette text-zinc-100">
      {/* Header */}
      <header className="px-5 py-4 flex items-center justify-between border-b border-white/5 bg-white/2">
        <div>
          <p className="text-xs text-zinc-500">Signed in as</p>
          <p className="text-white font-display font-semibold">{faculty.name}</p>
        </div>
        <button
          onClick={onLogout}
          className="p-2.5 rounded-xl border border-white/10 bg-white/3 text-zinc-400 hover:text-red-400 transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="max-w-md mx-auto p-5 space-y-5">

        {/* New-request banner */}
        <AnimatePresence>
          {banner && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-2xl border border-aura-cyan/40 bg-aura-cyan/10 p-4 flex items-start gap-3"
            >
              <Bell className="w-5 h-5 text-aura-cyan mt-0.5 animate-pulse" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">{banner.count > 1 ? `${banner.count} new requests` : 'New meeting request'}</p>
                <p className="text-zinc-300 text-xs mt-0.5 truncate">{banner.name}{banner.slot ? ` · ${banner.slot}` : ''}{banner.topic ? ` — "${banner.topic}"` : ''}</p>
              </div>
              <button onClick={() => setBanner(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Faculty info card */}
        <div className="card rounded-2xl p-5">
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="px-2 py-0.5 rounded bg-aura-cyan/10 border border-aura-cyan/25 text-aura-cyan font-semibold">{faculty.dept}</span>
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{faculty.office}</span>
          </div>
        </div>

        {/* Availability */}
        <div className="card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-300">My Availability</h2>
            {updating && <Loader2 className="w-4 h-4 text-aura-cyan animate-spin" />}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STATUSES.map(s => {
              const active = status === s.key;
              return (
                <button
                  key={s.key}
                  disabled={updating}
                  onClick={() => changeStatus(s.key)}
                  className={`p-3 rounded-xl border text-sm font-medium text-left flex items-center gap-2.5 transition-all ${
                    active ? s.text + ' scale-[1.02]' : 'border-white/8 bg-white/2 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${s.color}`} />
                  {s.key}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            AURA shows your current status when students ask about you.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/3 border border-white/5 rounded-2xl p-1">
          {[
            ['inbox', 'Inbox', pending.length],
            ['history', 'History', history.length],
            ['hours', 'Hours', null],
          ].map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                tab === key
                  ? 'bg-white/8 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}{count !== null && <span className="text-xs opacity-60"> · {count}</span>}
            </button>
          ))}
        </div>

        {/* Office hours editor */}
        {tab === 'hours' && <ScheduleEditor facultyId={faculty.id} />}

        {/* Inbox / History */}
        {tab !== 'hours' && (
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-10 text-zinc-600 text-sm">
              <Loader2 className="w-5 h-5 mx-auto animate-spin mb-2" />
              Loading…
            </div>
          ) : tab === 'inbox' ? (
            pending.length === 0 ? (
              <div className="card rounded-2xl p-8 text-center">
                <Inbox className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">No pending requests</p>
                <p className="text-zinc-600 text-xs mt-1">You'll see meeting requests from students here.</p>
              </div>
            ) : (
              pending.map(a => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-white font-semibold">{a.student_name}</p>
                    <span className="text-zinc-500 text-xs flex items-center gap-1">
                      <Clock className="w-3 h-3" />{timeAgo(a.created_at)}
                    </span>
                  </div>
                  <p className="text-zinc-300 text-sm leading-relaxed mb-1">"{a.topic}"</p>
                  {a.slot_label && <p className="text-aura-cyan text-xs font-medium mb-4 flex items-center gap-1"><Clock className="w-3 h-3" /> {a.slot_label}</p>}
                  {!a.slot_label && <div className="mb-3" />}
                  <div className="flex gap-2">
                    <button
                      onClick={() => respond(a.id, true)}
                      className="flex-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Check className="w-4 h-4" /> Accept
                    </button>
                    <button
                      onClick={() => respond(a.id, false)}
                      className="flex-1 bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <X className="w-4 h-4" /> Decline
                    </button>
                  </div>
                </motion.div>
              ))
            )
          ) : (
            history.length === 0 ? (
              <div className="card rounded-2xl p-8 text-center text-zinc-500 text-sm">
                No past appointments.
              </div>
            ) : (
              history.map(a => (
                <div key={a.id} className="card rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-white text-sm font-semibold">{a.student_name}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      a.status === 'accepted'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}>
                      {a.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-zinc-400 text-xs leading-relaxed">{a.topic}</p>
                  <p className="text-zinc-600 text-[10px] mt-1">{timeAgo(a.created_at)}</p>
                </div>
              ))
            )
          )}
        </div>
        )}

        {tab !== 'hours' && (
          <button
            onClick={refresh}
            className="w-full flex items-center justify-center gap-2 text-zinc-500 text-xs py-3 hover:text-aura-cyan transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        )}
      </main>
    </div>
  );
}

// ---------- Outer ----------------------------------------------------------

export default function Faculty() {
  const [faculty, setFaculty] = useState(() => {
    const raw = localStorage.getItem('aura.faculty');
    return raw ? JSON.parse(raw) : null;
  });

  const handleLogin = (f) => {
    setFaculty(f);
    localStorage.setItem('aura.faculty', JSON.stringify(f));
  };
  const handleLogout = () => {
    setFaculty(null);
    localStorage.removeItem('aura.faculty');
  };

  return faculty
    ? <Dashboard faculty={faculty} onLogout={handleLogout} />
    : <LoginScreen onLogin={handleLogin} />;
}
