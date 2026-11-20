/**
 * VoiceListener — continuous mic capture with adaptive VAD and a PRE-ROLL buffer.
 *
 * Captures RAW PCM samples via the Web Audio API (not MediaRecorder/webm) and encodes a clean
 * WAV per utterance. This is what makes the pre-roll possible AND reliable:
 *   - WAV can be sliced at any sample, so we can include the ~400ms BEFORE speech was detected
 *     (fixes dropped first words) without ever producing a corrupt file.
 *   - Earlier we tried slicing webm chunks; webm is a continuous stream and slicing the middle
 *     yields an unplayable file — which is exactly what made transcription fail.
 *
 * The detector calibrates to the room's noise floor so it ignores ambient sound but reliably
 * catches clear speech, and only ends an utterance after a generous trailing silence.
 */
export class VoiceListener {
  constructor(opts = {}) {
    this.onUtterance = opts.onUtterance || (() => {});
    this.onLevel = opts.onLevel || (() => {});
    this.onSpectrum = opts.onSpectrum || (() => {});
    this.onSpeechStart = opts.onSpeechStart || (() => {});
    this.onSpeechEnd = opts.onSpeechEnd || (() => {});
    this.bars = opts.bars ?? 36;

    // Adaptive detection (relative to the live noise floor). Tuned a bit STRICTER so background
    // noise and the tail of AURA's own voice don't trigger false captures.
    this.startMult = opts.startMult ?? 3.0;
    this.keepMult  = opts.keepMult  ?? 1.6;
    this.startMargin = opts.startMargin ?? 0.014;
    this.floorFallback = opts.floorFallback ?? 0.006;

    this.startSustainMs = opts.startSustainMs ?? 140;  // need a bit more sustained speech to start
    this.silenceMs = opts.silenceMs ?? 1000;       // trailing silence before ending (don't cut early)
    this.minSpeechMs = opts.minSpeechMs ?? 400;
    this.minAvgMult = opts.minAvgMult ?? 1.9;      // clip avg loudness must beat floor*this
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15000;
    this.preRollMs = opts.preRollMs ?? 400;        // audio kept BEFORE detection (fixes onset)

    this.noiseFloor = this.floorFallback;

    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.processor = null;
    this.muteGain = null;

    this.sampleRate = 48000;
    this.recent = [];        // ring buffer of recent Float32 chunks (pre-roll), used while idle
    this.recentSamples = 0;
    this.utter = [];         // chunks for the current utterance
    this.curRms = 0;         // latest chunk RMS (computed in the audio callback)

    this.paused = false;
    this.speaking = false;
    this.speechStartedAt = 0;
    this.lastVoiceAt = 0;
    this.loudSince = 0;
    this._intervalId = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;

    const source = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    // Raw-sample capture. ScriptProcessor must be connected to a destination to fire, so route it
    // through a zero-gain node to avoid any mic→speaker feedback.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.muteGain = this.ctx.createGain();
    this.muteGain.gain.value = 0;
    source.connect(this.processor);
    this.processor.connect(this.muteGain);
    this.muteGain.connect(this.ctx.destination);

    const preRollSamples = () => (this.preRollMs / 1000) * this.sampleRate;
    this.processor.onaudioprocess = (e) => {
      if (this.paused) return;
      const input = e.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input.length);
      chunk.set(input);

      // chunk RMS for the VAD
      let s = 0; for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
      this.curRms = Math.sqrt(s / chunk.length);

      if (this.speaking) {
        this.utter.push(chunk);
      } else {
        this.recent.push(chunk);
        this.recentSamples += chunk.length;
        const cap = preRollSamples() + chunk.length * 2;
        while (this.recent.length > 1 && this.recentSamples > cap) {
          this.recentSamples -= this.recent[0].length;
          this.recent.shift();
        }
      }
    };

    this._startLoop();
  }

  pause()  { this.paused = true; this.speaking = false; this.utter = []; }
  resume() {
    this.paused = false;
    this.speaking = false;
    this.loudSince = 0;
    this.recent = []; this.recentSamples = 0; this.utter = [];
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  stop() {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    try { if (this.processor) this.processor.onaudioprocess = null; } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
    this.stream = null; this.ctx = null;
  }

  _emit() {
    // Build the full sample array: pre-roll (recent) + the utterance.
    const all = this.recent.concat(this.utter);
    let total = 0; for (const c of all) total += c.length;
    const samples = new Float32Array(total);
    let off = 0;
    for (const c of all) { samples.set(c, off); off += c.length; }

    const durMs = (total / this.sampleRate) * 1000;

    // loudness check over the captured samples
    let sum = 0, peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      sum += samples[i] * samples[i];
      if (a > peak) peak = a;
    }
    const avg = total ? Math.sqrt(sum / total) : 0;

    // reset buffers for the next utterance
    this.recent = []; this.recentSamples = 0; this.utter = [];

    const loudEnough = avg >= this.noiseFloor * this.minAvgMult && peak >= this.noiseFloor * this.startMult;
    if (durMs >= this.minSpeechMs && loudEnough && total > this.sampleRate * 0.2) {
      this.onUtterance(encodeWav(samples, this.sampleRate));
    }
  }

  _startLoop() {
    const freq = new Uint8Array(this.analyser.frequencyBinCount);
    this._intervalId = setInterval(() => {
      if (!this.analyser) return;
      if (this.ctx && this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); return; }

      const rms = this.curRms;
      this.onLevel(rms);

      // spectrum for the visualizer
      this.analyser.getByteFrequencyData(freq);
      const bars = this.bars;
      const usable = Math.floor(freq.length * 0.7);
      const step = Math.max(1, Math.floor(usable / bars));
      const spectrum = new Array(bars);
      for (let b = 0; b < bars; b++) {
        let s = 0; for (let j = 0; j < step; j++) s += freq[b * step + j] || 0;
        spectrum[b] = (s / step) / 255;
      }
      this.onSpectrum(spectrum);

      if (this.paused) return;
      const now = performance.now();
      const startLevel = this.noiseFloor * this.startMult + this.startMargin;
      const keepLevel  = this.noiseFloor * this.keepMult;

      if (!this.speaking) {
        if (rms < startLevel) {
          this.noiseFloor = Math.min(Math.max(this.noiseFloor * 0.95 + rms * 0.05, 0.002), 0.05);
        }
        if (rms >= startLevel) {
          if (!this.loudSince) this.loudSince = now;
          if (now - this.loudSince >= this.startSustainMs) {
            // begin capturing; the `recent` ring already holds the pre-roll onset
            this.speaking = true;
            this.utter = [];
            this.speechStartedAt = now;
            this.lastVoiceAt = now;
            this.onSpeechStart();
          }
        } else {
          this.loudSince = 0;
        }
      } else {
        if (rms >= keepLevel) this.lastVoiceAt = now;
        const silentFor = now - this.lastVoiceAt;
        const tooLong = now - this.speechStartedAt > this.maxUtteranceMs;
        if (silentFor > this.silenceMs || tooLong) {
          this.speaking = false;
          this.loudSince = 0;
          this.onSpeechEnd();
          this._emit();
        }
      }
    }, 20);
  }
}

// ---- WAV encoder: Float32 PCM (-1..1) -> 16-bit mono WAV blob -----------------
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
    off += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}
