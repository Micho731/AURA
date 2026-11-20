import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Smartphone, Monitor, Users, ShieldCheck } from 'lucide-react';
import { API } from '../api';
import Logo from '../components/Logo';
import BrandFooter from '../components/BrandFooter';

/**
 * Home — a clean launcher for the AURA kiosk surfaces.
 */
export default function Home() {
  const [online, setOnline] = useState(null);

  useEffect(() => {
    const check = async () => {
      try { const r = await fetch(`${API}/`); setOnline(r.ok); }
      catch { setOnline(false); }
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const routes = [
    { path: '/display', icon: Monitor,    title: 'Reception display', desc: 'The main kiosk screen.' },
    { path: '/face',    icon: Smartphone, title: 'Avatar face',       desc: 'The talking face on the extended screen.' },
    { path: '/faculty', icon: Users,      title: 'Faculty portal',    desc: 'Instructor inbox & availability.' },
    { path: '/admin',   icon: ShieldCheck,title: 'Admin',             desc: 'Manage instructors.' },
  ];

  return (
    <div className="min-h-screen vignette flex flex-col items-center justify-center p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
        <Logo name="aura" className="h-28 w-auto mx-auto mb-4 animate-float" />
        <p className="text-zinc-400 text-lg">Faculty of Engineering · Reception Assistant</p>
        <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border ${
          online === true  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
          online === false ? 'border-red-500/30 bg-red-500/10 text-red-400' :
                             'border-white/10 bg-white/5 text-zinc-400'}`}>
          <span className={`w-2 h-2 rounded-full ${online === true ? 'bg-emerald-400' : online === false ? 'bg-red-400' : 'bg-zinc-400'}`} />
          {online === true ? 'System online' : online === false ? 'Backend offline' : 'Checking…'}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-3xl">
        {routes.map((r, i) => {
          const Icon = r.icon;
          return (
            <motion.div key={r.path} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Link to={r.path} className="card rounded-2xl p-6 block hover:border-aura-cyan/40 transition-colors group">
                <Icon className="w-7 h-7 text-aura-cyan mb-3 group-hover:scale-110 transition-transform" />
                <h2 className="text-white font-display font-semibold text-xl">{r.title}</h2>
                <p className="text-zinc-500 text-sm mt-1 leading-relaxed">{r.desc}</p>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <BrandFooter className="mt-14" size="md" />
    </div>
  );
}
