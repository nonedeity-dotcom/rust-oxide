// Запуск: node tests/logic.test.mjs  (или npm test)
import assert from 'node:assert/strict';
import { Inventory, Furnace, craft, startInventory, harvestAmount, CONFIG, ITEMS, RECIPES, ANIMALS, CORPSE_LIFE, WEAPONS, weaponOf, swingRate, Vitals, wearArmor, takeOffArmor,
  rollAnimalLoot, harvestCorpse, rollCrateLoot, takeCrate, CRATE_LOOT, damageAfterArmor } from '../js/data.js';
import { Animal, pickSpawn } from '../js/fauna.js';
import { STATION, toWorld, toLocal, inStation, stationSolids } from '../js/station.js';
import { generateWorld, ROAD_WIDTH, BEACH_HEIGHT } from '../js/terrain.js';
import { DEFAULTS, sanitize } from '../js/settings.js';
import { sampleMap } from '../js/map.js';
import { buildChunkData, CHUNK } from '../js/grassdata.js';

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

// ---------- настройки и карта ----------
test('настройки: мусор и выход за границы заменяются безопасными значениями', () => {
  const s = sanitize({ master: 5, sens: -3, fov: 'abc', invY: 'yes', view: 1.7, btn: 1.1, quality: 9 });
  assert.equal(s.master, 1); assert.equal(s.sens, 0.3); assert.equal(s.fov, DEFAULTS.fov);
  assert.equal(s.invY, false); assert.equal(s.view, 2); assert.equal(s.btn, 1.1); assert.equal(s.quality, 2);
  assert.deepEqual(sanitize(null), DEFAULTS);
});
test('карта: есть вода, суша и дорога, центр острова — суша', () => {
  const { n, data } = sampleMap(W.terrain, 100);
  assert.equal(data.length, n * n * 4);
  const key = (i) => `${data[i]},${data[i + 1]},${data[i + 2]}`;
  const colors = new Set(); for (let i = 0; i < data.length; i += 4) colors.add(key(i));
  assert.ok(colors.size > 8, 'мало цветов: ' + colors.size);
  const c = (n / 2 * n + n / 2) * 4; assert.ok(data[c + 2] < 200 || data[c] > 60, 'центр не вода');
  assert.equal(data[3], 255);
});

// ---------- трава ----------
test('трава: растёт в лесу, не на воде, пляже, дороге и снегу; данные согласованы и детерминированы', () => {
  let total = 0, forestTufts = 0, blades = 0, edge = 0;
  for (let cx = -17; cx <= 17; cx++) for (let cz = -17; cz <= 17; cz++) {
    const d = buildChunkData(T, cx, cz, 1.4);
    assert.equal(d.pos.length, d.root.length); assert.equal(d.pos.length, d.col.length); assert.equal(d.pos.length / 3, d.sway.length);
    total += d.tufts;
    for (let i = 0; i < d.root.length; i += 9) { // по одному корню на лезвие
      const x = d.root[i], y = d.root[i + 1], z = d.root[i + 2], h = T.heightAt(x, z);
      assert.ok(Math.abs(h - 0.05 - y) < 1e-6, 'корень лежит на земле');
      assert.ok(h > BEACH_HEIGHT - 0.3, 'не на пляже/воде: ' + h);
      const b = T.biomeAt(x, z); blades++;
      if (b === 'forest') forestTufts++; else if (b !== 'desert') edge++; // лезвие у самой границы биома (пучок смещён до ~14 см)
      assert.ok(T.roadDist(x, z) > ROAD_WIDTH / 2 + 0.4 - 0.4, 'не на дороге');
    }
  }
  assert.ok(edge / blades < 0.02, `слишком много травы вне лесов и пустынь: ${edge}/${blades}`);
  assert.ok(total > 2000 && forestTufts > 500, `пучков ${total}, лесных ${forestTufts}`);
  assert.deepEqual(buildChunkData(T, 3, -4, 1.4).pos, buildChunkData(T, 3, -4, 1.4).pos);
  assert.equal(CHUNK, 16);
});

// ---------- крафт из добычи с животных ----------
test('рецепты: нож и дубинка из костей, броня из костей и ткани, спальный мешок из ткани', () => {
  assert.deepEqual(RECIPES.bone_knife.cost, { bone: 30 }); assert.deepEqual(RECIPES.bone_club.cost, { bone: 40 });
  assert.deepEqual(RECIPES.bone_armor.cost, { bone: 50, cloth: 30 }); assert.deepEqual(RECIPES.sleeping_bag.cost, { cloth: 30 });
  const inv = startInventory(); inv.add('bone', 120); inv.add('cloth', 60);
  for (const id of ['bone_knife', 'bone_club', 'bone_armor', 'sleeping_bag']) assert.equal(craft(inv, id).ok, true, id);
  assert.equal(inv.count('bone'), 0); assert.equal(inv.count('cloth'), 0);
  for (const id of ['bone_knife', 'bone_club', 'bone_armor', 'sleeping_bag']) assert.equal(inv.count(id), 1, id);
});
test('все предметы из рецептов, лута и добычи описаны', () => {
  for (const r of Object.values(RECIPES)) { assert.ok(ITEMS[r.out]); for (const k of Object.keys(r.cost)) assert.ok(ITEMS[k], k); }
  for (const S of Object.values(ANIMALS)) for (const k of Object.keys(S.loot)) assert.ok(ITEMS[k], k);
  for (const l of CRATE_LOOT) assert.ok(ITEMS[l.id], l.id);
  for (const id of ['bone', 'cloth', 'leather', 'fat', 'refined_metal']) assert.equal(ITEMS[id].kind, 'resource');
});
test('нехватка костей или ткани — отказ без списания', () => {
  const inv = startInventory(); inv.add('bone', 60); inv.add('cloth', 10);
  assert.equal(craft(inv, 'bone_armor').ok, false); assert.equal(inv.count('bone'), 60); assert.equal(inv.count('cloth'), 10);
});

// ---------- добыча с туши ----------
const seeded = (seed) => { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };
test('с каждого животного падают кости, ткань, кожа и жир в заданных пределах', () => {
  for (const [type, S] of Object.entries(ANIMALS)) for (let i = 0; i < 50; i++) {
    const l = rollAnimalLoot(type, seeded(i + 1));
    assert.deepEqual(Object.keys(l).sort(), ['bone', 'cloth', 'fat', 'leather']);
    for (const [k, [a, b]] of Object.entries(S.loot)) assert.ok(l[k] >= a && l[k] <= b, `${type} ${k} ${l[k]}`);
  }
});
test('медведь даёт больше всех: хватает на броню', () => {
  const bear = ANIMALS.bear.loot, deer = ANIMALS.deer.loot;
  assert.ok(bear.bone[0] > deer.bone[1] && bear.cloth[0] > deer.cloth[0]);
  assert.ok(bear.bone[1] + deer.bone[1] >= RECIPES.bone_armor.cost.bone && bear.cloth[1] + deer.cloth[1] >= RECIPES.bone_armor.cost.cloth);
});
test('разделка: нож быстрее и даёт больше; туша исчерпывается', () => {
  const mk = () => ({ loot: { bone: 40, cloth: 30, leather: 20, fat: 30 }, total: { bone: 40, cloth: 30, leather: 20, fat: 30 } });
  const run = (tool) => { const c = mk(), inv = new Inventory(10); let hits = 0, r; do { r = harvestCorpse(c, tool, inv); hits++; } while (!r.empty && hits < 100); return { hits, inv, c }; };
  const knife = run('bone_knife'), rock = run('rock'), hand = run(null);
  assert.ok(knife.hits < rock.hits && rock.hits <= hand.hits, `${knife.hits} ${rock.hits} ${hand.hits}`);
  assert.ok(knife.inv.count('bone') > rock.inv.count('bone'), 'нож даёт бонус');
  assert.equal(rock.inv.count('bone'), 40); assert.equal(rock.inv.count('fat'), 30); // без бонуса — ровно то, что было в туше
  for (const k of Object.keys(rock.c.loot)) assert.equal(rock.c.loot[k], 0);
});
test('разделка при полном инвентаре: ничего не пропадает', () => {
  const inv = new Inventory(1); inv.add('stone', 5); // единственный слот занят другим предметом
  const c = { loot: { bone: 10, cloth: 10 }, total: { bone: 10, cloth: 10 } };
  const r = harvestCorpse(c, 'rock', inv);
  assert.equal(r.ok, false); assert.equal(r.full, true); assert.equal(c.loot.bone, 10); assert.equal(c.loot.cloth, 10);
});

// ---------- оружие, здоровье, броня ----------
test('оружие: дубинка бьёт сильнее топора и камня, нож быстрее', () => {
  assert.ok(weaponOf('bone_club').dmg > weaponOf('stone_axe').dmg && weaponOf('stone_axe').dmg > weaponOf('rock').dmg && weaponOf('rock').dmg > weaponOf(null).dmg);
  assert.ok(swingRate('bone_knife') > swingRate('bone_club')); assert.equal(weaponOf('furnace').dmg, WEAPONS.hand.dmg);
});
test('броня гасит часть урона, здоровье восстанавливается не сразу', () => {
  const v = new Vitals(); assert.equal(v.hp, CONFIG.maxHp);
  assert.equal(v.hurt(30), 30); v.armor = 'bone_armor'; assert.equal(v.hurt(30), damageAfterArmor(30, 'bone_armor')); assert.ok(damageAfterArmor(30, 'bone_armor') < 30);
  const hp = v.hp; v.update(CONFIG.regenDelay - 1); assert.equal(v.hp, hp);
  v.update(3); assert.ok(v.hp > hp, 'после паузы лечится');
  for (let i = 0; i < 20; i++) v.hurt(30); assert.equal(v.hp, 0); assert.equal(v.dead, true);
});
test('надеть и снять броню меняет инвентарь', () => {
  const v = new Vitals(), inv = new Inventory(3); assert.equal(wearArmor(v, inv, 'bone_armor').ok, false);
  inv.add('bone_armor', 1); assert.equal(wearArmor(v, inv, 'bone_armor').ok, true);
  assert.equal(v.armor, 'bone_armor'); assert.equal(inv.count('bone_armor'), 0);
  assert.equal(wearArmor(v, inv, 'bone_armor').ok, false);
  assert.equal(takeOffArmor(v, inv).ok, true); assert.equal(v.armor, null); assert.equal(inv.count('bone_armor'), 1);
  assert.equal(wearArmor(v, inv, 'rock').ok, false); // не броня
  const full = new Inventory(1); full.add('stone', 1); v.armor = 'bone_armor';
  assert.equal(takeOffArmor(v, full).ok, false); assert.equal(v.armor, 'bone_armor'); // некуда положить
});

// ---------- ящик ----------
test('лут ящика: не пустой, только металл / плавленый металл / костяной нож', () => {
  const seen = {};
  for (let i = 0; i < 400; i++) {
    const l = rollCrateLoot(seeded(i * 7 + 3)); assert.ok(l.length >= 1);
    for (const it of l) { const cfg = CRATE_LOOT.find((c) => c.id === it.id); assert.ok(cfg, it.id); assert.ok(it.n >= cfg.n[0] && it.n <= cfg.n[1]); seen[it.id] = (seen[it.id] || 0) + 1; }
  }
  for (const id of ['metal', 'refined_metal', 'bone_knife']) assert.ok(seen[id] > 20, `${id} выпадает: ${seen[id]}`);
  assert.ok(seen.metal > seen.refined_metal && seen.refined_metal > seen.bone_knife, 'металл — частый, нож — редкий');
});
test('открытие ящика: всё в инвентарь; не влезшее остаётся', () => {
  const inv = new Inventory(5), crate = { items: [{ id: 'metal', n: 20 }, { id: 'refined_metal', n: 2 }, { id: 'bone_knife', n: 1 }] };
  const r = takeCrate(crate, inv);
  assert.equal(r.empty, true); assert.equal(inv.count('metal'), 20); assert.equal(inv.count('refined_metal'), 2); assert.equal(inv.count('bone_knife'), 1);
  const tight = new Inventory(1), c2 = { items: [{ id: 'metal', n: 5 }, { id: 'bone_knife', n: 1 }] };
  const r2 = takeCrate(c2, tight);
  assert.equal(r2.empty, false); assert.deepEqual(c2.items, [{ id: 'bone_knife', n: 1 }]); assert.equal(tight.count('metal'), 5);
});

// ---------- животные: ИИ ----------
// плоская земля; озеро справа (x > 60) — туда заходить нельзя
const flatEnv = (o = {}) => Object.assign({
  px: 0, pz: 0, sneak: false, height: () => 2, walkable: (x) => x < 60, collide: () => {}, spawnPoint: () => null, emit() {},
}, o);
const sim = (a, env, sec, dt = 0.05) => { let dmg = 0; for (let t = 0; t < sec; t += dt) dmg += a.update(dt, env); return dmg; };

test('олень замечает игрока и убегает, бегущий игрок его догоняет', () => {
  const a = new Animal('deer', 8, 0, seeded(1)), env = flatEnv({ walkable: () => true });
  a.update(0.05, env); assert.equal(a.state, 'flee');
  const d0 = Math.hypot(a.x - env.px, a.z - env.pz); sim(a, env, 2); assert.ok(Math.hypot(a.x - env.px, a.z - env.pz) > d0 + 5, 'отбежал');
  assert.equal(sim(a, env, 3), 0, 'олень не кусается');
  assert.ok(ANIMALS.deer.run < CONFIG.runSpeed, 'бегущий игрок быстрее оленя');
});
test('крадущегося игрока олень замечает вдвое ближе', () => {
  const far = new Animal('deer', 8, 0, seeded(2)); far.update(0.05, flatEnv({ sneak: true, walkable: () => true })); assert.notEqual(far.state, 'flee');
  const near = new Animal('deer', 5, 0, seeded(2)); near.update(0.05, flatEnv({ sneak: true, walkable: () => true })); assert.equal(near.state, 'flee');
});
test('медведь замечает издалека, догоняет и кусает с перезарядкой; от него можно убежать', () => {
  const a = new Animal('bear', 12, 0, seeded(3)), env = flatEnv({ walkable: () => true });
  let bites = 0; const env2 = { ...env, emit: (n) => { if (n === 'attack') bites++; } };
  a.update(0.05, env2); assert.equal(a.state, 'chase');
  const dmg = sim(a, env2, 5, 0.05);
  assert.ok(dmg >= ANIMALS.bear.dmg * 2 && dmg % ANIMALS.bear.dmg === 0, 'укусил несколько раз: ' + dmg);
  assert.ok(bites <= Math.ceil(5 / ANIMALS.bear.cd) + 1, 'есть перезарядка: ' + bites);
  assert.ok(ANIMALS.bear.chase < CONFIG.runSpeed, 'игрок бегом убегает от медведя');
});
test('кабан мирный, пока его не ударили; потом гонится и кусает, а через время отстаёт', () => {
  const a = new Animal('boar', 4, 0, seeded(4)), env = flatEnv({ walkable: () => true });
  assert.equal(sim(a, env, 6), 0); assert.ok(a.state === 'idle' || a.state === 'walk');
  a.x = 5; a.z = 0; a.hit(1, 0, 0, 0); assert.equal(a.state, 'chase');
  assert.ok(sim(a, env, 4) >= ANIMALS.boar.dmg, 'укусил');
  env.px = 200; // игрок убежал далеко
  sim(a, env, ANIMALS.boar.giveUp / 5 + 20); assert.notEqual(a.state, 'chase');
});
test('раненый олень убегает, а не нападает', () => {
  const a = new Animal('deer', 20, 0, seeded(5)); a.hit(5, 0, 0, 0); assert.equal(a.state, 'flee');
});
test('животные бродят, но не заходят в воду и не уходят далеко от игрока без причины', () => {
  const env = flatEnv({ px: -500, pz: -500 }); // игрок далеко
  for (const type of Object.keys(ANIMALS)) for (let k = 0; k < 6; k++) {
    const a = new Animal(type, 50 + k, k * 3, seeded(k * 11 + 1));
    let moved = 0; const x0 = a.x, z0 = a.z;
    for (let t = 0; t < 120; t += 0.1) { a.update(0.1, env); assert.ok(a.x < 60.01, `${type} вошёл в воду: ${a.x}`); moved = Math.max(moved, Math.hypot(a.x - x0, a.z - z0)); }
    assert.ok(moved > 1, `${type} бродит`);
  }
});
test('убийство: туша лежит, разделка даёт добычу, потом туша исчезает и животное возрождается в другом месте', () => {
  const a = new Animal('boar', 10, 10, seeded(6));
  let spawned = null; const env = flatEnv({ px: -300, pz: -300, walkable: () => true, spawnPoint: () => ({ x: 77, z: -33 }), emit: (n, an) => { if (n === 'respawn') spawned = { x: an.x, z: an.z }; } });
  assert.equal(a.nt, 'animal'); const r = a.hit(ANIMALS.boar.hp, 0, 0, 5); assert.equal(r.killed, true);
  assert.equal(a.nt, 'corpse'); assert.equal(a.update(0.05, env), 0); assert.equal(a.hit(10, 0, 0, 6).killed, false, 'тушу не добить');
  const inv = new Inventory(10); let guard = 0, res; do { res = a.harvest('stone_axe', inv); } while (!res.empty && ++guard < 50);
  assert.ok(res.empty && a.removed); assert.ok(inv.count('bone') >= ANIMALS.boar.loot.bone[0] && inv.count('cloth') >= ANIMALS.boar.loot.cloth[0]);
  assert.ok(inv.count('leather') > 0 && inv.count('fat') > 0);
  sim(a, env, ANIMALS.boar.respawn * 1.3 + 1);
  assert.deepEqual(spawned, { x: 77, z: -33 }); assert.equal(a.removed, false); assert.equal(a.dead, false); assert.equal(a.hp, ANIMALS.boar.hp);
});
test('неразделанная туша сама исчезает через CORPSE_LIFE', () => {
  const a = new Animal('deer', 0, 0, seeded(7)), env = flatEnv({ px: -300, pz: -300 }); a.kill(0);
  sim(a, env, CORPSE_LIFE - 5); assert.equal(a.removed, false); sim(a, env, 10); assert.equal(a.removed, true);
});
test('попадание лучом: тело — капсула вдоль взгляда; мимо и над головой не попадает', () => {
  const a = new Animal('bear', 0, 0, seeded(8)); a.ang = 0; a.y = 2;
  assert.ok(a.contains(0.3, 2.7, 0)); assert.ok(!a.contains(0.3, 5, 0), 'выше'); assert.ok(!a.contains(3, 2.7, 0), 'спереди далеко'); assert.ok(!a.contains(0, 2.7, 2), 'сбоку далеко');
  a.ang = Math.PI / 2; assert.ok(a.contains(0, 2.7, 0.6), 'после поворота тело вдоль Z');
  a.kill(0); assert.ok(a.contains(0, 2.5, 0) && !a.contains(0, 3.5, 0), 'туша ниже');
});
test('pickSpawn: не ближе minDist к игроку', () => {
  const pts = [{ x: 1, z: 1 }, { x: 100, z: 0 }, { x: -90, z: 5 }];
  for (let i = 0; i < 50; i++) { const p = pickSpawn(pts, 0, 0, seeded(i), 45); assert.ok(p && Math.hypot(p.x, p.z) >= 45); }
  assert.equal(pickSpawn([{ x: 1, z: 1 }], 0, 0, seeded(1), 45), null); assert.equal(pickSpawn([], 0, 0), null);
});

// ---------- заправки ----------
test('на острове 4 заправки у кольцевой дороги, далеко друг от друга и от спавна', () => {
  assert.equal(W.stations.length, STATION.count);
  for (const st of W.stations) {
    const f = toWorld(st, 0, STATION.slab.z1);
    assert.ok(T.roadDist(f.x, f.z) < 4, 'фасад у дороги: ' + T.roadDist(f.x, f.z));
    assert.ok(Math.hypot(st.x - W.spawn.x, st.z - W.spawn.z) > 60);
  }
  for (let i = 0; i < W.stations.length; i++) for (let j = i + 1; j < W.stations.length; j++) assert.ok(Math.hypot(W.stations[i].x - W.stations[j].x, W.stations[i].z - W.stations[j].z) > 120);
});
test('заправка стоит на суше, на ровной площадке; на ней нет деревьев, камней и бочек', () => {
  for (const st of W.stations) {
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const w = toWorld(st, STATION.slab.x0 + (STATION.slab.x1 - STATION.slab.x0) * i / 6, STATION.slab.z0 + (STATION.slab.z1 - STATION.slab.z0) * j / 6);
      assert.ok(Math.abs(T.heightAt(w.x, w.z) - st.h) < 0.01, 'площадка ровная');
      assert.ok(T.biomeAt(w.x, w.z) !== 'water');
    }
    assert.ok(T.inStation(st.x, st.z));
  }
  assert.equal(W.objects.filter((o) => T.inStation(o.x, o.z, 2)).length, 0);
  assert.ok(W.objects.every((o) => Math.abs(o.y - T.heightAt(o.x, o.z)) < 1e-9), 'высоты объектов пересчитаны после выравнивания');
});
test('на каждой заправке ящики на площадке; коллизии не закрывают проход к ящикам', () => {
  assert.equal(W.crates.length, STATION.count * STATION.crates.length);
  for (const st of W.stations) {
    assert.equal(st.crates.length, STATION.crates.length);
    for (const c of st.crates) { assert.equal(c.nt, 'crate'); assert.ok(inStation(st, c.x, c.z)); assert.ok(Math.abs(c.y - st.h - 0.1) < 1e-9); }
  }
  for (const [lx, lz] of STATION.crates.map((c) => [c.x, c.z])) for (const [sx, sz, r] of stationSolids()) assert.ok(Math.hypot(lx - sx, lz - sz) > r + 0.65 + 0.4, 'ящик не вплотную к стене'); // между коллайдерами проходит игрок (0.4)
  assert.equal(W.solids.length, STATION.count * stationSolids().length);
  const l = toLocal(W.stations[0], toWorld(W.stations[0], 3, -4).x, toWorld(W.stations[0], 3, -4).z); assert.ok(Math.abs(l.x - 3) < 1e-9 && Math.abs(l.z + 4) < 1e-9, 'toLocal обратно toWorld');
});
test('трава не растёт на площадке заправки', () => {
  const st = W.stations[0], cx0 = Math.floor(st.x / CHUNK), cz0 = Math.floor(st.z / CHUNK);
  for (let cx = cx0 - 2; cx <= cx0 + 2; cx++) for (let cz = cz0 - 2; cz <= cz0 + 2; cz++) {
    const d = buildChunkData(T, cx, cz, 2);
    for (let i = 0; i < d.root.length; i += 9) assert.ok(!T.inStation(d.root[i], d.root[i + 2], 0.2), 'трава на бетоне');
  }
});

// ---------- места обитания животных ----------
test('животные появляются в своих биомах, на суше, не на дороге и не у спавна игрока', () => {
  for (const [type, S] of Object.entries(ANIMALS)) {
    const pts = W.animalSpawns[type]; assert.ok(pts.length >= S.count * 2, `${type}: ${pts.length} точек`);
    for (const p of pts) {
      assert.ok(S.habitat.includes(T.biomeAt(p.x, p.z)), `${type} биом ${T.biomeAt(p.x, p.z)}`);
      assert.ok(T.roadDist(p.x, p.z) >= 8 && Math.hypot(p.x - W.spawn.x, p.z - W.spawn.z) >= 70 && !T.inStation(p.x, p.z, 8));
    }
  }
  assert.ok(Object.values(ANIMALS).reduce((a, S) => a + S.count, 0) >= 20, 'зверей достаточно');
});
console.log(`\n${passed} tests passed`);
