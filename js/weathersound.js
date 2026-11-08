// Звук погоды: дождь, ветер, гром. Свой AudioContext (запускается после первого касания/клавиши).
import { S } from './settings.js';
let ctx = null, master = null, noise = null, L = null;

function loop(type, freq, q) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
  s.connect(f); f.connect(g); g.connect(master); s.start(0, Math.random());
  return { f, g };
}
function ensure() {
  if (ctx) return true;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return false;
  ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination);
  const n = ctx.sampleRate * 2; noise = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  L = { hi: loop('highpass', 1800, 0.5), lo: loop('lowpass', 700, 0.7), wind: loop('bandpass', 380, 0.8) };
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.17; lg.gain.value = 140; // ветер «дышит»
  lfo.connect(lg); lg.connect(L.wind.f.frequency); lfo.start();
  return true;
}
if (typeof addEventListener === 'function') {
  const kick = () => { if (ensure() && ctx.state === 'suspended') ctx.resume(); };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, kick, { passive: true });
}
const vol = () => Math.max(0, Math.min(1, (S.master ?? 0.8) * (S.amb ?? 0.6)));

// rain, snow, wind: 0..1
export function updateWeatherSound(dt, { rain, snow, wind }) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, v = vol(), k = (p, x) => p.setTargetAtTime(x, t, 0.6);
  k(L.hi.g.gain, 0.2 * rain * v); k(L.lo.g.gain, 0.14 * rain * v);
  k(L.wind.g.gain, (0.1 * wind + 0.05 * snow) * (0.5 + 0.5 * rain) * v);
}
// раскат грома: power 0..1 (дальше — тише и глуше)
export function thunder(power) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, v = Math.max(vol(), 0.15) * 1.6;
  const burst = (type, f0, f1, q, att, dec, peak, delay) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = t + delay;
    s.buffer = noise; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dec);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0, Math.random()); s.stop(t0 + dec + 0.1);
  };
  burst('lowpass', 300, 60, 0.7, 0.15, 2.2 + 3 * power, 0.9 * power * v, 0);
  burst('lowpass', 220, 50, 0.7, 0.3, 2 + 2 * power, 0.5 * power * v, 0.8);
  if (power > 0.6) burst('bandpass', 1800, 500, 0.7, 0.01, 0.35, 0.45 * power * v, 0); // близкий треск
}
