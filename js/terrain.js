// Генерация острова: рельеф, биомы, кольцевая дорога, расстановка объектов.
// Без three.js — работает и в Node (для тестов).
import { CONFIG, ANIMALS } from './data.js';
import { STATION, toWorld, inStation, stationSolids } from './station.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function makeNoise(seed) {
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, oct = 4) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise(x, y) * amp; norm += amp; x *= 2; y *= 2; amp *= 0.5; }
    return sum / norm;
  };
  return { noise, fbm };
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const BIOMES = ['forest', 'desert', 'winter'];
export const ROAD_WIDTH = 5;
export const BEACH_HEIGHT = 2.2;

export function createTerrain(seed = 1337) {
  const n1 = makeNoise(seed), n2 = makeNoise(seed + 1), n3 = makeNoise(seed + 2);
  const R = CONFIG.islandRadius;
  const edgeR = (ang) => R * (0.9 + 0.3 * (n1.fbm(Math.cos(ang) * 1.3 + 10, Math.sin(ang) * 1.3 + 10, 3) - 0.5));
  const roadR = (ang) => R * 0.6 + 12 * (n2.fbm(Math.cos(ang) * 1.5 + 5, Math.sin(ang) * 1.5 + 5, 2) - 0.5) * 2;
  const roadDist = (x, z) => Math.abs(Math.hypot(x, z) - roadR(Math.atan2(z, x)));
  const pads = [], stations = []; // ровные площадки под заправки (добавляются после генерации, см. generateWorld)

  function heightAt(x, z) {
    const d = Math.hypot(x, z), ang = Math.atan2(z, x);
    const t = d / edgeR(ang);
    const coast = 1 - smoothstep(0.8, 1.1, t);
    const hills = n3.fbm(x * 0.012 + 100, z * 0.012 + 100, 4);
    const h = -4 + Math.pow(coast, 0.8) * (7 + hills * 14);
    // дорога лежит на ровной полосе
    const w = 1 - smoothstep(3, 16, Math.abs(d - roadR(ang)));
    const roadH = 4.5 + (n2.fbm(x * 0.02, z * 0.02, 2) - 0.5) * 1.5;
    let r = h + (roadH - h) * w;
    for (const p of pads) { const pd = Math.hypot(x - p.x, z - p.z); if (pd < p.blend) r = p.h + (r - p.h) * smoothstep(p.flat, p.blend, pd); }
    return r;
  }
  function biomeAt(x, z) {
    const h = heightAt(x, z);
    if (h < 0.1) return 'water';
    if (h < BEACH_HEIGHT) return 'beach';
    const warp = (n1.fbm(x * 0.008 + 50, z * 0.008 + 50, 3) - 0.5) * 1.4;
    let a = Math.atan2(z, x) + warp;
    a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return BIOMES[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 3) % 3];
  }
  const addPad = (x, z, h, flat, blend) => pads.push({ x, z, h, flat, blend });
  const inStationArea = (x, z, m = 0) => stations.some((st) => inStation(st, x, z, m));
  return { heightAt, biomeAt, roadDist, roadR, edgeR, addPad, stations, inStation: inStationArea };
}

// Заправки: по одной примерно в каждой четверти кольцевой дороги, с той стороны, где рельеф ровнее.
function placeStations(T, rnd, spawn) {
  const S = STATION, out = [], a0 = rnd() * Math.PI * 2;
  const road = (a) => { const r = T.roadR(a); return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };
  const rect = []; // контрольные точки площадки (локальные)
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) rect.push([S.slab.x0 + (S.slab.x1 - S.slab.x0) * i / 4, S.slab.z0 + (S.slab.z1 - S.slab.z0) * j / 4]);
  for (let k = 0; k < S.count; k++) {
    let best = null;
    for (const da of [0, 0.08, -0.08, 0.16, -0.16, 0.26, -0.26, 0.4, -0.4]) {
      const a = a0 + k * 2 * Math.PI / S.count + da, p = road(a), p1 = road(a - 0.01), p2 = road(a + 0.01);
      const tl = Math.hypot(p2.x - p1.x, p2.z - p1.z), tx = (p2.x - p1.x) / tl, tz = (p2.z - p1.z) / tl;
      for (const side of [1, -1]) {
        const nx = -tz * side, nz = tx * side; // нормаль к дороге в сторону площадки
        const st = { x: p.x + nx * S.offset, z: p.z + nz * S.offset, ry: Math.atan2(-nx, -nz), h: T.heightAt(p.x, p.z) };
        if (Math.hypot(st.x - spawn.x, st.z - spawn.z) < 60) continue;
        let dev = 0, ok = true;
        for (const [lx, lz] of rect) { const w = toWorld(st, lx, lz), h = T.heightAt(w.x, w.z); if (h < BEACH_HEIGHT + 0.6) ok = false; dev += Math.abs(h - st.h); }
        for (let i = 0; i < 8 && ok; i++) { const q = i * Math.PI / 4; if (T.heightAt(st.x + Math.cos(q) * 24, st.z + Math.sin(q) * 24) < 1.2) ok = false; } // у площадки не должно быть воды
        if (ok && (!best || dev < best.dev)) best = { st, dev };
      }
    }
    if (best) out.push(best.st);
  }
  return out;
}

export function generateWorld(seed = 1337) {
  const T = createTerrain(seed), rnd = mulberry32(seed * 31 + 7), R = CONFIG.islandRadius;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // --- точка появления: пляж на краю острова, а вглубь — лес
  let spawn = null, fallback = null;
  for (let i = 0; i < 360 && !spawn; i++) {
    const a = (i / 360) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = T.edgeR(a);
    for (let r = e * 1.15; r > e * 0.6; r -= 1) {
      const x = c * r, z = s * r, h = T.heightAt(x, z);
      if (h >= 0.7 && h <= 1.6) {
        fallback = fallback || { x, z };
        if (T.biomeAt(c * (r - 45), s * (r - 45)) === 'forest') spawn = { x, z };
        break;
      }
    }
  }
  spawn = spawn || fallback;
  spawn.y = T.heightAt(spawn.x, spawn.z);
  spawn.yaw = Math.atan2(spawn.x, spawn.z); // forward = (-sin, -cos) -> смотрим вглубь острова

  // --- расстановка объектов с минимальным расстоянием между ними
  let objects = []; const grid = new Map(), K = 4;
  const key = (cx, cz) => cx * 100003 + cz;
  const free = (x, z, sp) => {
    const cx = Math.floor(x / K), cz = Math.floor(z / K);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
      for (const o of grid.get(key(cx + i, cz + j)) || []) if (Math.hypot(o.x - x, o.z - z) < sp + o.sp) return false;
    return true;
  };
  const put = (o) => {
    o.y = T.heightAt(o.x, o.z); objects.push(o);
    const k = key(Math.floor(o.x / K), Math.floor(o.z / K));
    (grid.get(k) || grid.set(k, []).get(k)).push(o);
  };
  const rx = () => (rnd() * 2 - 1) * R * 1.1;

  // деревья
  let trees = 0;
  for (let i = 0; i < 14000 && trees < 650; i++) {
    const x = rx(), z = rx(), b = T.biomeAt(x, z);
    if (b === 'water' || T.roadDist(x, z) < 9 || Math.hypot(x - spawn.x, z - spawn.z) < 25) continue;
    let type, dens;
    if (b === 'forest') { type = pick(['oak', 'oak', 'apple', 'birch', 'birch', 'autumn']); dens = 0.6; }
    else if (b === 'winter') { type = 'snowpine'; dens = 0.5; }
    else if (b === 'desert') { type = 'palm'; dens = 0.1; }
    else { type = 'palm'; dens = 0.06; }
    if (rnd() > dens) continue;
    const s = 1.5 + rnd() * 0.8;
    if (!free(x, z, 1.8)) continue;
    put({ nt: 'tree', type, x, z, s, ry: rnd() * 6.28, sp: 1.8 }); trees++;
  }
  // камень / железо / сера
  const place = (nt, count, pref) => {
    for (let i = 0, c = 0; i < 6000 && c < count; i++) {
      const x = rx(), z = rx(), b = T.biomeAt(x, z);
      if (b === 'water' || b === 'beach' || T.roadDist(x, z) < 8 || Math.hypot(x - spawn.x, z - spawn.z) < 22) continue;
      if (pref && b !== pref && rnd() > 0.25) continue;
      const s = 0.9 + rnd() * 0.5;
      if (!free(x, z, 2.4 * s)) continue;
      put({ nt, type: nt, x, z, s, ry: rnd() * 6.28, sp: 2.4 * s }); c++;
    }
  };
  place('stone', 80, null); place('iron', 40, 'winter'); place('sulfur', 40, 'desert');

  // бочки по обеим сторонам кольцевой дороги
  for (let a = rnd() * 0.1; a < Math.PI * 2;) {
    const rr = T.roadR(a);
    for (const side of [-1, 1]) {
      if (rnd() > 0.75) continue;
      const r = rr + side * (ROAD_WIDTH / 2 + 1.3 + rnd() * 0.6), aa = a + (rnd() - 0.5) * 0.02;
      const x = Math.cos(aa) * r, z = Math.sin(aa) * r;
      if (T.heightAt(x, z) > 1 && free(x, z, 1)) put({ nt: 'barrel', type: 'barrel', x, z, s: 1, ry: rnd() * 6.28, sp: 1 });
    }
    a += (24 + rnd() * 10) / rr;
  }

  // --- заправки: ровная площадка в рельефе, объекты с площадки убираем, остальным пересчитываем высоту
  const stations = placeStations(T, rnd, spawn);
  for (const st of stations) { T.addPad(st.x, st.z, st.h, STATION.flat, STATION.blend); T.stations.push(st); }
  objects = objects.filter((o) => !T.inStation(o.x, o.z, 3));
  for (const o of objects) o.y = T.heightAt(o.x, o.z);
  const crates = [], solids = [];
  for (const st of stations) {
    st.crates = STATION.crates.map((c) => { const w = toWorld(st, c.x, c.z); const o = { nt: 'crate', type: 'crate', x: w.x, z: w.z, y: st.h + 0.1, ry: st.ry + c.ry, station: st }; crates.push(o); return o; });
    for (const [lx, lz, r] of stationSolids()) { const w = toWorld(st, lx, lz); solids.push({ nt: 'solid', x: w.x, z: w.z, y: st.h, cr: r }); }
  }

  // --- где живут животные: точки по биомам (первые count — начальные, остальные — запас для возрождения)
  const animalSpawns = {};
  for (const [type, S] of Object.entries(ANIMALS)) {
    const pts = [], want = S.count * 4;
    for (let i = 0; i < 30000 && pts.length < want; i++) {
      const x = rx(), z = rx();
      if (!S.habitat.includes(T.biomeAt(x, z)) || T.heightAt(x, z) < 1.6 || T.roadDist(x, z) < 8) continue;
      if (Math.hypot(x - spawn.x, z - spawn.z) < 70 || T.inStation(x, z, 10) || !free(x, z, 1.2)) continue;
      if (pts.some((q) => Math.hypot(q.x - x, q.z - z) < 14)) continue;
      pts.push({ x, z });
    }
    animalSpawns[type] = pts;
  }
  return { terrain: T, spawn, objects, stations, crates, solids, animalSpawns };
}
