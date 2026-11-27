import React from 'react';
import { motion } from 'framer-motion';
import { MapPin, User, GraduationCap, HelpCircle, CheckCircle2, XCircle, Building2, Briefcase, Image as ImageIcon } from 'lucide-react';
import { API } from '../api';
import { INSTITUTION_NAME } from '../config';

const STATUS_COLOR = {
  'Available':  'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  'In Class':   'text-amber-400 bg-amber-500/10 border-amber-500/30',
  'In Meeting': 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  'Busy':       'text-orange-400 bg-orange-500/10 border-orange-500/30',
  'Away':       'text-zinc-400 bg-zinc-500/10 border-zinc-500/30',
};

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

// ---------- Generic shell --------------------------------------------------

function CardShell({ icon: Icon, label, accent = 'cyan', children }) {
  const accentMap = {
    cyan:   'text-aura-cyan',
    emerald:'text-emerald-400',
    amber:  'text-amber-400',
    purple: 'text-fuchsia-400',
  };
  return (
    <motion.div {...fade} className="card rounded-3xl p-10 w-full max-w-5xl shadow-2xl">
      {label && (
        <div className={`flex items-center gap-3 mb-6 ${accentMap[accent]}`}>
          {Icon && <Icon className="w-5 h-5" />}
          <span className="text-xs font-semibold tracking-[0.3em] uppercase">{label}</span>
        </div>
      )}
      {children}
    </motion.div>
  );
}

// ---------- Idle -----------------------------------------------------------

export function IdleCard({ time }) {
  return (
    <motion.div {...fade} className="flex flex-col items-center justify-center text-center px-8">
      <div className="relative w-28 h-28 flex items-center justify-center mb-8">
        <div className="absolute inset-0 rounded-full border border-aura-cyan/20 animate-breath" />
        <div className="absolute inset-3 rounded-full border border-aura-cyan/30 animate-slow-spin border-dashed" />
        <div className="w-14 h-14 rounded-full bg-aura-cyan/15 border border-aura-cyan/40 flex items-center justify-center shadow-[0_0_40px_rgba(124,231,255,0.4)]">
          <span className="font-display font-black text-3xl text-aura-cyan">A</span>
        </div>
      </div>

      <h1 className="text-5xl font-display font-bold tracking-tight text-white mb-3">AURA</h1>
      <p className="text-zinc-400 text-base tracking-wide">Faculty of Engineering Reception</p>
      <p className="text-zinc-600 text-xs mt-1 tracking-widest font-light uppercase">{INSTITUTION_NAME}</p>

      <div className="mt-12 text-zinc-500 text-sm">
        <span className="font-mono">{time.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}</span>
      </div>

      <div className="mt-12 px-6 py-3 rounded-full border border-aura-cyan/20 bg-aura-cyan/5">
        <p className="text-aura-cyan text-sm font-light tracking-wider">
          <span className="font-semibold">Just speak</span> — I'm listening
        </p>
      </div>
    </motion.div>
  );
}

// ---------- Text fallback --------------------------------------------------

export function TextCard({ data }) {
  return (
    <CardShell label="Response" accent="cyan">
      {data?.title && <h2 className="text-3xl font-display font-bold text-white mb-3">{data.title}</h2>}
      <p className="text-xl text-zinc-200 leading-relaxed font-light">{data?.body}</p>
    </CardShell>
  );
}

// ---------- Faculty (single) ----------------------------------------------

export function FacultyCard({ data }) {
  const initials = (data?.name || '?').split(' ').filter(p => !/^(dr|prof|mr|ms)\.?$/i.test(p)).map(p => p[0]).slice(0, 2).join('');
  const statusClass = STATUS_COLOR[data?.status] || STATUS_COLOR.Away;
  return (
    <CardShell label="Faculty" icon={User} accent="cyan">
      <div className="flex items-start gap-8">
        <div className="w-28 h-28 rounded-2xl bg-aura-cyan/10 border border-aura-cyan/30 flex items-center justify-center flex-shrink-0">
          <span className="text-4xl font-display font-bold text-aura-cyan">{initials || 'F'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-3xl font-display font-bold text-white">{data?.name}</h2>
          {data?.title && <p className="text-zinc-400 text-base mt-1">{data.title}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-aura-cyan/10 border border-aura-cyan/25 text-aura-cyan">
              {data?.dept} Department
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusClass}`}>
              ● {data?.status || 'Unknown'}
            </span>
          </div>
          {data?.campus && (
            <div className="mt-5 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-aura-cyan" />
              <span className="text-base text-aura-cyan font-medium">{data.campus} campus</span>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-zinc-300">
            <MapPin className="w-4 h-4 text-aura-cyan" />
            <span className="text-base">{data?.office}</span>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ---------- Faculty list ---------------------------------------------------

export function FacultyListCard({ data }) {
  const items = data?.items || [];
  return (
    <CardShell label={`Faculty · ${items.length}`} icon={User} accent="cyan">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((f, i) => {
          const statusClass = STATUS_COLOR[f.status] || STATUS_COLOR.Away;
          return (
            <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-white/3 border border-white/5">
              <div className="w-12 h-12 rounded-xl bg-aura-cyan/10 border border-aura-cyan/25 flex items-center justify-center">
                <span className="text-base font-display font-bold text-aura-cyan">{(f.name || '?').split(' ').slice(-1)[0][0]}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white font-semibold truncate">{f.name}</p>
                <p className="text-zinc-500 text-sm truncate">{f.dept}{f.campus ? ` · ${f.campus}` : ''}{f.office ? ` · ${f.office}` : ''}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusClass} whitespace-nowrap`}>
                {f.status}
              </span>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

// ---------- Location -------------------------------------------------------

export function LocationCard({ data }) {
  return (
    <CardShell label="Directions" icon={MapPin} accent="cyan">
      <h2 className="text-3xl font-display font-bold text-white">{data?.place}</h2>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white/3 border border-white/5 p-5">
          <p className="text-zinc-500 text-xs tracking-widest uppercase mb-2">Building</p>
          <p className="text-white text-xl font-display font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-aura-cyan" />
            {data?.building}
          </p>
        </div>
        <div className="rounded-2xl bg-white/3 border border-white/5 p-5">
          <p className="text-zinc-500 text-xs tracking-widest uppercase mb-2">Room</p>
          <p className="text-white text-xl font-display font-semibold">{data?.room}</p>
        </div>
      </div>
      {data?.directions && (
        <p className="mt-6 text-zinc-300 text-lg font-light leading-relaxed">{data.directions}</p>
      )}
    </CardShell>
  );
}

// ---------- Programs -------------------------------------------------------

export function ProgramsCard({ data }) {
  const items = data?.items || [];
  return (
    <CardShell label="Programs" icon={GraduationCap} accent="purple">
      <div className="space-y-3">
        {items.map((p, i) => (
          <div key={i} className="rounded-2xl bg-white/3 border border-white/5 p-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-mono font-bold text-fuchsia-400">{p.code}</span>
            </div>
            <div>
              <h3 className="text-white font-display font-semibold text-xl">{p.name}</h3>
              <p className="text-zinc-400 text-sm mt-1 leading-relaxed">{p.description}</p>
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ---------- FAQ ------------------------------------------------------------

export function FAQCard({ data }) {
  return (
    <CardShell label="Frequently Asked" icon={HelpCircle} accent="amber">
      <h2 className="text-2xl font-display font-semibold text-white leading-snug">{data?.question}</h2>
      <p className="text-xl text-zinc-200 leading-relaxed font-light mt-5">{data?.answer}</p>
    </CardShell>
  );
}

// ---------- Appointment sent ----------------------------------------------

export function AppointmentSentCard({ data }) {
  return (
    <CardShell label="Meeting Requested" icon={Briefcase} accent="emerald">
      <div className="flex items-start gap-6">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-display font-bold text-white">Request sent to {data?.faculty_name}</h2>
          {data?.topic && <p className="text-zinc-400 text-base mt-2">Topic: <span className="text-zinc-200">{data.topic}</span></p>}
          {data?.faculty_office && <p className="text-zinc-500 text-sm mt-1 flex items-center gap-1.5"><MapPin className="w-4 h-4" />{data.faculty_office}</p>}
          <p className="text-emerald-400/80 text-sm mt-5 font-light">
            They'll receive a notification and can accept or decline. You'll be told when they respond.
          </p>
        </div>
      </div>
    </CardShell>
  );
}

// ---------- Media gallery --------------------------------------------------

export function MediaCard({ data }) {
  const items = (data?.items || []).filter(it => it.url);
  if (items.length === 0) {
    return <TextCard data={{ title: data?.title || 'AURA', body: data?.body || '' }} />;
  }
  const single = items.length === 1;
  // Media bypasses the narrow CardShell so wide flowcharts get full width and are shown whole
  // (object-contain), never cropped.
  return (
    <motion.div {...fade} className="w-full">
      <div className={`grid gap-4 ${single ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {items.map((it, i) => (
          <figure key={i} className="rounded-2xl overflow-hidden border border-white/10 bg-white">
            <img
              src={`${API}${it.url}`}
              alt={it.caption || ''}
              className="w-full object-contain max-h-[50vh]"
              loading="eager"
            />
            {it.caption && (
              <figcaption className="px-4 py-2 text-sm text-zinc-700 font-light bg-white">{it.caption}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </motion.div>
  );
}

// ---------- Appointment result (accepted / declined) -----------------------

export function AppointmentResultCard({ data }) {
  const accepted = data?.status === 'accepted';
  return (
    <CardShell
      label={accepted ? 'Meeting Accepted' : 'Meeting Declined'}
      icon={accepted ? CheckCircle2 : XCircle}
      accent={accepted ? 'emerald' : 'cyan'}
    >
      <div className="flex items-start gap-6">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 border ${
          accepted ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'
        }`}>
          {accepted
            ? <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            : <XCircle className="w-8 h-8 text-red-400" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-display font-bold text-white">
            {accepted
              ? `${data?.faculty_name} accepted your request`
              : `${data?.faculty_name} can't meet right now`}
          </h2>
          {accepted ? (
            <p className="text-emerald-300/90 text-lg mt-3 font-light flex items-center gap-2">
              <MapPin className="w-5 h-5" /> Head to {data?.faculty_office}
            </p>
          ) : (
            <p className="text-zinc-400 text-lg mt-3 font-light">
              Please try again later or visit the Dean's office for help.
            </p>
          )}
        </div>
      </div>
    </CardShell>
  );
}

// ---------- Dispatcher -----------------------------------------------------

export function SmartCard({ type, data }) {
  switch (type) {
    case 'faculty':              return <FacultyCard data={data} />;
    case 'faculty_list':         return <FacultyListCard data={data} />;
    case 'location':             return <LocationCard data={data} />;
    case 'programs':             return <ProgramsCard data={data} />;
    case 'faq':                  return <FAQCard data={data} />;
    case 'media':                return <MediaCard data={data} />;
    case 'appointment_sent':     return <AppointmentSentCard data={data} />;
    case 'appointment_result':   return <AppointmentResultCard data={data} />;
    case 'text':
    default:                     return <TextCard data={data} />;
  }
}
