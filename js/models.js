// Модели: деревья из OBJ-пака (trees.js), остальное — процедурно из примитивов three.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREES } from './trees.js';

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
  return g;
}
