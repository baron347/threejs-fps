// audio.js — procedural WebAudio sounds for MERIDIAN DEPOT. No audio files.
// A shared noise buffer + oscillators through one low master gain.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
      // 1s of white noise, reused by every percussive sound.
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  function noise(dur, filterFreq, gainVal, type = 'lowpass') {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gainVal, type = 'sine', slideTo = null) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const api = {
    ensure,
    /** kind: 'pistol' | 'rifle' | 'smg' | 'sniper' */
    shot(kind) {
      if (!ctx) return;
      if (kind === 'pistol') { noise(0.12, 1800, 0.9, 'highpass'); tone(160, 0.08, 0.5, 'square', 60); }
      else if (kind === 'rifle') { noise(0.16, 1200, 1.0, 'bandpass'); tone(120, 0.12, 0.6, 'square', 50); }
      else if (kind === 'smg') { noise(0.09, 2200, 0.7, 'highpass'); tone(200, 0.06, 0.4, 'square', 90); }
      else if (kind === 'sniper') { noise(0.3, 900, 1.0, 'lowpass'); tone(90, 0.25, 0.8, 'sawtooth', 40); }
      else { noise(0.12, 1500, 0.8, 'highpass'); }
    },
    reload() {
      if (!ctx) return;
      tone(700, 0.05, 0.25, 'square');
      setTimeout(() => tone(500, 0.05, 0.25, 'square'), 140);
      setTimeout(() => tone(900, 0.06, 0.3, 'square'), 300);
    },
    hit() {
      tone(1200, 0.06, 0.35, 'sine', 900);
    },
    dryFire() {
      tone(1800, 0.03, 0.2, 'square');
    },
    buy() {
      tone(660, 0.08, 0.3, 'triangle');
      setTimeout(() => tone(990, 0.12, 0.3, 'triangle'), 90);
    },
    step() {
      noise(0.05, 500, 0.12, 'lowpass');
    },
    plant() {
      tone(440, 0.1, 0.3, 'square');
      setTimeout(() => tone(440, 0.1, 0.3, 'square'), 150);
      setTimeout(() => tone(660, 0.15, 0.3, 'square'), 300);
    },
    beep() {
      tone(880, 0.09, 0.35, 'sine');
    },
    explode() {
      if (!ctx) return;
      noise(1.2, 300, 1.0, 'lowpass');
      tone(60, 1.0, 0.9, 'sine', 30);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.3, 'triangle'), i * 130));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.3, 'triangle'), i * 150));
    },
  };
  return api;
}
