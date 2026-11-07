// 3D-мир: рельеф, вода, дорога, объекты (instancing), добыча, коллизии, небо и смена дня/ночи.
import * as THREE from 'three';
import { CONFIG, NODES, BARREL_LOOT, ITEMS, NEED_TOOL, harvestAmount, Furnace } from './data.js';
import { generateWorld, ROAD_WIDTH } from './terrain.js';
import { buildGeometries, TREE_MATERIAL, NODE_MATERIAL, makeFurnaceModel } from './models.js';

const CELL = 8;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// форма объекта: [радиус коллизии, радиус зоны удара, высота зоны удара] (умножаются на scale)
const SHAPE = { tree: [0.45, 0.9, 3.5], stone: [1.1, 1.3, 1.4], iron: [1.1, 1.3, 1.4], sulfur: [1.0, 1.25, 1.4], barrel: [0.55, 0.7, 1.1] };
const TREE_TYPES = new Set(['oak', 'apple', 'birch', 'autumn', 'palm', 'pine', 'snowpine']);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.data = generateWorld(1337);
    this.T = this.data.terrain; this.spawn = this.data.spawn;
    this.time = 0; this.tod = 0.38; this.night = 0;
    this.grid = new Map(); this.depleted = []; this.pulsing = new Map(); this.furnaces = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._sd = new THREE.Vector3();
    this._buildSky(); this._buildTerrain(); this._buildWater(); this._buildRoad(); this._buildObjects();
    this.setTimeOfDay(this.tod);
  }
  groundHeight(x, z) { return this.T.heightAt(x, z); }

  // ---------- небо / свет ----------
  _buildSky() {
    const sc = this.scene;
    sc.background = new THREE.Color(); sc.fog = new THREE.Fog(0xffffff, 50, 240);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4036, 0.8); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2); sc.add(this.sun, this.sun.target);
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
    sc.add(this.sunMesh);
    const n = 500, pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, b = Math.acos(Math.random() * 0.95), r = 480; pts.set([Math.sin(b) * Math.cos(a) * r, Math.cos(b) * r, Math.sin(b) * Math.sin(a) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; sc.add(this.stars);
    this._white = new THREE.Color(0xffffff); this._night = new THREE.Color(0x070b1c); this._day = new THREE.Color(0x86c5f0); this._dusk = new THREE.Color(0xff8f5a);
  }
  setTimeOfDay(tod) {
    const a = (tod - 0.25) * Math.PI * 2, sh = Math.sin(a); // 0.5 — полдень
    this._sd.set(Math.cos(a), sh, 0.35).normalize();
    const day = smooth(-0.12, 0.3, sh), dusk = Math.max(0, 1 - Math.abs(sh) / 0.3);
    const sky = this.scene.background.copy(this._night).lerp(this._day, day).lerp(this._dusk, dusk * 0.55);
    this.scene.fog.color.copy(sky);
    this.hemi.intensity = 0.28 + 0.6 * day; this.sun.intensity = 1.3 * day;
    this.sun.color.setHex(0xffb070).lerp(this._white, day);
    this.stars.material.opacity = 1 - day; this.night = 1 - day;
  }

  // ---------- рельеф ----------
  _buildTerrain() {
    const T = this.T, geo = new THREE.PlaneGeometry(CONFIG.worldSize, CONFIG.worldSize, 256, 256);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const palette = { forest: [0x4f8a3a, 0x3d7230], desert: [0xdcb56c, 0xcba35a], winter: [0xf0f4f8, 0xdbe5ee], beach: [0xe6d79e, 0xd9c98a], water: [0xa89c72, 0x8a8060] };
    const c1 = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = T.heightAt(x, z);
      pos.setY(i, h);
      const p = palette[T.biomeAt(x, z)], n = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      c1.setHex(p[0]); c2.setHex(p[1]); c1.lerp(c2, Math.abs(n));
      const sh = 0.9 + 0.1 * smooth(0, 16, h);
      col.set([c1.r * sh, c1.g * sh, c1.b * sh], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }
  _buildWater() {
    const geo = new THREE.PlaneGeometry(CONFIG.worldSize * 4, CONFIG.worldSize * 4); geo.rotateX(-Math.PI / 2);
    const w = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x2f78b0, transparent: true, opacity: 0.82 }));
    w.position.y = 0; this.water = w; this.scene.add(w);
  }
  _buildRoad() { // кольцевая дорога — полоса, лежащая на рельефе
    const N = 480, pos = [], idx = [], T = this.T, hw = ROAD_WIDTH / 2;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), r = T.roadR(a);
      for (const k of [-hw, hw]) { const x = c * (r + k), z = s * (r + k); pos.push(x, T.heightAt(x, z) + 0.12, z); }
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8d7b5c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  }

  // ---------- объекты ----------
  _buildObjects() {
    const geos = buildGeometries(), by = {};
    for (const o of this.data.objects) (by[o.type] ||= []).push(o);
    for (const [type, list] of Object.entries(by)) {
      const mesh = new THREE.InstancedMesh(geos[type], TREE_TYPES.has(type) ? TREE_MATERIAL : NODE_MATERIAL, list.length);
      mesh.frustumCulled = false;
      list.forEach((o, i) => { o.mesh = mesh; o.idx = i; this._init(o); this._setMat(o, 1); this._register(o); });
      this.scene.add(mesh);
    }
  }
  _init(o) {
    const [cr, pr, ph] = SHAPE[o.nt];
    o.cr = cr * (o.nt === 'tree' ? 1 : o.s); o.pr = pr * (o.nt === 'tree' ? 1 : o.s); o.ph = ph * o.s;
    o.pool = NODES[o.nt].pool; o.hp = NODES[o.nt].hits; o.dead = false;
  }
  _setMat(o, k) {
    this._q.setFromAxisAngle(this._up, o.ry);
    this._m.compose(this._p.set(o.x, o.y - 0.08, o.z), this._q, this._s.setScalar(o.s * k));
    o.mesh.setMatrixAt(o.idx, this._m); o.mesh.instanceMatrix.needsUpdate = true;
  }
  _cell(x, z) { return Math.floor(x / CELL) * 10007 + Math.floor(z / CELL); }
  _register(o) { const k = this._cell(o.x, o.z); (this.grid.get(k) || this.grid.set(k, []).get(k)).push(o); }
  _near(x, z, fn) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = this.grid.get((cx + i) * 10007 + cz + j); if (l) for (const o of l) { const r = fn(o); if (r) return r; } }
    return null;
  }

  collide(p, r) { // выталкивает точку p из объектов
    this._near(p.x, p.z, (o) => {
      if (o.dead) return;
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = r + o.cr;
      if (d < m && d > 1e-4) { p.x = o.x + (dx / d) * m; p.z = o.z + (dz / d) * m; }
    });
  }
  pick(origin, dir, reach) { // луч шагами: попадание в «цилиндр» объекта
    for (let s = 0.3; s <= reach + 0.5; s += 0.2) {
      const px = origin.x + dir.x * s, py = origin.y + dir.y * s, pz = origin.z + dir.z * s;
      const o = this._near(px, pz, (o) => !o.dead && Math.hypot(px - o.x, pz - o.z) < o.pr && py > o.y - 0.2 && py < o.y + o.ph ? o : null);
      if (o) return o;
    }
    return null;
  }
  canPlace(x, z) { return this.groundHeight(x, z) > 0.5 && !this._near(x, z, (o) => !o.dead && Math.hypot(o.x - x, o.z - z) < o.cr + 1.1); }
  addFurnace(x, z, ry) {
    const o = { nt: 'furnace', type: 'furnace', x, z, y: this.groundHeight(x, z), s: 1, ry, cr: 0.95, pr: 1, ph: 1.6, furnace: new Furnace(), dead: false, group: makeFurnaceModel() };
    o.group.position.set(x, o.y, z); o.group.rotation.y = ry; this.scene.add(o.group);
    this._register(o); this.furnaces.push(o); return o;
  }

  // ---------- добыча ----------
  harvest(o, tool, inv) {
    this.pulsing.set(o, 0.25);
    if (o.nt === 'barrel') {
      if (--o.hp > 0) return { msg: `Бочка: ещё ${o.hp} уд.` };
      const m = rint(...BARREL_LOOT.metal); let msg = `+${m} ${ITEMS.metal.name}`;
      inv.add('metal', m);
      if (Math.random() < BARREL_LOOT.woodChance) { const w = rint(...BARREL_LOOT.wood); inv.add('wood', w); msg += `, +${w} ${ITEMS.wood.name}`; }
      this._deplete(o); return { msg, ok: true };
    }
    const y = harvestAmount(tool, o.nt);
    if (!y) return { msg: NEED_TOOL[o.nt] || 'Нужен инструмент' };
    const drop = NODES[o.nt].drop, n = Math.min(y, o.pool), left = inv.add(drop, n), got = n - left;
    o.pool -= got;
    if (o.pool <= 0) this._deplete(o);
    return { msg: left > 0 ? 'Инвентарь полон' : `+${got} ${ITEMS[drop].name}`, ok: got > 0 };
  }
  _deplete(o) {
    o.dead = true; o.respawnAt = this.time + NODES[o.nt].respawn; this.depleted.push(o);
    this.pulsing.delete(o); this._setMat(o, 0);
  }

  update(dt, pp) {
    this.time += dt; this.tod = (this.tod + dt / CONFIG.dayLength) % 1; this.setTimeOfDay(this.tod);
    this.sun.position.copy(pp).addScaledVector(this._sd, 200); this.sun.target.position.copy(pp);
    this.sunMesh.position.copy(pp).addScaledVector(this._sd, 420); this.stars.position.copy(pp);
    for (const f of this.furnaces) { f.furnace.update(dt); f.group.userData.flame.visible = f.furnace.active; }
    for (const [o, t] of this.pulsing) {
      const n = t - dt;
      if (n <= 0) { this.pulsing.delete(o); if (!o.dead) this._setMat(o, 1); } else { this.pulsing.set(o, n); this._setMat(o, 1 + 0.1 * Math.sin(n * 50) * (n / 0.25)); }
    }
    for (let i = this.depleted.length - 1; i >= 0; i--) {
      const o = this.depleted[i];
      if (this.time >= o.respawnAt) { this._init(o); this._setMat(o, 1); this.depleted.splice(i, 1); }
    }
  }
}
