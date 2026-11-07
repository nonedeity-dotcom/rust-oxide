// Чистая игровая логика без three.js: предметы, рецепты, инвентарь, печь. Тестируется в Node.
export const CONFIG = {
  worldSize: 640, islandRadius: 250, hotbarSize: 6, inventorySize: 30, reach: 3.4,
  playerHeight: 1.7, playerRadius: 0.4, walkSpeed: 5, runSpeed: 8, jumpSpeed: 6.5, gravity: 20,
  dayLength: 600, // секунд на сутки
};

// kind: tool | resource | placeable
export const ITEMS = {
  rock:          { name: 'Камень (в руке)', icon: '🪨', stack: 1, kind: 'tool' },
  torch:         { name: 'Факел', icon: '🔥', stack: 1, kind: 'tool' },
  stone_pickaxe: { name: 'Каменная кирка', icon: '⛏️', stack: 1, kind: 'tool' },
  stone_axe:     { name: 'Каменный топор', icon: '🪓', stack: 1, kind: 'tool' },
  furnace:       { name: 'Печь', icon: '🧱', stack: 1, kind: 'placeable' },
  wood:          { name: 'Дерево', icon: '🪵', stack: 1000, kind: 'resource' },
  stone:         { name: 'Камень', icon: '🪨', stack: 1000, kind: 'resource' },
  iron_ore:      { name: 'Железная руда', icon: '🟤', stack: 1000, kind: 'resource' },
  sulfur_ore:    { name: 'Серная руда', icon: '🟡', stack: 1000, kind: 'resource' },
  metal:         { name: 'Металл', icon: '🔩', stack: 1000, kind: 'resource' },
  sulfur:        { name: 'Сера', icon: '💛', stack: 1000, kind: 'resource' },
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

export const RECIPES = {
  stone_pickaxe: { out: 'stone_pickaxe', count: 1, cost: { wood: 100, stone: 50 } },
  stone_axe:     { out: 'stone_axe',     count: 1, cost: { wood: 100, stone: 50 } },
  furnace:       { out: 'furnace',       count: 1, cost: { stone: 200, wood: 50 } },
  torch:         { out: 'torch',         count: 1, cost: { wood: 30 } },
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
