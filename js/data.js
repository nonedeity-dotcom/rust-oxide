// Чистая игровая логика без three.js: предметы, рецепты, инвентарь, печь. Тестируется в Node.
export const CONFIG = {
  worldSize: 640, islandRadius: 250, hotbarSize: 6, inventorySize: 30, reach: 3.4,
  playerHeight: 1.7, playerRadius: 0.4, walkSpeed: 5, runSpeed: 8, jumpSpeed: 6.5, gravity: 20,
  dayLength: 600, // секунд на сутки
  maxHp: 100, regenDelay: 8, regenRate: 2, // здоровье: через regenDelay сек без урона восстанавливается regenRate ед/сек
};

// kind: tool | resource | placeable | wear
export const ITEMS = {
  rock:          { name: 'Камень (в руке)', icon: '🪨', stack: 1, kind: 'tool' },
  torch:         { name: 'Факел', icon: '🔥', stack: 1, kind: 'tool' },
  stone_pickaxe: { name: 'Каменная кирка', icon: '⛏️', stack: 1, kind: 'tool' },
  stone_axe:     { name: 'Каменный топор', icon: '🪓', stack: 1, kind: 'tool' },
  bone_knife:    { name: 'Костяной нож', icon: '🔪', stack: 1, kind: 'tool' },
  bone_club:     { name: 'Костяная дубинка', icon: '🏏', stack: 1, kind: 'tool' },
  bone_armor:    { name: 'Костяная броня', icon: '🦺', stack: 1, kind: 'wear' },
  furnace:       { name: 'Печь', icon: '🧱', stack: 1, kind: 'placeable' },
  sleeping_bag:  { name: 'Спальный мешок', icon: '🛏️', stack: 1, kind: 'placeable' },
  wood:          { name: 'Дерево', icon: '🪵', stack: 1000, kind: 'resource' },
  stone:         { name: 'Камень', icon: '🪨', stack: 1000, kind: 'resource' },
  iron_ore:      { name: 'Железная руда', icon: '🟤', stack: 1000, kind: 'resource' },
  sulfur_ore:    { name: 'Серная руда', icon: '🟡', stack: 1000, kind: 'resource' },
  metal:         { name: 'Металл', icon: '🔩', stack: 1000, kind: 'resource' },
  sulfur:        { name: 'Сера', icon: '💛', stack: 1000, kind: 'resource' },
  bone:          { name: 'Кости', icon: '🦴', stack: 1000, kind: 'resource' },
  cloth:         { name: 'Ткань', icon: '🧵', stack: 1000, kind: 'resource' },
  leather:       { name: 'Кожа', icon: '🟫', stack: 1000, kind: 'resource' },
  fat:           { name: 'Жир', icon: '🧈', stack: 1000, kind: 'resource' },
  refined_metal: { name: 'Плавленый металл', icon: '⚙️', stack: 1000, kind: 'resource' },
};

// pool — сколько ресурса в объекте; hits — прочность (бочки)
export const NODES = {
  tree:   { name: 'Дерево', drop: 'wood', pool: 300, respawn: 240 },
  stone:  { name: 'Камень', drop: 'stone', pool: 500, respawn: 300 },
  iron:   { name: 'Железная руда', drop: 'iron_ore', pool: 350, respawn: 300 },
  sulfur: { name: 'Серная руда', drop: 'sulfur_ore', pool: 350, respawn: 300 },
  barrel: { name: 'Бочка', hits: 3, respawn: 420 },
};

// Сколько ресурса за один удар: TOOL_YIELD[инструмент][тип узла]
export const TOOL_YIELD = {
  rock:          { tree: 8,  stone: 8,  iron: 4,  sulfur: 4 },
  torch:         { tree: 2,  stone: 0,  iron: 0,  sulfur: 0 },
  stone_axe:     { tree: 28, stone: 6,  iron: 0,  sulfur: 0 },
  stone_pickaxe: { tree: 5,  stone: 28, iron: 14, sulfur: 14 },
};
export const NEED_TOOL = { tree: 'Нужен топор', stone: 'Нужна кирка', iron: 'Нужна кирка', sulfur: 'Нужна кирка' };
export const harvestAmount = (tool, node) => TOOL_YIELD[tool]?.[node] ?? 0;

export const BARREL_LOOT = { metal: [2, 5], woodChance: 0.35, wood: [5, 15] };

// ---------- бой ----------
// dmg — урон за удар; rate — удары в секунду (по умолчанию 3). Всё, чего нет в таблице (в т.ч. пустая рука), бьёт как кулак.
export const WEAPONS = {
  hand:          { dmg: 4 },
  rock:          { dmg: 7 },
  torch:         { dmg: 8 },
  stone_pickaxe: { dmg: 12 },
  stone_axe:     { dmg: 18 },
  bone_knife:    { dmg: 16, rate: 4 },
  bone_club:     { dmg: 30 },
};
export const weaponOf = (id) => WEAPONS[id] || WEAPONS.hand;
export const swingRate = (id) => weaponOf(id).rate || 3;

// Броня: reduce — доля поглощаемого урона
export const ARMOR = { bone_armor: { reduce: 0.5 } };
export const damageAfterArmor = (dmg, armorId) => Math.max(1, Math.round(dmg * (1 - (ARMOR[armorId]?.reduce ?? 0))));

// Здоровье игрока (чистая логика)
export class Vitals {
  constructor() { this.hp = CONFIG.maxHp; this.armor = null; this.sinceHit = 99; }
  hurt(n) { const d = damageAfterArmor(n, this.armor); this.hp = Math.max(0, this.hp - d); this.sinceHit = 0; return d; }
  update(dt) {
    this.sinceHit += dt;
    if (this.hp > 0 && this.sinceHit > CONFIG.regenDelay) this.hp = Math.min(CONFIG.maxHp, this.hp + CONFIG.regenRate * dt);
  }
  get dead() { return this.hp <= 0; }
}
// Надеть / снять броню (меняет Vitals и инвентарь)
export function wearArmor(v, inv, id) {
  if (ITEMS[id]?.kind !== 'wear' || inv.count(id) < 1) return { ok: false, reason: 'none' };
  if (v.armor === id) return { ok: false, reason: 'already' };
  inv.remove(id, 1);
  if (v.armor && inv.add(v.armor, 1) > 0) { inv.add(id, 1); return { ok: false, reason: 'full' }; } // старую некуда положить
  v.armor = id; return { ok: true };
}
export function takeOffArmor(v, inv) {
  if (!v.armor) return { ok: false, reason: 'none' };
  if (inv.add(v.armor, 1) > 0) return { ok: false, reason: 'full' };
  v.armor = null; return { ok: true };
}

// ---------- животные ----------
// hp; scale — масштаб модели; r — радиус коллизии; seg — отрезок тела вдоль взгляда [назад, вперёд] (м) и hitR — толщина зоны удара;
// h / corpseH — высота зоны удара живого / туши; walk/run/chase — скорости (игрок: 5 шаг, 8 бег);
// behavior: flee — убегает от игрока, retaliate — мирный, но огрызается, hunt — нападает, если заметил;
// sight — на каком расстоянии замечает (вдвое меньше, если игрок крадётся); dmg/cd/reach — удар по игроку;
// loot — [мин, макс] каждого ресурса в туше; respawn — через сколько секунд после исчезновения туши появится новое животное.
export const ANIMALS = {
  deer: { name: 'Олень', hp: 80, scale: 0.65, r: 0.5, seg: [-0.35, 0.55], hitR: 0.5, h: 1.7, corpseH: 0.8,
    behavior: 'flee', walk: 1.7, run: 6.0, sight: 12, panic: [5, 8], dmg: 0, cd: 1, reach: 0, habitat: ['forest', 'winter'], count: 14, respawn: 300,
    loot: { bone: [12, 20], cloth: [14, 22], leather: [6, 10], fat: [8, 14] } },
  boar: { name: 'Кабан', hp: 110, scale: 0.6, r: 0.55, seg: [-0.35, 0.55], hitR: 0.5, h: 0.95, corpseH: 0.7,
    behavior: 'retaliate', walk: 1.6, chase: 6.5, sight: 0, aggro: 14, giveUp: 40, dmg: 14, cd: 1.0, reach: 1.9, habitat: ['forest', 'desert'], count: 10, respawn: 300,
    loot: { bone: [16, 26], cloth: [10, 16], leather: [8, 12], fat: [14, 22] } },
  bear: { name: 'Медведь', hp: 300, scale: 0.85, r: 0.8, seg: [-0.4, 0.75], hitR: 0.6, h: 1.5, corpseH: 0.9,
    behavior: 'hunt', walk: 1.8, chase: 6.2, sight: 16, aggro: 25, giveUp: 45, dmg: 30, cd: 1.3, reach: 2.3, habitat: ['winter', 'forest'], count: 7, respawn: 420,
    loot: { bone: [30, 45], cloth: [20, 32], leather: [14, 22], fat: [22, 34] } },
};
export const CORPSE_LIFE = 240; // сколько секунд лежит туша, если её не разделать

export function rollAnimalLoot(type, rnd = Math.random) {
  const out = {};
  for (const [id, [a, b]] of Object.entries(ANIMALS[type].loot)) out[id] = a + Math.floor(rnd() * (b - a + 1));
  return out;
}
// Разделка: за удар снимается доля от исходной добычи. Нож — самый быстрый и даёт +30%.
export const CORPSE_TOOL = { hand: 0.12, rock: 0.15, torch: 0.12, stone_pickaxe: 0.2, stone_axe: 0.25, bone_club: 0.25, bone_knife: 0.45 };
export const CORPSE_BONUS = { bone_knife: 1.3 };
// corpse: { loot: {id: осталось}, total: {id: было} }; возвращает { ok, got, empty, full }
export function harvestCorpse(corpse, tool, inv) {
  const f = CORPSE_TOOL[tool] ?? CORPSE_TOOL.hand, bonus = CORPSE_BONUS[tool] ?? 1, got = {};
  let full = false;
  for (const [id, left] of Object.entries(corpse.loot)) {
    if (left <= 0) continue;
    const take = Math.min(left, Math.max(1, Math.ceil(corpse.total[id] * f)));
    const rest = inv.add(id, take), took = take - rest;
    if (rest > 0) full = true;
    if (took <= 0) continue;
    corpse.loot[id] -= took;
    const extra = Math.round(took * (bonus - 1)); if (extra) inv.add(id, extra);
    got[id] = took + extra;
  }
  return { ok: Object.keys(got).length > 0, got, empty: Object.values(corpse.loot).every((v) => v <= 0), full };
}
export const fmtItems = (o) => Object.entries(o).map(([id, n]) => `+${n} ${ITEMS[id].name}`).join(', ');

// ---------- ящики на заправках ----------
export const CRATE = { respawn: 600 }; // секунд до нового содержимого
export const CRATE_LOOT = [
  { id: 'metal',         chance: 0.9,  n: [10, 25] },
  { id: 'refined_metal', chance: 0.45, n: [1, 3] },
  { id: 'bone_knife',    chance: 0.3,  n: [1, 1] },
];
// Что лежит в ящике: [{id, n}], не пустой
export function rollCrateLoot(rnd = Math.random) {
  const out = [];
  for (const r of CRATE_LOOT) if (rnd() < r.chance) out.push({ id: r.id, n: r.n[0] + Math.floor(rnd() * (r.n[1] - r.n[0] + 1)) });
  if (!out.length) out.push({ id: 'metal', n: CRATE_LOOT[0].n[0] });
  return out;
}
// Перекладывает содержимое ящика (crate.items) в инвентарь; не влезшее остаётся в ящике.
export function takeCrate(crate, inv) {
  const got = {}, keep = [];
  for (const it of crate.items) {
    const rest = inv.add(it.id, it.n), took = it.n - rest;
    if (took > 0) got[it.id] = (got[it.id] || 0) + took;
    if (rest > 0) keep.push({ id: it.id, n: rest });
  }
  crate.items = keep;
  return { got, empty: keep.length === 0, full: keep.length > 0 };
}

export const RECIPES = {
  stone_pickaxe: { out: 'stone_pickaxe', count: 1, cost: { wood: 100, stone: 50 } },
  stone_axe:     { out: 'stone_axe',     count: 1, cost: { wood: 100, stone: 50 } },
  furnace:       { out: 'furnace',       count: 1, cost: { stone: 200, wood: 50 } },
  torch:         { out: 'torch',         count: 1, cost: { wood: 30 } },
  bone_knife:    { out: 'bone_knife',    count: 1, cost: { bone: 30 } },
  bone_club:     { out: 'bone_club',     count: 1, cost: { bone: 40 } },
  bone_armor:    { out: 'bone_armor',    count: 1, cost: { bone: 50, cloth: 30 } },
  sleeping_bag:  { out: 'sleeping_bag',  count: 1, cost: { cloth: 30 } },
};

export class Inventory {
  constructor(size = CONFIG.inventorySize) { this.slots = Array(size).fill(null); }
  // возвращает сколько НЕ влезло
  add(id, n = 1) {
    const max = ITEMS[id].stack;
    for (const s of this.slots) if (n > 0 && s && s.id === id && s.n < max) { const t = Math.min(n, max - s.n); s.n += t; n -= t; }
    for (let i = 0; i < this.slots.length && n > 0; i++) if (!this.slots[i]) { const t = Math.min(n, max); this.slots[i] = { id, n: t }; n -= t; }
    return n;
  }
  count(id) { return this.slots.reduce((a, s) => a + (s && s.id === id ? s.n : 0), 0); }
  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) { const t = Math.min(n, s.n); s.n -= t; n -= t; if (!s.n) this.slots[i] = null; }
    }
    return true;
  }
  swap(a, b) {
    if (a === b) return;
    const A = this.slots[a], B = this.slots[b];
    if (A && B && A.id === B.id) { // одинаковые стаки сливаем
      const t = Math.min(A.n, ITEMS[A.id].stack - B.n); B.n += t; A.n -= t;
      if (!A.n) this.slots[a] = null;
      return;
    }
    this.slots[a] = B; this.slots[b] = A;
  }
}

export function startInventory() {
  const inv = new Inventory();
  inv.slots[0] = { id: 'rock', n: 1 };
  inv.slots[1] = { id: 'torch', n: 1 };
  return inv;
}

export function craft(inv, id) {
  const r = RECIPES[id];
  if (!r) return { ok: false, reason: 'unknown' };
  for (const [k, v] of Object.entries(r.cost)) if (inv.count(k) < v) return { ok: false, reason: 'resources' };
  for (const [k, v] of Object.entries(r.cost)) inv.remove(k, v);
  const left = inv.add(r.out, r.count);
  if (left > 0) { // нет места: откатываем
    inv.remove(r.out, r.count - left);
    for (const [k, v] of Object.entries(r.cost)) inv.add(k, v);
    return { ok: false, reason: 'full' };
  }
  return { ok: true };
}

// Печь: руда + дерево (топливо) -> металл / сера. 1 дерево = 1 переплавка.
export const SMELT = { iron_ore: 'metal', sulfur_ore: 'sulfur' };
export const SMELT_TIME = 2; // сек на единицу
export class Furnace {
  constructor() { this.ore = { iron_ore: 0, sulfur_ore: 0 }; this.fuel = 0; this.out = { metal: 0, sulfur: 0 }; this.cur = null; this.prog = 0; }
  // кладёт в печь всё указанное из инвентаря, возвращает сколько положено
  load(inv, id) {
    if (id !== 'wood' && !(id in SMELT)) return 0;
    const n = inv.count(id); inv.remove(id, n);
    if (id === 'wood') this.fuel += n; else this.ore[id] += n;
    return n;
  }
  get active() { return !!this.cur; }
  update(dt) {
    if (!this.cur) {
      const k = Object.keys(SMELT).find((o) => this.ore[o] > 0);
      if (!k || this.fuel < 1) return;
      this.cur = k; this.ore[k]--; this.fuel--; this.prog = 0;
    }
    this.prog += dt;
    if (this.prog >= SMELT_TIME) { this.out[SMELT[this.cur]]++; this.cur = null; }
  }
  collect(inv) {
    for (const k of Object.keys(this.out)) this.out[k] = inv.add(k, this.out[k]);
  }
}
