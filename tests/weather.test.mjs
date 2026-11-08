// Запуск: node tests/weather.test.mjs
import assert from 'node:assert/strict';
import { WeatherSystem, WEATHER } from '../js/weather.js';

let seed = 12345;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let passed = 0; const test = (n, f) => { f(); passed++; console.log('ok  -', n); };

test('4 часа симуляции: параметры в диапазоне 0..1, бывают все состояния, молнии и мокрая земля', () => {
  const w = new WeatherSystem(rng), t = {}, dt = 0.5; let strikes = 0, maxWet = 0, minC = 9, maxC = 0;
  for (let i = 0; i < 7200 * 2; i++) {
    w.update(dt); t[w.kind] = (t[w.kind] || 0) + dt;
    for (const e of w.takeEvents()) if (e.type === 'strike') { strikes++; assert.ok(e.dist >= 0.15 && e.dist <= 1 && e.power > 0.4 && e.power <= 1); }
    maxWet = Math.max(maxWet, w.wet); minC = Math.min(minC, w.s.cloud); maxC = Math.max(maxC, w.s.cloud);
    for (const k of ['cloud', 'rain', 'fog', 'wind', 'dark']) assert.ok(w.s[k] >= -1e-9 && w.s[k] <= 1 + 1e-9, k + ' ' + w.s[k]);
    assert.ok(w.wet >= 0 && w.wet <= 1 && w.flash >= 0 && w.flash <= 1);
  }
  for (const k of Object.keys(WEATHER)) assert.ok(t[k] > 0, 'не было состояния ' + k);
  assert.ok(strikes > 0 && maxWet > 0.5 && minC < 0.3 && maxC > 0.95);
});
test('молнии бывают только в грозу', () => {
  const w = new WeatherSystem(rng, 'clear'); w.timer = 1e9;
  for (let i = 0; i < 2000; i++) w.update(0.5);
  assert.equal(w.takeEvents().filter((e) => e.type === 'strike').length, 0);
});
test('set(storm): плавный переход к грозе, ливень, молнии, событие change', () => {
  const w = new WeatherSystem(rng); w.set('storm');
  assert.deepEqual(w.takeEvents(), [{ type: 'change', kind: 'storm' }]);
  assert.ok(w.s.rain < 0.1); // сразу не включается
  let strikes = 0; for (let i = 0; i < 400; i++) { w.update(0.5); w.timer = 1e9; strikes += w.takeEvents().filter((e) => e.type === 'strike').length; }
  assert.ok(w.s.rain > 0.95 && w.s.cloud > 0.95 && strikes >= 5);
});
test('cycle обходит все состояния по кругу', () => {
  const w = new WeatherSystem(rng), seen = new Set([w.kind]);
  for (let i = 0; i < Object.keys(WEATHER).length; i++) { w.cycle(); seen.add(w.kind); }
  assert.equal(seen.size, Object.keys(WEATHER).length);
});
test('земля высыхает после дождя', () => {
  const w = new WeatherSystem(rng); w.wet = 1; w.timer = 1e9;
  for (let i = 0; i < 600; i++) w.update(1);
  assert.ok(w.wet < 0.01);
});
console.log(`\n${passed} weather tests passed`);
