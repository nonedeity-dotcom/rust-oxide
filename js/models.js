// Модели: деревья из OBJ-пака (trees.js), остальное — процедурно из примитивов three.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREES } from './trees.js';
import { ANIMAL_MODELS } from './animals.js';
import { ANIMALS } from './data.js';
import { STATION } from './station.js';

const V3 = THREE.Vector3, _c = new THREE.Color();
export const TREE_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
export const NODE_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

function paint(geo, hex) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  _c.setHex(hex);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function treeGeo(d) {
  const col = new Float32Array(d.tri.length * 9);
  d.tri.forEach((p, t) => { _c.setHex(d.pal[p]); for (let k = 0; k < 3; k++) col.set([_c.r, _c.g, _c.b], (t * 3 + k) * 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals(); // вершины не общие -> плоское low-poly освещение
  return g;
}
const hash3 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
// неровные грани камней: общие вершины смещаются одинаково
function rough(geo, amt) {
  const p = geo.attributes.position, k = (a) => Math.round(a * 50) / 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + (hash3(k(x), k(y), k(z)) - 0.5) * amt, y + (hash3(k(y), k(z), k(x)) - 0.5) * amt, z + (hash3(k(z), k(x), k(y)) - 0.5) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}
function part(geo, hex, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(new THREE.Matrix4().compose(new V3(o.x || 0, o.y || 0, o.z || 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)), new V3(o.sx || 1, o.sy || 1, o.sz || 1)));
  return paint(g, hex);
}
const merge = (parts) => mergeGeometries(parts, false);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export function buildGeometries() {
  const g = {};
  for (const k of Object.keys(TREES)) g[k] = treeGeo(TREES[k]);
  g.stone = merge([part(rough(ico(1.3), 0.5), 0x8a8d90, { y: 0.7, sy: 0.75 }), part(rough(ico(0.8), 0.4), 0x9a9da0, { x: 1.2, z: 0.4, y: 0.35, sy: 0.8 })]);
  g.iron = merge([part(rough(ico(1.3), 0.5), 0x6b625c, { y: 0.7, sy: 0.75 }),
    part(rough(ico(0.4, 0), 0.15), 0xc0702a, { x: 0.5, y: 1.0, z: 0.5 }), part(rough(ico(0.35, 0), 0.15), 0xb5651d, { x: -0.6, y: 0.8, z: 0.6 }),
    part(rough(ico(0.3, 0), 0.1), 0xd98a3a, { x: 0.1, y: 1.15, z: -0.6 })]);
  g.sulfur = merge([part(rough(ico(1.2), 0.5), 0x8f8a78, { y: 0.65, sy: 0.75 }),
    part(cone(0.22, 0.8, 5), 0xf0dc32, { x: 0.4, y: 1.2, z: 0.3, rz: 0.2 }), part(cone(0.18, 0.6, 5), 0xe8d12a, { x: -0.5, y: 1.0, z: 0.4, rz: -0.3 }),
    part(cone(0.2, 0.7, 5), 0xf5e44a, { y: 1.15, z: -0.5 })]);
  g.barrel = merge([part(cyl(0.5, 0.5, 1, 10), 0x9c3b2a, { y: 0.5 }), part(cyl(0.53, 0.53, 0.08, 10), 0x2b2b2b, { y: 0.2 }),
    part(cyl(0.53, 0.53, 0.08, 10), 0x2b2b2b, { y: 0.8 }), part(cyl(0.46, 0.46, 0.04, 10), 0x6e2a20, { y: 1.02 })]);
  return g;
}

export function makeFurnaceModel() {
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(merge([part(box(1.5, 1.2, 1.3), 0x7c7f83, { y: 0.6 }), part(box(1.1, 0.7, 0.2), 0x1b1b1d, { y: 0.55, z: 0.62 }),
    part(box(1.6, 0.15, 1.4), 0x5e6064, { y: 1.25 }), part(cyl(0.2, 0.25, 0.9, 6), 0x55575a, { x: 0.4, y: 1.7, z: -0.3 })]), NODE_MATERIAL));
  const flame = new THREE.Mesh(cone(0.25, 0.5, 5), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
  flame.position.set(0, 0.5, 0.55); flame.visible = false; grp.add(flame);
  grp.userData.flame = flame;
  return grp;
}

// ---------- животные ----------
export const ANIMAL_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
export const ANIMAL_HURT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x7a1510 }); // вспышка при ударе
// cy — высота центра тела (вокруг неё туша заваливается на бок), lift — на сколько центр приподнят над землёй у лежащей туши
export const ANIMAL_VIS = { bear: { cy: 0.95, lift: 0.44 }, deer: { cy: 0.75, lift: 0.24 }, boar: { cy: 0.55, lift: 0.28 } };
export const LEG_PHASE = [0, Math.PI, Math.PI, 0]; // ПЛ, ПП, ЗЛ, ЗП: пары по диагонали шагают вместе

function partGeo(p, pal) { // индексированные данные -> плоское low-poly освещение (вершины не общие)
  const n = p.f.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = p.f[i] * 3; pos[i * 3] = p.v[v]; pos[i * 3 + 1] = p.v[v + 1]; pos[i * 3 + 2] = p.v[v + 2]; }
  for (let t = 0; t < n / 3; t++) { _c.setHex(pal[p.c[t]]); for (let k = 0; k < 3; k++) col.set([_c.r, _c.g, _c.b], (t * 3 + k) * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const animalGeo = {};
// Модель животного: root (позиция и поворот) → inner (масштаб) → тело + 4 ноги, каждая со своей точкой-бедром.
export function makeAnimalModel(type) {
  const M = ANIMAL_MODELS[type], G = animalGeo[type] || (animalGeo[type] = { body: partGeo(M.body, M.pal), legs: M.legs.map((l) => partGeo(l, M.pal)) });
  const root = new THREE.Group(), inner = new THREE.Group();
  root.rotation.order = 'YXZ'; inner.scale.setScalar(ANIMALS[type].scale); root.add(inner);
  const body = new THREE.Mesh(G.body, ANIMAL_MATERIAL); inner.add(body);
  const legs = M.legs.map((l, i) => { const m = new THREE.Mesh(G.legs[i], ANIMAL_MATERIAL); m.position.set(...l.pivot); inner.add(m); return m; });
  const meshes = [body, ...legs]; for (const m of meshes) m.castShadow = true;
  root.userData = { inner, body, legs, meshes, hurt: false };
  return root;
}

// ---------- ящик (лут на заправках) ----------
export function makeCrateModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(merge([part(box(1.1, 0.6, 0.8), 0x6b7a42, { y: 0.3 }), part(box(0.1, 0.62, 0.82), 0x3a3f26, { x: -0.4, y: 0.3 }), part(box(0.1, 0.62, 0.82), 0x3a3f26, { x: 0.4, y: 0.3 }),
    part(box(0.16, 0.14, 0.05), 0xc4c4be, { y: 0.52, z: 0.41 })]), NODE_MATERIAL));
  const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.4); // петли по задней кромке
  lid.add(new THREE.Mesh(merge([part(box(1.14, 0.12, 0.84), 0x5c6a38, { y: 0.06, z: 0.4 }), part(box(0.1, 0.13, 0.86), 0x3a3f26, { x: -0.4, y: 0.06, z: 0.4 }), part(box(0.1, 0.13, 0.86), 0x3a3f26, { x: 0.4, y: 0.06, z: 0.4 })]), NODE_MATERIAL));
  g.add(lid); g.userData.lid = lid;
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

// ---------- спальный мешок (поставленный) ----------
export function makeBagModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(merge([part(box(0.85, 0.14, 1.9), 0x4f6b9a, { y: 0.07 }), part(box(0.86, 0.15, 0.08), 0x2f4268, { y: 0.07, z: 0.2 }), part(box(0.86, 0.15, 0.08), 0x2f4268, { y: 0.07, z: -0.35 }),
    part(box(0.6, 0.1, 0.38), 0xe9e2d2, { y: 0.17, z: -0.7 })]), NODE_MATERIAL));
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}

// ---------- заправка ----------
function labelTexture(text, bg, fg) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d'); c.fillStyle = bg; c.fillRect(0, 0, 512, 128);
  c.strokeStyle = fg; c.lineWidth = 8; c.strokeRect(6, 6, 500, 116);
  c.fillStyle = fg; c.font = '700 70px "Trebuchet MS", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function makeStationModel() {
  const S = STATION, sl = S.slab, sh = S.shop, c = S.canopy, Y0 = 0.1, P = []; // Y0 — верх бетона (дорога лежит на 0.12, но выигрывает по polygonOffset)
  P.push(part(box(sl.x1 - sl.x0, 0.6, sl.z1 - sl.z0), 0x9b9b96, { x: (sl.x0 + sl.x1) / 2, y: Y0 - 0.3, z: (sl.z0 + sl.z1) / 2 }));
  P.push(part(box(sl.x1 - sl.x0 - 1, 0.02, 0.18), 0xe6c42a, { y: Y0 + 0.01, z: sl.z1 - 0.7 })); // жёлтая разметка у дороги
  // магазин: стены, красная полоса, крыша, дверь и окна на фасаде (+Z)
  const fz = sh.z + sh.d / 2;
  P.push(part(box(sh.w, sh.h, sh.d), 0xd9d2c0, { x: sh.x, y: Y0 + sh.h / 2, z: sh.z }));
  P.push(part(box(sh.w + 0.1, 0.55, sh.d + 0.1), 0xb5342a, { x: sh.x, y: Y0 + sh.h - 0.7, z: sh.z }));
  P.push(part(box(sh.w + 0.7, 0.3, sh.d + 0.7), 0x4a4a4e, { x: sh.x, y: Y0 + sh.h + 0.15, z: sh.z }));
  P.push(part(box(1.7, 2.3, 0.14), 0x2d3a46, { x: -2.2, y: Y0 + 1.15, z: fz + 0.03 }));
  P.push(part(box(4.2, 1.3, 0.14), 0x7fb2d0, { x: 2.8, y: Y0 + 1.7, z: fz + 0.03 }));
  P.push(part(box(2.0, 1.3, 0.14), 0x7fb2d0, { x: -5.3, y: Y0 + 1.7, z: fz + 0.03 }));
  P.push(part(box(1.2, 0.8, 0.9), 0x8a8d90, { x: 4.5, y: Y0 + sh.h + 0.7, z: sh.z - 1 })); // кондиционер на крыше
  // навес и колонны
  P.push(part(box(c.w, 0.45, c.d), 0xe8e8e4, { x: c.x, y: Y0 + c.y, z: c.z }));
  P.push(part(box(c.w + 0.1, 0.62, 0.35), 0xb5342a, { x: c.x, y: Y0 + c.y, z: c.z + c.d / 2 }));
  for (const [x, z] of S.pillars) P.push(part(cyl(0.22, 0.22, c.y, 8), 0xdadad6, { x, y: Y0 + c.y / 2, z }));
  // острова и колонки
  for (const x of [-2.4, 2.4]) P.push(part(box(1.3, 0.22, 3.6), 0x777774, { x, y: Y0 + 0.11, z: 3.2 }));
  for (const [x, z] of S.pumps) {
    P.push(part(box(0.75, 1.5, 0.55), 0xc8362b, { x, y: Y0 + 0.97, z }));
    P.push(part(box(0.62, 0.34, 0.58), 0xf0f0ea, { x, y: Y0 + 1.37, z }));
    P.push(part(box(0.1, 0.5, 0.08), 0x222222, { x: x + 0.45, y: Y0 + 1.1, z }));
  }
  // столб с вывеской
  P.push(part(cyl(0.16, 0.2, S.sign.h, 8), 0x55575a, { x: S.sign.x, y: Y0 + S.sign.h / 2, z: S.sign.z }));
  P.push(part(box(2.8, 1.5, 0.3), 0xf2b632, { x: S.sign.x, y: Y0 + S.sign.h + 0.6, z: S.sign.z }));
  const grp = new THREE.Group(), body = new THREE.Mesh(merge(P), NODE_MATERIAL); body.castShadow = true; body.receiveShadow = true; grp.add(body);
  // надписи «ЗАПРАВКА»: на вывеске с двух сторон и на кромке навеса
  const signTex = labelTexture('ЗАПРАВКА', '#f2b632', '#1d1d1d'), bandTex = labelTexture('ЗАПРАВКА', '#b5342a', '#ffffff');
  const label = (tex, w, h, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(x, y, z); m.rotation.y = ry; grp.add(m); };
  label(signTex, 2.5, 0.625, S.sign.x, Y0 + S.sign.h + 0.6, S.sign.z + 0.16);
  label(signTex, 2.5, 0.625, S.sign.x, Y0 + S.sign.h + 0.6, S.sign.z - 0.16, Math.PI);
  label(bandTex, 6, 0.5, 0, Y0 + c.y, c.z + c.d / 2 + 0.19);
  return grp;
}

// Предметы в руке (вид от первого лица)
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
export function makeHeld(id) {
  const g = new THREE.Group();
  const add = (geo, m, p, r) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); if (r) o.rotation.set(...r); g.add(o); return o; };
  const handle = () => add(cyl(0.022, 0.028, 0.55, 6), mat(0x6b4a2b), [0, 0.1, 0]);
  if (id === 'rock') add(rough(ico(0.15), 0.06), mat(0x8a8d90), [0, 0.05, 0]);
  else if (id === 'torch') {
    add(cyl(0.025, 0.035, 0.5, 6), mat(0x6b4a2b), [0, 0.1, 0]);
    g.userData.flame = add(cone(0.075, 0.22, 6), new THREE.MeshBasicMaterial({ color: 0xffa030 }), [0, 0.46, 0]);
    g.userData.light = new THREE.PointLight(0xffa550, 1.6, 18, 1.5); g.userData.light.position.set(0, 0.55, 0); g.add(g.userData.light);
  } else if (id === 'stone_pickaxe') { handle(); add(box(0.4, 0.06, 0.06), mat(0x8a8d90), [0, 0.38, 0]); }
  else if (id === 'stone_axe') { handle(); add(box(0.16, 0.2, 0.05), mat(0x8a8d90), [0.08, 0.34, 0]); }
  else if (id === 'furnace') add(box(0.3, 0.25, 0.25), mat(0x7c7f83), [0, 0.1, 0]);
  else if (id === 'bone_knife') { add(cyl(0.02, 0.024, 0.14, 6), mat(0x6b4a2b), [0, 0.04, 0]); add(box(0.04, 0.3, 0.012), mat(0xe9e2cc), [0, 0.26, 0]); add(box(0.07, 0.02, 0.03), mat(0xcfc6aa), [0, 0.115, 0]); }
  else if (id === 'bone_club') { add(cyl(0.028, 0.045, 0.6, 6), mat(0xe3dcc5), [0, 0.12, 0]); add(rough(ico(0.085, 0), 0.03), mat(0xd8d0b6), [0, 0.46, 0]); add(cyl(0.032, 0.032, 0.12, 6), mat(0x6b4a2b), [0, -0.1, 0]); }
  else if (id === 'bone_armor') add(box(0.32, 0.08, 0.26), mat(0xe3dcc5), [0, 0.08, 0]);
  else if (id === 'sleeping_bag') add(cyl(0.09, 0.09, 0.45, 8), mat(0x4f6b9a), [0, 0.08, 0], [0, 0, Math.PI / 2]);
  return g;
}
