// Карта острова: рельеф сэмплируется один раз (без three.js, проверяется тестами), потом рисуется на canvas.
import { ROAD_WIDTH } from './terrain.js';

export const MAP_EXT = 300; // карта охватывает квадрат [-300, 300] м
const COLORS = { water: [38, 92, 140], shallow: [64, 130, 170], beach: [230, 215, 158], forest: [79, 138, 58], desert: [220, 181, 108], winter: [236, 242, 248], road: [92, 92, 96] };

// возвращает { n, data: Uint8ClampedArray RGBA }
export function sampleMap(T, n = 200) {
  const data = new Uint8ClampedArray(n * n * 4), step = (MAP_EXT * 2) / n;
  const hs = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = T.heightAt(-MAP_EXT + (i + 0.5) * step, -MAP_EXT + (j + 0.5) * step);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -MAP_EXT + (i + 0.5) * step, z = -MAP_EXT + (j + 0.5) * step, h = hs[j * n + i];
    let c;
    if (h < 0.1) c = h > -1.6 ? COLORS.shallow : COLORS.water;
    else c = COLORS[T.biomeAt(x, z)] || COLORS.beach;
    if (h >= 0.1 && T.roadDist(x, z) < ROAD_WIDTH * 0.9) c = COLORS.road;
    // лёгкая светотень по склону: свет с северо-запада
    const hx = hs[j * n + Math.min(n - 1, i + 1)] - hs[j * n + Math.max(0, i - 1)], hz = hs[Math.min(n - 1, j + 1) * n + i] - hs[Math.max(0, j - 1) * n + i];
    const sh = h < 0.1 ? 1 : Math.max(0.7, Math.min(1.25, 1 - (hx + hz) * 0.05));
    const o = (j * n + i) * 4;
    data[o] = c[0] * sh; data[o + 1] = c[1] * sh; data[o + 2] = c[2] * sh; data[o + 3] = 255;
  }
  return { n, data };
}

let cache = null;
export function drawMap(canvas, world, P) {
  const S = canvas.width, g = canvas.getContext('2d');
  if (!cache) {
    const { n, data } = sampleMap(world.T);
    const off = document.createElement('canvas'); off.width = off.height = n;
    off.getContext('2d').putImageData(new ImageData(data, n, n), 0, 0); cache = off;
  }
  g.imageSmoothingEnabled = true; g.drawImage(cache, 0, 0, S, S);
  const px = (x) => ((x + MAP_EXT) / (MAP_EXT * 2)) * S;
  // сетка через каждые 100 м
  g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 1;
  for (let m = -200; m <= 200; m += 100) { g.beginPath(); g.moveTo(px(m), 0); g.lineTo(px(m), S); g.moveTo(0, px(m)); g.lineTo(S, px(m)); g.stroke(); }
  // печи игрока
  g.fillStyle = '#f0b45a'; g.strokeStyle = '#000'; g.lineWidth = 2;
  for (const f of world.furnaces) { g.beginPath(); g.rect(px(f.x) - 5, px(f.z) - 5, 10, 10); g.fill(); g.stroke(); }
  // заправки и спальный мешок: значки с обводкой
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '14px sans-serif'; g.strokeStyle = '#000'; g.lineWidth = 2;
  for (const st of world.stations || []) { g.fillStyle = '#f2b632'; g.beginPath(); g.arc(px(st.x), px(st.z), 10, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = '#000'; g.fillText('⛽', px(st.x), px(st.z) + 1); }
  if (world.bag) { g.fillStyle = '#7fb0ff'; g.beginPath(); g.arc(px(world.bag.x), px(world.bag.z), 9, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = '#000'; g.fillText('🛏️', px(world.bag.x), px(world.bag.z) + 1); }
  g.textBaseline = 'alphabetic';
  // игрок: стрелка по направлению взгляда (вперёд = (-sin yaw, -cos yaw), север сверху)
  const x = px(P.pos.x), y = px(P.pos.z), a = Math.atan2(-Math.cos(P.yaw), -Math.sin(P.yaw));
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = '#ff4b3a'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(11, 0); g.lineTo(-8, -7); g.lineTo(-4, 0); g.lineTo(-8, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  // север и масштаб
  g.fillStyle = '#fff'; g.font = '700 16px sans-serif'; g.textAlign = 'center'; g.shadowColor = '#000'; g.shadowBlur = 4;
  g.fillText('С', S / 2, 18);
  g.textAlign = 'left'; g.fillText('сетка 100 м', 8, S - 8); g.shadowBlur = 0;
}
export const resetMapCache = () => { cache = null; };
