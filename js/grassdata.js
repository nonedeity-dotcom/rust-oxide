// Расстановка травы по чанкам — чистые данные без three.js (проверяется тестами в Node).
import { ROAD_WIDTH, BEACH_HEIGHT } from './terrain.js';

export const CHUNK = 16; // сторона чанка, м

function hash(a, b, c) {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const BASE = { forest: [0.16, 0.32, 0.11], desert: [0.5, 0.42, 0.2] };
const TIP = { forest: [0.52, 0.78, 0.28], desert: [0.85, 0.74, 0.44] };

// Трава растёт в лесу и (редко, сухая) в пустыне. Не на воде, пляже, дороге и снегу.
// Каждый пучок — 3 лезвия-треугольника. Возвращает массивы для BufferGeometry.
export function buildChunkData(T, cx, cz, density) {
  const total = Math.round(CHUNK * CHUNK * density);
  const pos = [], root = [], sway = [], col = [];
  let tufts = 0;
  for (let i = 0; i < total; i++) {
    const x = (cx + hash(cx, cz, i * 5)) * CHUNK, z = (cz + hash(cx, cz, i * 5 + 1)) * CHUNK;
    const h = T.heightAt(x, z);
    if (h < BEACH_HEIGHT + 0.1 || T.roadDist(x, z) < ROAD_WIDTH / 2 + 0.4) continue;
    if (T.inStation?.(x, z, 0.6)) continue; // на бетоне заправки травы нет
    const biome = T.biomeAt(x, z);
    if (biome !== 'forest' && biome !== 'desert') continue;
    if (biome === 'desert' && hash(cx, cz, i * 5 + 2) > 0.22) continue;
    const size = (biome === 'desert' ? 0.7 : 1) * (0.7 + hash(cx, cz, i * 5 + 3) * 0.7);
    const tone = 0.8 + hash(cx, cz, i * 5 + 4) * 0.4, b = BASE[biome], t = TIP[biome];
    tufts++;
    for (let k = 0; k < 3; k++) {
      const a = hash(cx + k, cz, i * 7 + 11) * Math.PI * 2, la = hash(cx, cz + k, i * 7 + 12) * Math.PI * 2;
      const ox = (hash(cx + k, cz + 5, i * 7 + 13) - 0.5) * 0.28, oz = (hash(cx + 5, cz + k, i * 7 + 14) - 0.5) * 0.28;
      const bx = x + ox, bz = z + oz, w = 0.06 + hash(cx, cz, i * 7 + k) * 0.05;
      const hh = (0.35 + hash(cx + k, cz + k, i * 7 + 15) * 0.4) * size, lean = hh * 0.35;
      const gy = T.heightAt(bx, bz) - 0.05;
      const wx = Math.cos(a) * w, wz = Math.sin(a) * w;
      pos.push(bx - wx, gy, bz - wz, bx + wx, gy, bz + wz, bx + Math.cos(la) * lean, gy + hh, bz + Math.sin(la) * lean);
      for (let v = 0; v < 3; v++) root.push(bx, gy, bz);
      sway.push(0, 0, 1);
      col.push(b[0] * tone, b[1] * tone, b[2] * tone, b[0] * tone, b[1] * tone, b[2] * tone, t[0] * tone, t[1] * tone, t[2] * tone);
    }
  }
  return { tufts, pos, root, sway, col };
}
