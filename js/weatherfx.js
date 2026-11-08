// Визуал погоды: дождь (штрихи), снег (хлопья), молнии, подпись при смене погоды. Всё считается на GPU.
import * as THREE from 'three';
import { WEATHER } from './weather.js';
import { updateWeatherSound, thunder } from './weathersound.js';

const BOX = new THREE.Vector3(28, 24, 28); // область осадков вокруг игрока
const RAIN = [1400, 2800, 4500], SNOW = [1200, 2200, 3500]; // число штрихов/хлопьев по качеству
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const COMMON = `uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform float uAmt;
  attribute vec3 aSeed; varying float vA;`;
// положение капли/хлопья: по кругу внутри коробки, по горизонтали «приклеено» к миру (не едет вместе с игроком)
const WRAP = `vec2 xz = aSeed.xz * uBox.xz;
  xz = uCenter.xz + mod(xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;`;
function seeds(n, per) {
  const a = new Float32Array(n * per * 3);
  for (let i = 0; i < n; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); for (let k = 0; k < per; k++) a.set([x, y, z], (i * per + k) * 3); }
  return a;
}

export class WeatherFx {
  constructor(scene) {
    this.scene = scene; this.time = 0; this.snow = 0; this.q = 1; this.windA = 0.6; this.bolts = []; this.toastT = 0;
    const shared = () => ({ uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX }, uWind: { value: new THREE.Vector2() }, uAmt: { value: 0 }, uLight: { value: 1 } });
    // ---- дождь: LineSegments, у каждой капли 2 вершины (низ и хвост)
    const rg = new THREE.BufferGeometry(), N = RAIN[2];
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(N, 2), 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(Float32Array.from({ length: N * 2 }, (_, i) => i % 2), 1));
    this.ru = Object.assign(shared(), { uSpeed: { value: 22 }, uLen: { value: 0.9 } });
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: this.ru, transparent: true, depthWrite: false, fog: false,
      vertexShader: `${COMMON} attribute float aEnd; uniform float uSpeed; uniform float uLen;
        void main() {
          ${WRAP}
          float y = mod(aSeed.y * uBox.y - uTime * uSpeed, uBox.y);
          vec3 p = vec3(xz.x, uCenter.y - 6.0 + y, xz.y) + normalize(vec3(uWind.x, 1.0, uWind.y)) * aEnd * uLen;
          float rank = fract(aSeed.x * 91.7 + aSeed.z * 53.3);
          float dist = length(p.xz - uCenter.xz);
          vA = step(rank, uAmt) * (1.0 - smoothstep(9.0, 14.0, dist)) * smoothstep(0.0, 2.0, y) * (1.0 - smoothstep(uBox.y - 3.0, uBox.y, y)) * mix(1.0, 0.1, aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'uniform float uLight; varying float vA; void main() { gl_FragColor = vec4(vec3(0.72, 0.8, 0.9) * (0.3 + 0.7 * uLight), vA * 0.45); }',
    }));
    // ---- снег: Points с мягким круглым спрайтом
    const sg = new THREE.BufferGeometry(), M = SNOW[2];
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(M, 1), 3));
    this.su = Object.assign(shared(), { uSpeed: { value: 1.8 }, uFocal: { value: 700 } });
    this.snowPts = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.su, transparent: true, depthWrite: false, fog: false,
      vertexShader: `${COMMON} uniform float uSpeed; uniform float uFocal;
        void main() {
          float y = mod(aSeed.y * uBox.y - uTime * uSpeed, uBox.y);
          vec2 sw = vec2(sin(uTime * 0.7 + aSeed.x * 40.0), cos(uTime * 0.6 + aSeed.z * 40.0)) * 0.6 + uWind * (uBox.y - y) * 0.25;
          vec2 xz0 = aSeed.xz * uBox.xz + sw;
          vec2 xz = uCenter.xz + mod(xz0 - uCenter.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
          vec3 p = vec3(xz.x, uCenter.y - 6.0 + y, xz.y);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float rank = fract(aSeed.x * 91.7 + aSeed.z * 53.3);
          float dist = length(p.xz - uCenter.xz);
          vA = step(rank, uAmt) * (1.0 - smoothstep(9.0, 14.0, dist)) * smoothstep(0.0, 2.0, y) * (1.0 - smoothstep(uBox.y - 3.0, uBox.y, y));
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.07 * (0.6 + aSeed.y) * uFocal / max(0.5, -mv.z), 1.5, 9.0);
        }`,
      fragmentShader: 'uniform float uLight; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, d); gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * (0.35 + 0.65 * uLight), a * vA * 0.9); }',
    }));
    for (const o of [this.rain, this.snowPts]) { o.frustumCulled = false; o.renderOrder = 5; o.visible = false; scene.add(o); }
    this.setQuality(1);
    // подпись о погоде + тап по часам листает погоду (для проверки)
    if (typeof document !== 'undefined') {
      const t = this.toast = document.createElement('div');
      t.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 58px);transform:translateX(-50%);padding:6px 14px;border-radius:14px;background:#000b;color:#fff;font:600 14px system-ui,sans-serif;opacity:0;transition:opacity .5s;pointer-events:none;z-index:6;white-space:nowrap';
      document.body.appendChild(t);
    }
  }
  setQuality(q) {
    this.q = q;
    this.rain.geometry.setDrawRange(0, RAIN[q] * 2); this.snowPts.geometry.setDrawRange(0, SNOW[q]);
  }
  _say(kind) {
    if (!this.toast) return; const W = WEATHER[kind];
    this.toast.textContent = `${W.icon} ${W.name}`; this.toast.style.opacity = 1; this.toastT = 4;
  }
  _bolt(pp, ev) { // зигзаг сверху вниз + ветка; звук приходит позже вспышки
    const a = ev.bearing, dist = 160 + ev.dist * 240, pts = [], pts2 = [];
    let x = pp.x + Math.cos(a) * dist, z = pp.z + Math.sin(a) * dist; const segs = 14, top = 230;
    for (let i = 0; i <= segs; i++) {
      const y = top * (1 - i / segs); pts.push(new THREE.Vector3(x, y, z));
      if (i === 6) pts2.push(new THREE.Vector3(x, y, z));
      if (pts2.length && i > 6 && i < 11) pts2.push(new THREE.Vector3(x + (i - 6) * 9, y, z + (i - 6) * 6));
      x += (Math.random() - 0.5) * 26; z += (Math.random() - 0.5) * 26;
    }
    const mat = new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 1, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const grp = new THREE.Group();
    for (const [p, dx] of [[pts, 0], [pts, 0.7], [pts2, 0]]) { if (p.length > 1) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), mat); l.position.x = dx; l.frustumCulled = false; grp.add(l); } }
    this.scene.add(grp); this.bolts.push({ grp, mat, age: 0 });
    setTimeout(() => thunder(ev.power), (0.3 + ev.dist * 6) * 1000);
  }
  // pp — позиция игрока (ноги), snowBiome — игрок на снегу (вместо дождя идёт снег), light — освещённость 0..1
  update(dt, pp, wx, snowBiome, light) {
    this.time += dt;
    for (const e of wx.takeEvents()) { if (e.type === 'change') this._say(e.kind); else if (e.type === 'strike') this._bolt(pp, e); }
    if (this.toastT > 0 && (this.toastT -= dt) <= 0 && this.toast) this.toast.style.opacity = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.age += dt;
      b.mat.opacity = b.age < 0.3 ? (Math.sin(b.age * 90) > -0.3 ? 1 : 0.3) * (1 - b.age / 0.3) : 0;
      if (b.age >= 0.3) { this.scene.remove(b.grp); b.grp.children.forEach((l) => l.geometry.dispose()); b.mat.dispose(); this.bolts.splice(i, 1); }
    }
    this.snow += ((snowBiome ? 1 : 0) - this.snow) * Math.min(1, dt * 0.8); // плавный переход дождь ↔ снег на границе биома
    const s = wx.s, rainAmt = clamp(s.rain, 0, 1) * (1 - this.snow), snowAmt = clamp(s.rain * 1.25, 0, 1) * this.snow;
    this.windA += dt * 0.04; const wx2 = Math.cos(this.windA) * s.wind * 0.45, wz2 = Math.sin(this.windA) * s.wind * 0.45;
    const cy = pp.y + 1.7;
    for (const [u, amt, obj] of [[this.ru, rainAmt, this.rain], [this.su, snowAmt, this.snowPts]]) {
      obj.visible = amt > 0.01;
      u.uTime.value = this.time; u.uCenter.value.set(pp.x, cy, pp.z); u.uWind.value.set(wx2, wz2); u.uAmt.value = amt; u.uLight.value = clamp(light + wx.flash, 0, 1);
    }
    this.su.uFocal.value = (typeof innerHeight === 'number' ? innerHeight : 700) * Math.min(globalThis.devicePixelRatio || 1, 1.5) * 0.75;
    updateWeatherSound(dt, { rain: rainAmt, snow: snowAmt, wind: s.wind });
  }
}
