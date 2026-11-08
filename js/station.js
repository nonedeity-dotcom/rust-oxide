// Заправка («РТ») у кольцевой дороги: одна раскладка и для генерации мира (площадка, коллизии, ящики), и для 3D-модели.
// Локальные координаты: +Z — фасад к дороге, +X — вправо, Y — вверх. Мировая позиция: центр площадки (x, z) и поворот ry.
export const STATION = {
  count: 4,
  offset: 15.5,                                   // от оси дороги до центра площадки, м
  flat: 19, blend: 32,                            // радиус ровной площадки и плавного перехода в рельеф, м
  slab: { x0: -12, x1: 12, z0: -10, z1: 12 },       // бетонная площадка (фасад в ~1 м от края дороги)
  shop: { x: 0, z: -6, w: 14, d: 6, h: 3.4 },     // магазин
  canopy: { x: 0, z: 3.2, w: 13, d: 7.4, y: 4.6 },// навес над колонками
  pillars: [[-5.6, 0.4], [5.6, 0.4], [-5.6, 6.0], [5.6, 6.0]],
  pumps: [[-2.4, 2.4], [-2.4, 4.0], [2.4, 2.4], [2.4, 4.0]],
  sign: { x: 9.5, z: 9.5, h: 7 },                 // столб с вывеской
  crates: [{ x: -6.2, z: -1.8, ry: 0 }, { x: 9.2, z: -5.6, ry: Math.PI / 2 }], // ящики с лутом
};

// круглые коллизии в локальных координатах: [x, z, радиус]
export function stationSolids() {
  const S = STATION, out = [];
  for (let i = -2; i <= 2; i++) out.push([S.shop.x + i * 2.5, S.shop.z, 2.6]); // магазин — ряд кругов
  for (const [x, z] of S.pillars) out.push([x, z, 0.35]);
  for (const [x, z] of S.pumps) out.push([x, z, 0.55]);
  out.push([S.sign.x, S.sign.z, 0.3]);
  return out;
}

export const toWorld = (st, lx, lz) => {
  const c = Math.cos(st.ry), s = Math.sin(st.ry);
  return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c };
};
export const toLocal = (st, wx, wz) => {
  const c = Math.cos(st.ry), s = Math.sin(st.ry), dx = wx - st.x, dz = wz - st.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};
// точка внутри бетонной площадки (с запасом m метров)?
export function inStation(st, wx, wz, m = 0) {
  const l = toLocal(st, wx, wz), a = STATION.slab;
  return l.x > a.x0 - m && l.x < a.x1 + m && l.z > a.z0 - m && l.z < a.z1 + m;
}
