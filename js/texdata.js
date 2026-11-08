// Процедурная «детальная» текстура 256×256 без файлов (бесшовная, проверяется тестами в Node).
// Каналы: R — мелкое зерно, G — ячейки/трещины (0 на границах ячеек), B — крупные пятна.
export const DETAIL_SIZE = 256;

function hash(ix, iy, s) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const wrap = (i, p) => ((i % p) + p) % p;
// бесшовный value-noise: решётка period×period замыкается сама на себя
function vnoise(u, v, period, seed) {
  const x = u * period, y = v * period, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(wrap(x0, period), wrap(y0, period), seed), b = hash(wrap(x0 + 1, period), wrap(y0, period), seed);
  const c = hash(wrap(x0, period), wrap(y0 + 1, period), seed), d = hash(wrap(x0 + 1, period), wrap(y0 + 1, period), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// бесшовный Worley: возвращает F2 − F1 (0 на границах ячеек)
function worleyEdge(u, v, G, seed) {
  const gx = u * G, gy = v * G, cx = Math.floor(gx), cy = Math.floor(gy);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const ix = cx + i, iy = cy + j, wx = wrap(ix, G), wy = wrap(iy, G);
    const px = ix + hash(wx, wy, seed), py = iy + hash(wx, wy, seed + 1);
    const d = Math.hypot(gx - px, gy - py);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}

export function makeDetailData(N = DETAIL_SIZE) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, o = (y * N + x) * 4;
    const r = vnoise(u, v, 32, 1) * 0.5 + vnoise(u, v, 64, 2) * 0.3 + vnoise(u, v, 128, 3) * 0.2;
    const g = Math.min(1, worleyEdge(u, v, 10, 7) * 2.6);
    const b = vnoise(u, v, 4, 11) * 0.6 + vnoise(u, v, 8, 12) * 0.4;
    data[o] = Math.round(r * 255); data[o + 1] = Math.round(g * 255); data[o + 2] = Math.round(b * 255); data[o + 3] = 255;
  }
  return data;
}
