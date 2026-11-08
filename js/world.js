// 3D-мир: рельеф, вода, дорога, объекты (instancing), добыча, коллизии, небо и смена дня/ночи.
import * as THREE from 'three';
import { CONFIG, NODES, BARREL_LOOT, ITEMS, NEED_TOOL, ANIMALS, CRATE, harvestAmount, Furnace, weaponOf, rollCrateLoot, takeCrate, fmtItems } from './data.js';
import { generateWorld, ROAD_WIDTH } from './terrain.js';
import { buildGeometries, TREE_MATERIAL, NODE_MATERIAL, makeFurnaceModel, makeAnimalModel, makeCrateModel, makeBagModel, makeStationModel, ANIMAL_MATERIAL, ANIMAL_HURT, ANIMAL_VIS, LEG_PHASE } from './models.js';
import { Animal, pickSpawn } from './fauna.js';
import { Grass } from './grass.js';

const CELL = 8;
// Пресеты качества: pr — потолок pixelRatio, shadow — размер карты теней (0 — тени выключены), grassR — радиус травы в чанках по 16 м
export const QUALITY = [
  { name: 'Низкая',  pr: 1,   shadow: 0,    grassR: 1, density: 0.9 },
  { name: 'Средняя', pr: 1.5, shadow: 1024, grassR: 2, density: 1.4 },
  { name: 'Высокая', pr: 2,   shadow: 2048, grassR: 3, density: 2.0 },
];
const SHADOW_EXT = 55; // тень рисуется в квадрате ±55 м вокруг игрока
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// форма объекта: [радиус коллизии, радиус зоны удара, высота зоны удара] (умножаются на scale)
const SHAPE = { tree: [0.45, 0.9, 3.5], stone: [1.1, 1.3, 1.4], iron: [1.1, 1.3, 1.4], sulfur: [1.0, 1.25, 1.4], barrel: [0.55, 0.7, 1.1] };
const ANIMAL_FAR = 170; // дальше этого расстояния от игрока животные не симулируются
const TREE_TYPES = new Set(['oak', 'apple', 'birch', 'autumn', 'palm', 'pine', 'snowpine']);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.data = generateWorld(1337);
    this.T = this.data.terrain; this.spawn = this.data.spawn;
    this.time = 0; this.tod = 0.38; this.night = 0;
    this.grid = new Map(); this.depleted = []; this.pulsing = new Map(); this.furnaces = [];
    this.animals = []; this.crates = []; this.stations = this.data.stations; this.bag = null; this.onEvent = null;
    this._m = new THREE.Matrix4(); this._qt = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._sd = new THREE.Vector3();
    this.shadowSize = 0; this._q = -1;
    this._buildSky(); this._buildTerrain(); this._buildWater(); this._buildRoad(); this._buildObjects(); this._buildStations(); this._buildAnimals();
    this.grass = new Grass(scene, this.T);
    this.setTimeOfDay(this.tod);
  }
  groundHeight(x, z) { return this.T.heightAt(x, z); }
  // применяет пресет качества (тени, трава); дёшево, если ничего не поменялось
  setQuality(q) {
    if (q === this._q) return; this._q = q;
    const Q = QUALITY[q]; this.shadowSize = Q.shadow;
    const sh = this.sun.shadow;
    if (Q.shadow && sh.mapSize.x !== Q.shadow) { sh.mapSize.set(Q.shadow, Q.shadow); sh.map?.dispose(); sh.map = null; }
    this.grass.setQuality(Q.grassR, Q.density);
  }

  // ---------- небо / свет ----------
  _buildSky() {
    const sc = this.scene;
    sc.background = new THREE.Color(); sc.fog = new THREE.Fog(0xffffff, 50, 240);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4036, 0.8); sc.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2); sc.add(this.sun, this.sun.target);
    const sc2 = this.sun.shadow.camera; sc2.left = sc2.bottom = -SHADOW_EXT; sc2.right = sc2.top = SHADOW_EXT; sc2.near = 40; sc2.far = 380; sc2.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.3;
    // купол неба: у горизонта цвет тумана (дальние объекты сливаются с небом), выше — глубже; вокруг солнца — свечение
    this.skyU = { uHor: { value: new THREE.Color() }, uZen: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0xffc080) }, uDay: { value: 1 } };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 14), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uHor, uZen, uSunCol, uSunDir; uniform float uDay;
        void main(){
          float t = pow(clamp(vDir.y, 0.0, 1.0), 0.5);
          vec3 c = mix(uHor, uZen, t);
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          c += uSunCol * (pow(s, 6.0) * 0.22 + pow(s, 80.0) * 0.5) * uDay;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    this.dome.renderOrder = -10; this.dome.frustumCulled = false; sc.add(this.dome);
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
    sc.add(this.sunMesh);
    const n = 500, pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, b = Math.acos(Math.random() * 0.95), r = 480; pts.set([Math.sin(b) * Math.cos(a) * r, Math.cos(b) * r, Math.sin(b) * Math.sin(a) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; sc.add(this.stars);
    this._white = new THREE.Color(0xffffff); this._night = new THREE.Color(0x070b1c); this._day = new THREE.Color(0x86c5f0); this._dusk = new THREE.Color(0xff8f5a);
    this._zN = new THREE.Color(0x02040c); this._zD = new THREE.Color(0x2c6cc0); this._zS = new THREE.Color(0x5a4a8a);
  }
  setTimeOfDay(tod) {
    const a = (tod - 0.25) * Math.PI * 2, sh = Math.sin(a); // 0.5 — полдень
    this._sd.set(Math.cos(a), sh, 0.35).normalize();
    const day = smooth(-0.12, 0.3, sh), dusk = Math.max(0, 1 - Math.abs(sh) / 0.3);
    const sky = this.scene.background.copy(this._night).lerp(this._day, day).lerp(this._dusk, dusk * 0.55);
    this.scene.fog.color.copy(sky);
    this.hemi.intensity = 0.26 + 0.52 * day; this.sun.intensity = 1.55 * day;
    this.skyU.uHor.value.copy(sky); this.skyU.uZen.value.copy(this._zN).lerp(this._zD, day).lerp(this._zS, dusk * 0.4);
    this.skyU.uSunDir.value.copy(this._sd); this.skyU.uSunCol.value.setHex(0xffb070).lerp(this._white, day * 0.6); this.skyU.uDay.value = Math.max(0, Math.min(1, sh * 3 + 0.4));
    this._shadowsOn = day > 0.04;
    this.sun.color.setHex(0xffb070).lerp(this._white, day);
    this.stars.material.opacity = 1 - day; this.night = 1 - day;
  }

  // ---------- рельеф ----------
  _buildTerrain() {
    const T = this.T, geo = new THREE.PlaneGeometry(CONFIG.worldSize, CONFIG.worldSize, 256, 256);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const palette = { forest: [0x4f8a3a, 0x3d7230], desert: [0xdcb56c, 0xcba35a], winter: [0xf0f4f8, 0xdbe5ee], beach: [0xe6d79e, 0xd9c98a], water: [0xa89c72, 0x8a8060] };
    const c1 = new THREE.Color(), c2 = new THREE.Color(), rock = new THREE.Color(0x7d766a), snowRock = new THREE.Color(0x9aa4ad), biomes = new Array(pos.count);
    const vn = (x, z) => { const a = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return a - Math.floor(a); };
    const soft = (x, z) => { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf); return vn(xi, zi) * (1 - u) * (1 - v) + vn(xi + 1, zi) * u * (1 - v) + vn(xi, zi + 1) * (1 - u) * v + vn(xi + 1, zi + 1) * u * v; };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = T.heightAt(x, z);
      pos.setY(i, h);
      const b = T.biomeAt(x, z); biomes[i] = b; const p = palette[b];
      // крупные пятна + мелкая крапчатость
      const patch = soft(x * 0.045, z * 0.045) * 0.6 + soft(x * 0.17, z * 0.17) * 0.4, fine = vn(x, z);
      c1.setHex(p[0]); c2.setHex(p[1]); c1.lerp(c2, Math.min(1, patch * 0.8 + fine * 0.2));
      const sh = (0.86 + 0.14 * smooth(0, 16, h)) * (0.94 + 0.12 * patch) * (b === 'beach' && h < 0.7 ? 0.88 : 1); // у воды песок мокрый
      col.set([c1.r * sh, c1.g * sh, c1.b * sh], i * 3);
    }
    // склоны: чем круче, тем больше камня
    const W = 257, Y = (i, j) => pos.getY(Math.min(W - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i)));
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, b = biomes[k]; if (b === 'water') continue;
      const slope = Math.hypot(Y(i + 1, j) - Y(i - 1, j), Y(i, j + 1) - Y(i, j - 1)) / (2 * (CONFIG.worldSize / 256));
      const t = smooth(0.32, 0.85, slope) * 0.7; if (t <= 0) continue;
      const rc = b === 'winter' ? snowRock : rock, o = k * 3;
      col[o] += (rc.r * 0.9 - col[o]) * t; col[o + 1] += (rc.g * 0.9 - col[o + 1]) * t; col[o + 2] += (rc.b * 0.9 - col[o + 2]) * t;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terrain.receiveShadow = true; this.scene.add(terrain);
  }
  _buildWater() {
    const geo = new THREE.PlaneGeometry(CONFIG.worldSize * 4, CONFIG.worldSize * 4); geo.rotateX(-Math.PI / 2);
    // рябь: маленькая бесшовная карта высот, её сдвигаем со временем; солнце даёт блики
    const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N), TAU = Math.PI * 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = Math.sin(TAU * (2 * x + 3 * y) / N) + Math.sin(TAU * (3 * x - 2 * y) / N + 1.3) + 0.6 * Math.sin(TAU * (5 * x + 4 * y) / N + 2) + 0.4 * Math.sin(TAU * (7 * x - 6 * y) / N + 0.7);
      const c = Math.max(0, Math.min(255, 128 + v * 40)), o = (y * N + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = c; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(220, 220);
    this.waterTex = tex;
    const w = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x2f78b0, specular: 0xb8d4ea, shininess: 70, transparent: true, opacity: 0.84, bumpMap: tex, bumpScale: 0.9 }));
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
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      const tint = new THREE.Color(), isTree = TREE_TYPES.has(type);
      list.forEach((o, i) => {
        o.mesh = mesh; o.idx = i; this._init(o); this._setMat(o, 1); this._register(o);
        const r = Math.abs(Math.sin(o.x * 12.9898 + o.z * 78.233) * 43758.5453) % 1, t = isTree ? 0.8 + r * 0.32 : 0.9 + r * 0.16; // у каждого дерева свой оттенок
        mesh.setColorAt(i, tint.setRGB(t, t * (0.96 + r * 0.08), t * (0.92 + r * 0.14)));
      });
      this.scene.add(mesh);
    }
  }
  // ---------- заправки и ящики ----------
  _buildStations() {
    for (const st of this.data.stations) {
      const g = makeStationModel(); g.position.set(st.x, st.h, st.z); g.rotation.y = st.ry; this.scene.add(g);
    }
    for (const s of this.data.solids) this._register({ nt: 'solid', x: s.x, z: s.z, y: s.y, cr: s.cr, pr: 0, ph: 0, dead: false }); // невидимые коллизии (стены, колонны, колонки)
    for (const c of this.data.crates) {
      const o = Object.assign(c, { cr: 0.65, pr: 1.15, ph: 1.0, dead: false, items: rollCrateLoot(), opened: false, lidOpen: false, respawnAt: 0, group: makeCrateModel() });
      o.group.position.set(o.x, o.y, o.z); o.group.rotation.y = o.ry; this.scene.add(o.group);
      this._register(o); this.crates.push(o);
    }
  }
  // ящик: забираем содержимое; что не влезло — остаётся. Пустой ящик наполняется заново через CRATE.respawn секунд.
  lootCrate(c, inv) {
    if (c.opened) return { msg: 'Ящик пуст', ok: false };
    const r = takeCrate(c, inv), any = Object.keys(r.got).length > 0;
    if (any) c.lidOpen = true;
    if (r.empty) { c.opened = true; c.respawnAt = this.time + CRATE.respawn; }
    return { msg: any ? fmtItems(r.got) + (r.full ? ' · не всё влезло' : '') : 'Инвентарь полон', ok: any };
  }

  // ---------- животные ----------
  _buildAnimals() {
    this.spawnPts = this.data.animalSpawns;
    const env = this.animalEnv = {
      px: 0, pz: 0, sneak: false,
      height: (x, z) => this.groundHeight(x, z),
      walkable: (x, z) => this.groundHeight(x, z) > 0.9, // не вода и не кромка воды
      collide: (p, r) => this.collide(p, r),
      spawnPoint: (type) => pickSpawn(this.spawnPts[type], env.px, env.pz),
      emit: (name, a) => this.onEvent?.(name, a),
    };
    for (const [type, S] of Object.entries(ANIMALS)) {
      const pts = this.spawnPts[type] || [];
      for (let i = 0; i < S.count && i < pts.length; i++) {
        const a = new Animal(type, pts[i].x, pts[i].z); a.y = this.groundHeight(a.x, a.z);
        a.group = makeAnimalModel(type); this.scene.add(a.group); this.animals.push(a); this._syncAnimal(a);
      }
    }
  }
  _syncAnimal(a) {
    const g = a.group, u = g.userData, S = ANIMALS[a.type], V = ANIMAL_VIS[a.type];
    if (a.removed) { g.visible = false; return; }
    g.visible = true;
    const hurt = a.hurtT > 0;
    if (hurt !== u.hurt) { u.hurt = hurt; for (const m of u.meshes) m.material = hurt ? ANIMAL_HURT : ANIMAL_MATERIAL; }
    g.rotation.y = -a.ang; // модель смотрит в +X
    u.inner.position.y = -V.cy; // вращаем вокруг центра тела
    if (a.dead) { // заваливается на бок за полсекунды
      const t = Math.min(1, (this.time - a.diedAt) / 0.5), e = 1 - (1 - t) * (1 - t);
      g.rotation.x = a.side * (Math.PI / 2) * e; g.rotation.z = 0;
      g.position.set(a.x, a.y + V.cy + (V.lift - V.cy) * e, a.z);
      for (const l of u.legs) l.rotation.z = 0.25 * e; // ноги чуть согнуты
      return;
    }
    const sp = Math.min(1, a.speed / (S.run || S.chase || S.walk)), amp = a.speed > 0.05 ? Math.min(0.7, 0.2 + a.speed * 0.08) : 0;
    u.legs.forEach((l, i) => { l.rotation.z = Math.sin(a.phase + LEG_PHASE[i]) * amp; });
    g.rotation.x = 0; g.rotation.z = a.lunge > 0 ? -Math.sin((a.lunge / 0.3) * Math.PI) * 0.3 : 0; // при укусе опускает морду
    g.position.set(a.x, a.y + V.cy + Math.abs(Math.sin(a.phase)) * 0.05 * sp, a.z);
  }
  // игрок не проходит сквозь живых животных
  collidePlayer(p, r) {
    this.collide(p, r);
    for (const a of this.animals) {
      if (a.dead || a.removed) continue;
      const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz), m = r + a.S.r;
      if (d < m && d > 1e-4) { p.x = a.x + (dx / d) * m; p.z = a.z + (dz / d) * m; }
    }
  }
  // удар по живому животному; px, pz — где стоит игрок (чтобы оно знало, от кого бежать / кого кусать)
  hitAnimal(a, tool, px, pz) {
    const r = a.hit(weaponOf(tool).dmg, px, pz, this.time);
    return { killed: r.killed, msg: r.killed ? `${a.name} убит — разделайте тушу` : `${a.name}: ${Math.ceil(a.hp)}/${a.S.hp}` };
  }
  // разделка туши
  harvestCorpse(a, tool, inv) {
    const r = a.harvest(tool, inv);
    return { ok: r.ok, done: r.empty, msg: r.ok ? fmtItems(r.got) + (r.empty ? ' · туша разделана' : '') : 'Инвентарь полон' };
  }

  // ---------- спальный мешок: точка возрождения (один; новый заменяет старый) ----------
  placeBag(x, z, ry) {
    if (this.bag) this.scene.remove(this.bag.group);
    const g = makeBagModel(), y = this.groundHeight(x, z); g.position.set(x, y, z); g.rotation.y = ry; this.scene.add(g);
    this.bag = { x, z, y, ry, group: g };
    return this.bag;
  }
  _init(o) {
    const [cr, pr, ph] = SHAPE[o.nt];
    o.cr = cr * (o.nt === 'tree' ? 1 : o.s); o.pr = pr * (o.nt === 'tree' ? 1 : o.s); o.ph = ph * o.s;
    o.pool = NODES[o.nt].pool; o.hp = NODES[o.nt].hits; o.dead = false;
  }
  _setMat(o, k) {
    this._qt.setFromAxisAngle(this._up, o.ry);
    this._m.compose(this._p.set(o.x, o.y - 0.08, o.z), this._qt, this._s.setScalar(o.s * k));
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
  pick(origin, dir, reach) { // луч шагами: попадание в «цилиндр» объекта или в тело животного (живого или туши)
    const near = this.animals.filter((a) => !a.removed && Math.hypot(a.x - origin.x, a.z - origin.z) < reach + 3);
    for (let s = 0.3; s <= reach + 0.5; s += 0.2) {
      const px = origin.x + dir.x * s, py = origin.y + dir.y * s, pz = origin.z + dir.z * s;
      const o = this._near(px, pz, (o) => !o.dead && Math.hypot(px - o.x, pz - o.z) < o.pr && py > o.y - 0.2 && py < o.y + o.ph ? o : null);
      if (o) return o;
      for (const a of near) if (a.contains(px, py, pz)) return a;
    }
    return null;
  }
  canPlace(x, z) { return this.groundHeight(x, z) > 0.5 && !this._near(x, z, (o) => !o.dead && Math.hypot(o.x - x, o.z - z) < o.cr + 1.1); }
  addFurnace(x, z, ry) {
    const o = { nt: 'furnace', type: 'furnace', x, z, y: this.groundHeight(x, z), s: 1, ry, cr: 0.95, pr: 1, ph: 1.6, furnace: new Furnace(), dead: false, group: makeFurnaceModel() };
    o.group.position.set(x, o.y, z); o.group.rotation.y = ry; this.scene.add(o.group);
    o.group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
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

  // Возвращает урон, который животные нанесли игроку за кадр. opts.sneak — игрок крадётся (его хуже замечают).
  update(dt, pp, opts) {
    this.time += dt; this.tod = (this.tod + dt / CONFIG.dayLength) % 1; this.setTimeOfDay(this.tod);
    // центр теней двигаем шагами в один тексель карты теней — тени не «плывут», когда игрок идёт
    const tgt = this._tgt || (this._tgt = new THREE.Vector3()), d = this._sd, rt = this._rt || (this._rt = new THREE.Vector3()), up2 = this._up2 || (this._up2 = new THREE.Vector3());
    tgt.copy(pp);
    if (this.shadowSize) {
      const texel = (2 * SHADOW_EXT) / this.shadowSize;
      rt.crossVectors(this._up, d).normalize(); up2.crossVectors(d, rt);
      const a = Math.round(pp.dot(rt) / texel) * texel, b = Math.round(pp.dot(up2) / texel) * texel, c = pp.dot(d);
      tgt.set(0, 0, 0).addScaledVector(rt, a).addScaledVector(up2, b).addScaledVector(d, c);
    }
    this.sun.position.copy(tgt).addScaledVector(d, 200); this.sun.target.position.copy(tgt);
    this.sun.castShadow = !!this.shadowSize && this._shadowsOn;
    this.sunMesh.position.copy(pp).addScaledVector(this._sd, 420); this.stars.position.copy(pp); this.dome.position.copy(pp);
    this.waterTex.offset.x = (this.time * 0.02) % 1; this.waterTex.offset.y = (this.time * 0.013) % 1;
    this.grass.update(this.time, pp);
    for (const f of this.furnaces) { f.furnace.update(dt); f.group.userData.flame.visible = f.furnace.active; }
    // животные
    const env = this.animalEnv; env.px = pp.x; env.pz = pp.z; env.sneak = !!opts?.sneak;
    let dmg = 0;
    for (const a of this.animals) {
      if (!a.removed && Math.hypot(a.x - pp.x, a.z - pp.z) > ANIMAL_FAR) { a.group.visible = false; continue; } // далеко — замирают и не рисуются
      dmg += a.update(dt, env);
      this._syncAnimal(a);
    }
    // ящики: крышка открывается, когда ящик тронут; пустой ящик через время наполняется заново
    for (const c of this.crates) {
      if (c.opened && this.time >= c.respawnAt) { c.items = rollCrateLoot(); c.opened = false; c.lidOpen = false; }
      const lid = c.group.userData.lid, to = c.lidOpen ? -1.9 : 0; lid.rotation.x += (to - lid.rotation.x) * Math.min(1, dt * 8);
    }
    for (const [o, t] of this.pulsing) {
      const n = t - dt;
      if (n <= 0) { this.pulsing.delete(o); if (!o.dead) this._setMat(o, 1); } else { this.pulsing.set(o, n); this._setMat(o, 1 + 0.1 * Math.sin(n * 50) * (n / 0.25)); }
    }
    for (let i = this.depleted.length - 1; i >= 0; i--) {
      const o = this.depleted[i];
      if (this.time >= o.respawnAt) { this._init(o); this._setMat(o, 1); this.depleted.splice(i, 1); }
    }
    return dmg;
  }
}
