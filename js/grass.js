// Трава: чанки 16×16 м вокруг игрока, строятся по одному за кадр, ветер качает кончики,
// вдали пучки плавно «втягиваются» в землю (нет резкого появления).
import * as THREE from 'three';
import { CHUNK, buildChunkData } from './grassdata.js';

export class Grass {
  constructor(scene, terrain) {
    this.scene = scene; this.T = terrain; this.R = 0; this.density = 0; this.chunks = new Map();
    this.uniforms = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uFade: { value: new THREE.Vector2(20, 28) } };
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nattribute vec3 aRoot;\nuniform float uTime;\nuniform vec3 uPlayer;\nuniform vec2 uFade;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float gf = 1.0 - smoothstep(uFade.x, uFade.y, distance(aRoot.xz, uPlayer.xz));
          transformed = aRoot + (transformed - aRoot) * gf;
          float gw = sin(uTime * 1.8 + aRoot.x * 0.35 + aRoot.z * 0.27) + 0.5 * sin(uTime * 3.1 + aRoot.x * 0.9);
          transformed.x += gw * 0.07 * aSway * gf;
          transformed.z += gw * 0.04 * aSway * gf;`);
    };
  }
  // R — радиус в чанках (0 — травы нет), density — пучков на м²
  setQuality(R, density) {
    if (R === this.R && density === this.density) return;
    this.clear(); this.R = R; this.density = density;
    const end = R * CHUNK - 1; this.uniforms.uFade.value.set(end - 8, end);
  }
  clear() { for (const c of this.chunks.values()) this._drop(c); this.chunks.clear(); }
  _drop(c) { if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); } }
  _build(cx, cz) {
    const d = buildChunkData(this.T, cx, cz, this.density);
    if (!d.tufts) return { cx, cz, mesh: null };
    const g = new THREE.BufferGeometry(), n = d.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('aRoot', new THREE.Float32BufferAttribute(d.root, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(d.sway, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // нормали вверх — свет как у земли
    g.computeBoundingSphere(); g.boundingSphere.radius += 1;
    const mesh = new THREE.Mesh(g, this.mat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    return { cx, cz, mesh };
  }
  update(time, pp) {
    this.uniforms.uTime.value = time; this.uniforms.uPlayer.value.copy(pp);
    if (!this.R) return;
    const pcx = Math.floor(pp.x / CHUNK), pcz = Math.floor(pp.z / CHUNK), R = this.R;
    for (const [k, c] of this.chunks) if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cz - pcz) > R + 1) { this._drop(c); this.chunks.delete(k); }
    let best = null, bd = 1e9;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const k = (pcx + dx) * 100003 + (pcz + dz), dd = dx * dx + dz * dz;
      if (!this.chunks.has(k) && dd < bd) { bd = dd; best = [k, pcx + dx, pcz + dz]; }
    }
    if (best) this.chunks.set(best[0], this._build(best[1], best[2])); // один чанк за кадр, чтобы не было рывков
  }
}
