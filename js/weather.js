// Погода: чистая логика без three.js (проверяется тестами). Параметры плавно «перетекают» к целям нового состояния.
export const WEATHER = {
  clear:    { name: 'Ясно',                  icon: '☀️', cloud: 0.12, rain: 0,    fog: 0,    wind: 0.2,  dark: 0 },
  partly:   { name: 'Переменная облачность', icon: '⛅', cloud: 0.45, rain: 0,    fog: 0,    wind: 0.35, dark: 0.05 },
  overcast: { name: 'Пасмурно',              icon: '☁️', cloud: 0.85, rain: 0,    fog: 0.08, wind: 0.45, dark: 0.3 },
  rain:     { name: 'Дождь',                 icon: '🌧️', cloud: 0.92, rain: 0.65, fog: 0.22, wind: 0.55, dark: 0.45 },
  storm:    { name: 'Гроза',                 icon: '⛈️', cloud: 1,    rain: 1,    fog: 0.3,  wind: 1,    dark: 0.65 },
  fog:      { name: 'Туман',                 icon: '🌫️', cloud: 0.55, rain: 0,    fog: 1,    wind: 0.08, dark: 0.15 },
};
// веса перехода: что может быть следующим
const NEXT = {
  clear:    { partly: 5, fog: 1.5, overcast: 1 },
  partly:   { clear: 4, overcast: 3, rain: 1.5, fog: 1 },
  overcast: { partly: 2, rain: 4, storm: 1.2, fog: 1.2, clear: 1 },
  rain:     { overcast: 3, storm: 2, partly: 1.5, fog: 0.8 },
  storm:    { rain: 4, overcast: 2 },
  fog:      { clear: 2.5, partly: 2, overcast: 1 },
};
const KEYS = ['cloud', 'rain', 'fog', 'wind', 'dark'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class WeatherSystem {
  constructor(rng = Math.random, start = 'clear') {
    this.rng = rng; this.kind = start; this.s = {};
    for (const k of KEYS) this.s[k] = WEATHER[start][k];
    this.timer = 45 + rng() * 40; // первая смена довольно скоро
    this.flash = 0; this.reflash = 0; this.strikeT = 5; this.wet = 0; this.events = [];
  }
  _pick() {
    const w = NEXT[this.kind], keys = Object.keys(w);
    let r = this.rng() * keys.reduce((a, k) => a + w[k], 0);
    for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
    return keys[0];
  }
  set(kind) { // принудительно (и по таймеру)
    if (!WEATHER[kind] || kind === this.kind) return;
    this.kind = kind; this.timer = 90 + this.rng() * 130; this.events.push({ type: 'change', kind });
  }
  cycle() { const ks = Object.keys(WEATHER); this.set(ks[(ks.indexOf(this.kind) + 1) % ks.length]); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  update(dt) {
    this.timer -= dt; if (this.timer <= 0) this.set(this._pick());
    const P = WEATHER[this.kind], k = 1 - Math.exp(-dt / 8); // ~20 с на переход
    for (const key of KEYS) this.s[key] += (P[key] - this.s[key]) * k;
    if (this.kind === 'storm' && this.s.rain > 0.6 && (this.strikeT -= dt) <= 0) { // молнии
      const dist = 0.15 + this.rng() * 0.85;
      this.flash = 1; this.reflash = 0.12; this.strikeT = 3 + this.rng() * 11;
      this.events.push({ type: 'strike', dist, bearing: this.rng() * Math.PI * 2, power: 1 - 0.55 * dist });
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.reflash > 0 && (this.reflash -= dt) <= 0) this.flash = Math.max(this.flash, 0.65); // вторая вспышка
    this.wet = clamp(this.wet + (this.s.rain > 0.08 ? (this.s.rain * dt) / 25 : -dt / 120), 0, 1); // земля мокнет и сохнет
  }
}
