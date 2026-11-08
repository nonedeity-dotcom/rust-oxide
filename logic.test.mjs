// Запуск: node tests/logic.test.mjs  (или npm test)
import assert from 'node:assert/strict';
import { Inventory, Furnace, craft, startInventory, harvestAmount, CONFIG } from '../js/data.js';
import { generateWorld, ROAD_WIDTH, BEACH_HEIGHT } from '../js/terrain.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

// ---------- инвентарь ----------
test('стартовый инвентарь: камень и факел в хотбаре', () => {
  const inv = startInventory();
  assert.equal(inv.slots[0].id, 'rock'); assert.equal(inv.slots[1].id, 'torch');
});
test('add/remove/count и переполнение', () => {
  const inv = new Inventory(2);
  assert.equal(inv.add('wood', 1500), 0); assert.equal(inv.count('wood'), 1500);
  assert.equal(inv.add('wood', 1000), 500); // влезло только до 2000
  assert.equal(inv.remove('wood', 5000), false); assert.equal(inv.count('wood'), 2000);
  assert.equal(inv.remove('wood', 1200), true); assert.equal(inv.count('wood'), 800);
});
test('swap меняет слоты и сливает одинаковые стаки', () => {
  const inv = new Inventory(3);
  inv.slots[0] = { id: 'wood', n: 10 }; inv.slots[1] = { id: 'stone', n: 5 };
  inv.swap(0, 1); assert.equal(inv.slots[0].id, 'stone');
  inv.slots[2] = { id: 'stone', n: 7 }; inv.swap(2, 0);
  assert.equal(inv.slots[0].n, 12); assert.equal(inv.slots[2], null);
});

// ---------- крафт ----------
test('крафт кирки и топора списывает ресурсы', () => {
  const inv = startInventory(); inv.add('wood', 250); inv.add('stone', 100);
  assert.equal(craft(inv, 'stone_pickaxe').ok, true); assert.equal(craft(inv, 'stone_axe').ok, true);
  assert.equal(inv.count('wood'), 50); assert.equal(inv.count('stone'), 0);
  assert.equal(inv.count('stone_pickaxe'), 1); assert.equal(inv.count('stone_axe'), 1);
});
test('крафт без ресурсов отклоняется и ничего не списывает', () => {
  const inv = startInventory(); inv.add('wood', 50);
  assert.equal(craft(inv, 'stone_pickaxe').ok, false); assert.equal(inv.count('wood'), 50);
});
test('крафт печи', () => {
  const inv = startInventory(); inv.add('stone', 200); inv.add('wood', 50);
  assert.equal(craft(inv, 'furnace').ok, true); assert.equal(inv.count('furnace'), 1);
});
test('крафт при полном инвентаре откатывается', () => {
  const inv = new Inventory(2); inv.add('wood', 100); inv.add('stone', 1000); // оба слота заняты
  const r = craft(inv, 'torch');
  assert.equal(r.ok, false); assert.equal(r.reason, 'full');
  assert.equal(inv.count('wood'), 100); assert.equal(inv.count('stone'), 1000);
});

// ---------- добыча ----------
test('кирка и топор добывают больше камня: инструмент важен', () => {
  assert.ok(harvestAmount('stone_axe', 'tree') > harvestAmount('rock', 'tree'));
  assert.ok(harvestAmount('stone_pickaxe', 'stone') > harvestAmount('rock', 'stone'));
  assert.ok(harvestAmount('stone_pickaxe', 'iron') > harvestAmount('rock', 'iron'));
  assert.equal(harvestAmount('torch', 'iron'), 0);
});

// ---------- печь ----------
test('печь переплавляет железную руду и серу, расходуя дерево', () => {
  const inv = new Inventory(10); inv.add('iron_ore', 4); inv.add('sulfur_ore', 2); inv.add('wood', 10);
  const f = new Furnace();
  f.load(inv, 'iron_ore'); f.load(inv, 'sulfur_ore'); f.load(inv, 'wood');
  assert.equal(inv.count('iron_ore'), 0);
  for (let i = 0; i < 400; i++) f.update(0.1);
  assert.equal(f.out.metal, 4); assert.equal(f.out.sulfur, 2); assert.equal(f.fuel, 4);
  f.collect(inv); assert.equal(inv.count('metal'), 4); assert.equal(inv.count('sulfur'), 2);
});
test('печь без топлива не плавит', () => {
  const inv = new Inventory(5); inv.add('iron_ore', 3);
  const f = new Furnace(); f.load(inv, 'iron_ore');
  for (let i = 0; i < 100; i++) f.update(0.1);
  assert.equal(f.out.metal, 0); assert.equal(f.ore.iron_ore, 3);
});

// ---------- остров ----------
const W = generateWorld(1337), T = W.terrain;
test('генерация детерминирована', () => {
  const W2 = generateWorld(1337);
  assert.equal(W2.objects.length, W.objects.length); assert.equal(W2.spawn.x, W.spawn.x);
});
test('спавн на пляже у края острова', () => {
  assert.equal(T.biomeAt(W.spawn.x, W.spawn.z), 'beach');
  assert.ok(Math.hypot(W.spawn.x, W.spawn.z) > CONFIG.islandRadius * 0.7);
});
test('есть все 3 биома', () => {
  const seen = new Set();
  for (let x = -250; x <= 250; x += 5) for (let z = -250; z <= 250; z += 5) seen.add(T.biomeAt(x, z));
  for (const b of ['forest', 'desert', 'winter', 'beach', 'water']) assert.ok(seen.has(b), b);
});
test('есть деревья, камень, железо, сера и бочки; ничего не в воде', () => {
  const c = {}; for (const o of W.objects) c[o.nt] = (c[o.nt] || 0) + 1;
  for (const k of ['tree', 'stone', 'iron', 'sulfur', 'barrel']) assert.ok(c[k] > 10, k);
  assert.ok(W.objects.every((o) => o.y > 0.5));
});
test('дорога — замкнутое кольцо, бочки стоят по её бокам', () => {
  for (let i = 0; i < 360; i += 10) { const a = i * Math.PI / 180, r = T.roadR(a); assert.ok(T.heightAt(Math.cos(a) * r, Math.sin(a) * r) > BEACH_HEIGHT); }
  for (const o of W.objects.filter((o) => o.nt === 'barrel')) { const d = T.roadDist(o.x, o.z); assert.ok(d > ROAD_WIDTH / 2 && d < ROAD_WIDTH / 2 + 3, 'barrel dist ' + d); }
});
test('деревья по биомам: сосны только на снегу', () => {
  for (const o of W.objects.filter((o) => o.type === 'snowpine')) assert.equal(T.biomeAt(o.x, o.z), 'winter');
});
console.log(`\n${passed} tests passed`);
