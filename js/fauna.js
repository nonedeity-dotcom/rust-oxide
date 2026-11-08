// ИИ животных — чистая логика без three.js (проверяется тестами в Node).
// Животное — конечный автомат: idle (стоит) → walk (бродит) → flee (убегает) / chase (преследует и кусает) → dead (туша).
// Мир подаёт окружение env: { px, pz, sneak, height(x,z), walkable(x,z), collide(p,r), spawnPoint(type), emit(name, animal) }.
import { ANIMALS, CORPSE_LIFE, rollAnimalLoot, harvestCorpse } from './data.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const STRIDE = 2.8; // радиан фазы шага на метр пути (≈ один цикл на 2.2 м)

export class Animal {
  constructor(type, x, z, rnd = Math.random) {
    this.type = type; this.S = ANIMALS[type]; this.rnd = rnd;
    this.reset(x, z);
  }
  get nt() { return this.dead ? 'corpse' : 'animal'; }
  get name() { return this.S.name; }

  reset(x, z) {
    const r = this.rnd;
    Object.assign(this, {
      x, z, y: this.y || 0, ang: r() * TAU, hp: this.S.hp, state: 'idle', timer: 1 + r() * 4, tx: x, tz: z,
      dead: false, removed: false, loot: null, total: null, corpseT: 0, respawnT: 0, hurtT: 0, aggroT: 0, atkCd: 0, lunge: 0,
      speed: 0, phase: r() * 10, fleeT: 0, threatX: x, threatZ: z, diedAt: -1, side: 1, yInit: false,
    });
  }

  // Удар игрока. Возвращает { killed }.
  hit(dmg, px, pz, now = 0) {
    if (this.dead || this.removed) return { killed: false };
    this.hp -= dmg; this.hurtT = 0.18;
    if (this.hp <= 0) { this.kill(now); return { killed: true }; }
    const S = this.S;
    this.threatX = px; this.threatZ = pz;
    if (S.behavior === 'flee') { this.state = 'flee'; this.fleeT = S.panic[0] + this.rnd() * (S.panic[1] - S.panic[0]); }
    else { this.state = 'chase'; this.aggroT = S.aggro; }
    return { killed: false };
  }
  kill(now = 0) {
    this.dead = true; this.state = 'dead'; this.hp = 0; this.speed = 0; this.corpseT = CORPSE_LIFE; this.diedAt = now;
    this.loot = rollAnimalLoot(this.type, this.rnd); this.total = { ...this.loot };
    this.side = this.rnd() < 0.5 ? 1 : -1; // на какой бок упадёт
  }
  // Разделка туши (см. harvestCorpse); когда добыча кончилась — туша исчезает.
  harvest(tool, inv) {
    const r = harvestCorpse(this, tool, inv);
    if (r.empty) this.vanish();
    return r;
  }
  vanish() { this.removed = true; this.respawnT = this.S.respawn * (0.8 + this.rnd() * 0.4); }

  // Точка (px,py,pz) внутри «капсулы» тела? Для попадания лучом игрока.
  contains(px, py, pz) {
    if (this.removed) return false;
    const S = this.S, c = Math.cos(this.ang), s = Math.sin(this.ang);
    const ax = this.x + c * S.seg[0], az = this.z + s * S.seg[0], vx = c * (S.seg[1] - S.seg[0]), vz = s * (S.seg[1] - S.seg[0]);
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t)) < S.hitR && py > this.y - 0.2 && py < this.y + (this.dead ? S.corpseH : S.h);
  }

  // Один шаг по курсу this.ang; если упёрлись (вода, крутой склон) — пробуем обойти. Возвращает true, если сдвинулись.
  step(dt, env, speed) {
    const d = speed * dt;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
      const a = this.ang + off, nx = this.x + Math.cos(a) * d, nz = this.z + Math.sin(a) * d;
      if (!env.walkable(nx, nz) || env.height(nx, nz) - this.y > 0.12 + d * 1.6) continue;
      const p = { x: nx, z: nz }; env.collide?.(p, this.S.r);
      if (!env.walkable(p.x, p.z)) continue;
      this.x = p.x; this.z = p.z; this.y = env.height(p.x, p.z);
      this.ang += off * 0.4; // плавно заворачиваем в сторону обхода
      return true;
    }
    return false;
  }
  pickTarget(env) {
    for (let i = 0; i < 6; i++) {
      const a = this.rnd() * TAU, d = 5 + this.rnd() * 12, tx = this.x + Math.cos(a) * d, tz = this.z + Math.sin(a) * d;
      if (env.walkable(tx, tz)) { this.tx = tx; this.tz = tz; this.state = 'walk'; this.timer = 20; return; }
    }
    this.timer = 1 + this.rnd() * 2; // подходящего места не нашли — постоим
  }

  // Шаг симуляции. Возвращает урон, нанесённый игроку за этот кадр (0, если не кусал).
  update(dt, env) {
    if (!this.yInit) { this.y = env.height(this.x, this.z); this.yInit = true; } // встаём на землю до первого шага
    if (this.removed) { // ждём возрождения в другом месте
      if ((this.respawnT -= dt) <= 0) {
        const p = env.spawnPoint?.(this.type);
        if (p) { this.reset(p.x, p.z); this.y = env.height(p.x, p.z); env.emit?.('respawn', this); } else this.respawnT = 5;
      }
      return 0;
    }
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.dead) { if ((this.corpseT -= dt) <= 0) this.vanish(); return 0; }

    const S = this.S, dx = env.px - this.x, dz = env.pz - this.z, dist = Math.hypot(dx, dz);
    this.atkCd = Math.max(0, this.atkCd - dt); this.lunge = Math.max(0, this.lunge - dt);
    let dmg = 0, want = this.ang, speed = 0, face = false;

    // заметил ли игрока (крадущегося видно вдвое хуже)
    if (this.state === 'idle' || this.state === 'walk') {
      const sight = S.sight * (env.sneak ? 0.5 : 1);
      if (sight > 0 && dist < sight) {
        this.threatX = env.px; this.threatZ = env.pz;
        if (S.behavior === 'flee') { this.state = 'flee'; this.fleeT = S.panic[0] + this.rnd() * (S.panic[1] - S.panic[0]); env.emit?.('alert', this); }
        else if (S.behavior === 'hunt') { this.state = 'chase'; this.aggroT = S.aggro; env.emit?.('growl', this); }
      }
    }

    switch (this.state) {
      case 'idle':
        if ((this.timer -= dt) <= 0) this.pickTarget(env);
        break;
      case 'walk': {
        const tdx = this.tx - this.x, tdz = this.tz - this.z;
        if ((this.timer -= dt) <= 0 || Math.hypot(tdx, tdz) < 0.8) { this.state = 'idle'; this.timer = 2 + this.rnd() * 5; break; }
        want = Math.atan2(tdz, tdx); speed = S.walk;
        break;
      }
      case 'flee':
        if ((this.fleeT -= dt) <= 0 || Math.hypot(this.x - this.threatX, this.z - this.threatZ) > 35) { this.state = 'idle'; this.timer = 2; break; }
        if (dist < S.sight * 1.5) { this.threatX = env.px; this.threatZ = env.pz; } // пока игрок рядом — бежим от него
        want = Math.atan2(this.z - this.threatZ, this.x - this.threatX) + Math.sin(this.phase * 0.35) * 0.4; speed = S.run;
        break;
      case 'chase':
        this.aggroT -= dt;
        if (S.sight > 0 && dist < S.sight * 1.5) this.aggroT = S.aggro; // игрок ещё рядом — не отстаём
        if (dist > S.giveUp || this.aggroT <= 0) { this.state = 'idle'; this.timer = 2; break; }
        want = Math.atan2(dz, dx);
        if (dist <= S.reach) {
          face = true; // стоим и кусаем
          if (this.atkCd <= 0) { dmg = S.dmg; this.atkCd = S.cd; this.lunge = 0.3; this.aggroT = Math.max(this.aggroT, 6); env.emit?.('attack', this); }
        } else speed = S.chase;
        break;
    }

    if (speed > 0 || face) { // поворот к цели; ходит только в ту сторону, куда смотрит
      const turn = (this.state === 'idle' || this.state === 'walk' ? 3.5 : 8) * dt;
      this.ang += Math.max(-turn, Math.min(turn, angDiff(this.ang, want)));
    }
    let moved = false;
    if (speed > 0) {
      moved = this.step(dt, env, speed * Math.max(0.2, 1 - Math.abs(angDiff(this.ang, want)) / Math.PI)); // в развороте идём медленнее
      if (!moved && this.state === 'walk') { this.state = 'idle'; this.timer = 0.3; }
    } else this.y = env.height(this.x, this.z);
    this.speed += ((moved ? speed : 0) - this.speed) * Math.min(1, dt * 8);
    this.phase += this.speed * dt * STRIDE;
    return dmg;
  }
}

// Случайная точка из списка не ближе minDist к игроку; null, если подходящей нет.
export function pickSpawn(points, px, pz, rnd = Math.random, minDist = 45) {
  if (!points?.length) return null;
  for (let i = 0; i < 24; i++) {
    const p = points[Math.floor(rnd() * points.length)];
    if (Math.hypot(p.x - px, p.z - pz) >= minDist) return p;
  }
  return null;
}
