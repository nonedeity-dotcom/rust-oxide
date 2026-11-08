// Звуки: всё синтезируется на лету через WebAudio, файлов нет (apk не растёт).
// Контекст создаётся после первого касания/клавиши — иначе Android/браузер его не запускает.
let ctx = null, master = null, sfxG = null, ambG = null, noise = null, wind = null, waves = null, fire = null;
const vol = { master: 0.8, sfx: 0.9, amb: 0.6 };
let birdT = 2, cricketT = 1, lastStep = 0;

export function setVolumes(v) {
  Object.assign(vol, { master: v.master, sfx: v.sfx, amb: v.amb });
  if (!ctx) return;
  master.gain.value = vol.master; sfxG.gain.value = vol.sfx; ambG.gain.value = vol.amb;
}

export function unlock() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); sfxG = ctx.createGain(); ambG = ctx.createGain();
    sfxG.connect(master); ambG.connect(master); master.connect(ctx.destination);
    const n = ctx.sampleRate * 2; noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    setVolumes(vol); startAmbient();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// ---------- кирпичики ----------
function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
function tone(f0, f1, dur, { type = 'sine', gain = 0.3, delay = 0, out = sfxG } = {}) {
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, 0.005, gain, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function hiss(dur, { f0 = 1000, f1 = f0, q = 1, type = 'bandpass', gain = 0.3, delay = 0, out = sfxG } = {}) {
  const t = ctx.currentTime + delay, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  env(g, t, 0.004, gain, dur); s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

const SFX = {
  swing:    () => hiss(0.16, { f0: 500, f1: 1600, q: 0.8, gain: 0.12 }),
  hitWood:  () => { hiss(0.12, { f0: 900, f1: 250, type: 'lowpass', gain: 0.5 }); tone(150, 70, 0.14, { gain: 0.5 }); },
  hitStone: () => { hiss(0.06, { f0: 3200, q: 2, gain: 0.35 }); tone(900, 450, 0.08, { type: 'triangle', gain: 0.25 }); },
  hitOre:   () => { SFX.hitStone(); tone(1900, 1500, 0.35, { gain: 0.1, delay: 0.01 }); tone(2750, 2400, 0.25, { gain: 0.06, delay: 0.01 }); },
  hitMetal: () => { tone(420, 380, 0.5, { type: 'square', gain: 0.12 }); tone(630, 600, 0.4, { gain: 0.12 }); tone(1130, 1100, 0.3, { gain: 0.07 }); hiss(0.05, { f0: 4000, gain: 0.3 }); },
  break:    () => { hiss(0.45, { f0: 1400, f1: 200, type: 'lowpass', gain: 0.55 }); tone(110, 40, 0.4, { gain: 0.5 }); },
  pickup:   () => { tone(660, 700, 0.1, { gain: 0.18 }); tone(990, 1040, 0.14, { gain: 0.16, delay: 0.07 }); },
  craft:    () => { [520, 660, 780, 1040].forEach((f, i) => tone(f, f * 1.02, 0.12, { type: 'triangle', gain: 0.2, delay: i * 0.07 })); },
  place:    () => { tone(90, 45, 0.25, { gain: 0.6 }); hiss(0.2, { f0: 700, f1: 200, type: 'lowpass', gain: 0.4 }); },
  deny:     () => tone(170, 140, 0.14, { type: 'square', gain: 0.1 }),
  click:    () => tone(1300, 1000, 0.04, { type: 'triangle', gain: 0.14 }),
  jump:     () => hiss(0.14, { f0: 350, f1: 900, q: 0.7, gain: 0.14 }),
  land:     () => { tone(100, 50, 0.16, { gain: 0.4 }); hiss(0.1, { f0: 600, type: 'lowpass', gain: 0.25 }); },
  grass:    () => hiss(0.07, { f0: 1700 + Math.random() * 500, q: 0.8, gain: 0.11 }),
  sand:     () => hiss(0.1, { f0: 1100 + Math.random() * 300, f1: 700, q: 0.5, gain: 0.1 }),
  snow:     () => hiss(0.1, { f0: 3200 + Math.random() * 600, type: 'highpass', gain: 0.1 }),
  road:     () => { hiss(0.05, { f0: 1000, q: 1.5, gain: 0.16 }); tone(130, 90, 0.07, { gain: 0.2 }); },
  die:      () => { tone(330, 35, 1.1, { type: 'sawtooth', gain: 0.3 }); hiss(0.9, { f0: 900, f1: 80, type: 'lowpass', gain: 0.5 }); },
  spawn:    () => { tone(300, 600, 0.35, { type: 'triangle', gain: 0.18 }); },
  hitFlesh: () => { hiss(0.1, { f0: 700, f1: 200, type: 'lowpass', gain: 0.5 }); tone(120, 60, 0.12, { gain: 0.45 }); },
  kill:     () => { SFX.hitFlesh(); tone(180, 40, 0.5, { type: 'sawtooth', gain: 0.2, delay: 0.05 }); },
  crate:    () => { hiss(0.2, { f0: 900, f1: 300, type: 'lowpass', gain: 0.35 }); tone(220, 160, 0.12, { type: 'square', gain: 0.1 }); SFX.pickup(); },
  hurt:     () => { tone(140, 70, 0.22, { type: 'sawtooth', gain: 0.3 }); hiss(0.18, { f0: 500, f1: 150, type: 'lowpass', gain: 0.45 }); },
  growl:    () => { tone(85, 55, 0.7, { type: 'sawtooth', gain: 0.25 }); tone(110, 70, 0.7, { type: 'square', gain: 0.1 }); hiss(0.6, { f0: 300, f1: 180, type: 'lowpass', gain: 0.3 }); },
  squeal:   () => { tone(900, 500, 0.25, { type: 'sawtooth', gain: 0.12 }); tone(1300, 700, 0.2, { type: 'square', gain: 0.05, delay: 0.05 }); },
  equip:    () => { hiss(0.15, { f0: 1200, f1: 400, q: 0.8, gain: 0.25 }); tone(300, 400, 0.1, { type: 'triangle', gain: 0.12, delay: 0.08 }); },
};
export function sfx(name) { if (ctx && ctx.state === 'running') SFX[name]?.(); }

// шаги: не чаще раза в 150 мс
export function step(surface) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime; if (now - lastStep < 0.15) return; lastStep = now;
  SFX[surface]?.();
}

// ---------- окружение ----------
function loopNoise(filterType, freq, out) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; s.loop = true; f.type = filterType; f.frequency.value = freq; g.gain.value = 0;
  s.connect(f); f.connect(g); g.connect(out); s.start();
  return { g, f };
}
function lfo(param, rate, depth) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = rate; g.gain.value = depth;
  o.connect(g); g.connect(param); o.start();
}
function startAmbient() {
  wind = loopNoise('bandpass', 420, ambG); lfo(wind.f.frequency, 0.13, 160);
  waves = loopNoise('lowpass', 520, ambG); lfo(waves.f.frequency, 0.11, 260);
  fire = loopNoise('highpass', 2600, ambG);
}
function bird() {
  const f = 2200 + Math.random() * 1600, n = 2 + (Math.random() * 3 | 0);
  for (let i = 0; i < n; i++) tone(f, f * 1.25, 0.09, { gain: 0.07, delay: i * 0.12, out: ambG });
}
function cricket() {
  for (let i = 0; i < 5; i++) tone(4300, 4300, 0.05, { type: 'square', gain: 0.012, delay: i * 0.07, out: ambG });
}
// s: { coast 0..1, night 0..1, biome, fire 0..1 (близость к работающей печи) }
export function ambience(dt, s) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, k = (p, v) => p.setTargetAtTime(v, t, 0.6);
  const w = s.biome === 'winter' ? 0.2 : s.biome === 'desert' ? 0.13 : 0.07;
  k(wind.g.gain, w + 0.05 * s.coast); k(waves.g.gain, 0.02 + 0.2 * s.coast);
  k(fire.g.gain, 0.05 * s.fire * (0.6 + 0.4 * Math.random()));
  if (s.night < 0.5 && s.biome === 'forest' && (birdT -= dt) < 0) { birdT = 3 + Math.random() * 6; bird(); }
  if (s.night > 0.6 && s.biome !== 'winter' && (cricketT -= dt) < 0) { cricketT = 0.8 + Math.random() * 2; cricket(); }
}
