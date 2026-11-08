// Xust — точка входа: игрок, управление (тач + клавиатура/мышь), HUD, меню, настройки, карта, звуки, инвентарь, крафт, печь.
import * as THREE from 'three';
import { CONFIG, ITEMS, RECIPES, ARMOR, ANIMALS, startInventory, craft, Vitals, wearArmor, takeOffArmor, swingRate } from './data.js';
import { World, QUALITY } from './world.js';
import { makeHeld } from './models.js';
import { ROAD_WIDTH } from './terrain.js';
import { S, loadSettings, saveSettings, resetSettings, LAYOUT, LAYOUT_IDS, loadLayout, saveLayout, resetLayout } from './settings.js';
import * as A from './audio.js';
import { drawMap } from './map.js';
import { WEATHER } from './weather.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
loadSettings(); loadLayout();
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[S.quality].pr));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 600);
camera.fov = S.fov;
camera.rotation.order = 'YXZ'; scene.add(camera);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

let dead = false, suicideArm = false, wasGround = true, lastStepN = 0, ambT = 0, amb = { coast: 0, night: 0, biome: 'forest', fire: 0 };
let world, inv, P, sel = 0, swingT = 0, target = null, holdHit = false, held = null, heldId = null, panel = null, curFurnace = null, swapFrom = null, hintTxt = '';
const V = new Vitals(); let lastAttacker = null, vitSig = ''; // здоровье и броня игрока; кто кусал последним
const input = { jx: 0, jy: 0, keys: new Set(), jump: false };
let layoutSel = 'bHit'; // какая кнопка выбрана в режиме расстановки
let aiming = false, hitIcon = ''; // прицел зажат; какая иконка сейчас на кнопке удара
const heldCache = new Map(), fwd = new THREE.Vector3(), dir = new THREE.Vector3();

// ---------- настройки ----------
const VIEW_FAR = [110, 240, 420], pct = (v) => Math.round(v * 100) + '%';
function applySettings() {
  camera.fov = S.fov; camera.updateProjectionMatrix();
  if (world) { world.scene.fog.far = VIEW_FAR[S.view]; world.scene.fog.near = VIEW_FAR[S.view] * 0.22; world.setQuality(S.quality); }
  const pr = Math.min(devicePixelRatio, QUALITY[S.quality].pr);
  if (renderer.getPixelRatio() !== pr) { renderer.setPixelRatio(pr); resize(); }
  document.documentElement.style.setProperty('--bs', S.btn);
  $('stick').classList.toggle('fixed', S.stickFixed);
  A.setVolumes(S); applyLayout();
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1500); }
const slotHTML = (i, extra = '') => {
  const s = inv.slots[i];
  return `<div class="slot ${extra}" data-a="slot" data-i="${i}">${s ? `<span>${ITEMS[s.id].icon}</span>${s.n > 1 ? `<b>${s.n}</b>` : ''}` : ''}</div>`;
};
// однотонные иконки кнопки удара: «удар» и «поставить/надеть»
const ICON_HIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 12 12)"><path d="M3 9C6 4 18 4 21 9"/><path d="M12 6.2V21"/></g></svg>', ICON_USE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>', USE_IDS = new Set(['furnace', 'sleeping_bag', 'bone_armor']);
function renderHotbar() {
  $('hotbar').innerHTML = Array.from({ length: CONFIG.hotbarSize }, (_, i) => slotHTML(i, sel === i ? 'sel' : '')).join('');
  const id = inv.slots[sel]?.id || null;
  if (id !== heldId) {
    if (held) camera.remove(held);
    heldId = id; held = id ? (heldCache.get(id) || (heldCache.set(id, makeHeld(id)), heldCache.get(id))) : null;
    if (held) camera.add(held);
  }
  const ic = USE_IDS.has(id) ? 'use' : 'hit'; // меняем содержимое только при смене иконки, чтобы не сбивать зажатый палец
  if (hitIcon !== ic) { hitIcon = ic; $('bHit').innerHTML = ic === 'use' ? ICON_USE : ICON_HIT; }
}
function setHint() {
  let t = '';
  if (target) {
    const n = target.nt;
    if (n === 'furnace') t = 'Печь — открыть';
    else if (n === 'barrel') t = 'Бочка';
    else if (n === 'crate') t = target.opened ? 'Ящик — пуст' : 'Ящик — открыть';
    else if (n === 'animal') t = `${target.name} · ❤ ${Math.ceil(target.hp)}/${target.S.hp}`;
    else if (n === 'corpse') t = `Туша: ${target.name} · ${Object.entries(target.loot).filter(([, v]) => v > 0).map(([k, v]) => ITEMS[k].icon + v).join(' ')}`;
    else t = `${ITEMS[({ tree: 'wood', stone: 'stone', iron: 'iron_ore', sulfur: 'sulfur_ore' })[n]].name} · осталось ${Math.ceil(target.pool)}`;
  } else if (heldId === 'furnace') t = 'Поставить печь';
  else if (heldId === 'sleeping_bag') t = 'Поставить спальный мешок';
  else if (heldId === 'bone_armor') t = 'Надеть броню';
  if (t !== hintTxt) { hintTxt = t; $('hint').textContent = t; $('hint').classList.toggle('on', !!t); }
}

// ---------- панели ----------
function render() {
  $('hud').classList.toggle('lay', panel === 'layout'); $('panel').classList.toggle('lay', panel === 'layout');
  for (const id of LAYOUT_IDS) $(id).classList.toggle('lsel', panel === 'layout' && layoutSel === id);
  if (!panel) { $('panel').classList.remove('on'); return; }
  $('panel').classList.add('on');
  let h = '';
  if (panel === 'inv') {
    const grid = Array.from({ length: CONFIG.inventorySize }, (_, i) => slotHTML(i, (i < CONFIG.hotbarSize ? 'hb ' : '') + (swapFrom === i ? 'swp' : ''))).join('');
    const recs = Object.entries(RECIPES).map(([id, r]) => {
      const can = Object.entries(r.cost).every(([k, v]) => inv.count(k) >= v);
      const cost = Object.entries(r.cost).map(([k, v]) => `<span class="${inv.count(k) >= v ? '' : 'no'}">${ITEMS[k].icon}${inv.count(k)}/${v}</span>`).join(' ');
      return `<div class="rec"><div>${ITEMS[r.out].icon} ${ITEMS[r.out].name}<small>${cost}</small></div><button class="act" data-a="craft" data-id="${id}" ${can ? '' : 'disabled'}>Создать</button></div>`;
    }).join('');
    const eq = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'wear' && (V.armor === id || inv.count(id))).map((id) => {
      const worn = V.armor === id;
      return `<div class="rec"><div>${ITEMS[id].icon} ${ITEMS[id].name}<small>${worn ? 'надето · защита ' + pct(ARMOR[id].reduce) : 'в рюкзаке'}</small></div>${worn ? '<button class="act" data-a="unwear">Снять</button>' : `<button class="act" data-a="wear" data-id="${id}">Надеть</button>`}</div>`;
    }).join('');
    h = `<div class="card"><div><h3>Инвентарь</h3><div class="grid">${grid}</div></div><div class="col">${eq ? `<h3>Экипировка</h3>${eq}` : ''}<h3>Крафт</h3>${recs}</div><button class="x" data-a="close">✕</button></div>`;
  } else if (panel === 'menu') {
    h = `<div class="card menu"><div class="col"><h3>Xust</h3>
      <button class="act big" data-a="settings">⚙️ Настройки</button>
      <button class="act big" data-a="map">🗺️ Карта</button>
      <button class="act big danger" data-a="suicide">${suicideArm ? '💀 Точно? Инвентарь пропадёт' : '💀 Суицид'}</button>
      <button class="act big" data-a="close">▶️ Продолжить</button></div></div>`;
  } else if (panel === 'settings') {
    const sl = (k, label, min, max, step, fmt) => `<label class="row"><span>${label}</span><b id="v_${k}">${fmt(S[k])}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"></label>`;
    const tg = (k, label) => `<div class="row"><span>${label}</span><button class="act ${S[k] ? '' : 'off'}" data-a="tog" data-k="${k}">${S[k] ? 'Вкл' : 'Выкл'}</button></div>`;
    const viewName = ['Близко', 'Средне', 'Далеко'];
    h = `<div class="card sett"><div class="col"><h3>Звук</h3>
      ${sl('master', 'Общая громкость', 0, 1, 0.05, pct)}${sl('sfx', 'Звуки действий', 0, 1, 0.05, pct)}${sl('amb', 'Окружение', 0, 1, 0.05, pct)}
      <h3>Графика</h3>${sl('quality', 'Качество (тени, трава)', 0, 2, 1, (v) => QUALITY[v].name)}${sl('fov', 'Угол обзора', 60, 100, 1, (v) => v + '°')}${sl('view', 'Дальность', 0, 2, 1, (v) => viewName[v])}</div>
      <div class="col"><h3>Управление</h3>
      ${sl('sens', 'Чувствительность камеры', 0.3, 2.5, 0.05, (v) => '×' + v.toFixed(2))}${sl('btn', 'Размер кнопок', 0.8, 1.3, 0.05, pct)}
      ${tg('invY', 'Инвертировать вертикаль')}${tg('stickFixed', 'Джойстик на одном месте')}${tg('autoRun', 'Всегда бегать')}<button class="act" data-a="layout" style="margin:2px 0 8px">Расположение и размер кнопок</button>
      <small class="help">Телефон: слева джойстик (до упора — бег), справа камера. кнопки: удар, прицел (зажать — приближение), прыжок, присесть, рюкзак, меню. Палец, зажавший удар, прицел или прыжок, можно вести по экрану — камера поворачивается.<br>ПК: WASD, Shift бег, Space прыжок, C присесть, ЛКМ/E удар, I инвентарь, M карта, Esc меню, 1–6 хотбар, Z прицел.</small></div>
      <div class="col"><button class="x" data-a="menu">← Назад</button><br><br><button class="x" data-a="reset">Сбросить</button></div></div>`;
  } else if (panel === 'layout') {
    const nm = { bHit: 'Удар', bAim: 'Прицел', bJump: 'Прыжок', bCrouch: 'Присесть', bInv: 'Рюкзак', bMenu: 'Меню' }, cur = LAYOUT[layoutSel]?.s ?? 1;
    h = `<div class="card"><div class="col" style="min-width:140px"><h3>Кнопки</h3><small class="help">Коснись кнопки и перетащи.<br>Выбрана: <b style="color:var(--amber)">${nm[layoutSel]}</b></small></div>
      <label class="row" style="min-width:190px;margin:0"><span>Размер</span><b id="v_lsize">×${cur.toFixed(2)}</b><input type="range" data-k="lsize" min="0.5" max="2" step="0.05" value="${cur}"></label>
      <div class="col" style="min-width:0;gap:6px"><button class="x" data-a="lreset">Сбросить кнопку</button><button class="x" data-a="lresetall">Сбросить все</button><button class="act" data-a="ldone">Готово</button></div></div>`;
  } else if (panel === 'map') {
    const side = Math.max(220, Math.min(Math.floor(innerHeight * 0.78), Math.floor(innerWidth * 0.62), 520));
    h = `<div class="card"><canvas id="mapc" width="${side}" height="${side}" style="width:${side}px;height:${side}px;border-radius:10px"></canvas>
      <div class="col" style="min-width:120px"><h3>Карта</h3><small class="help">🔴 вы<br>🟧 ваша печь<br>⛽ заправка (лут)<br>🛏️ спальный мешок<br>⬜ снег · 🟨 пустыня<br>🟩 лес · ▫️ серая дорога</small><br><br><button class="x" data-a="menu">← Назад</button></div></div>`;
  } else {
    const f = curFurnace.furnace, ld = (id, label) => `<button class="act" data-a="load" data-id="${id}" ${inv.count(id) ? '' : 'disabled'}>+ ${label} (${inv.count(id)})</button>`;
    h = `<div class="card"><div class="col"><h3>Печь ${f.active ? '🔥 плавит' : ''}</h3>
      <div class="rec">🪵 Топливо: ${f.fuel}</div><div class="rec">🟤 Железная руда: ${f.ore.iron_ore}</div><div class="rec">🟡 Серная руда: ${f.ore.sulfur_ore}</div>
      <div class="rec">Готово: 🔩 ${f.out.metal} · 💛 ${f.out.sulfur}</div></div>
      <div class="col"><h3>Загрузить всё</h3>${ld('wood', 'Дерево')}<br><br>${ld('iron_ore', 'Железная руда')}<br><br>${ld('sulfur_ore', 'Серная руда')}<br><br>
      <button class="act" data-a="collect" ${f.out.metal + f.out.sulfur ? '' : 'disabled'}>Забрать готовое</button></div><button class="x" data-a="close">✕</button></div>`;
  }
  $('panel').innerHTML = h;
  if (panel === 'map') drawMap($('mapc'), world, P);
}
function openPanel(p, f) {
  if (p !== 'menu') suicideArm = false;
  panel = p; curFurnace = f || null; swapFrom = null; releaseAll();
  if (document.pointerLockElement) document.exitPointerLock();
  render();
}
const closePanel = () => { suicideArm = false; panel = null; curFurnace = null; swapFrom = null; render(); renderHotbar(); };
$('panel').addEventListener('click', (e) => {
  if (e.target === $('panel')) return closePanel();
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === 'close') { A.sfx('click'); return closePanel(); }
  if (a === 'menu') { A.sfx('click'); return openPanel('menu'); }
  if (a === 'settings' || a === 'map') { A.sfx('click'); return openPanel(a); }
  if (a === 'suicide') { if (!suicideArm) { suicideArm = true; A.sfx('deny'); return render(); } return die(); }
  if (a === 'tog') { S[b.dataset.k] = !S[b.dataset.k]; saveSettings(); applySettings(); A.sfx('click'); return render(); }
  if (a === 'reset') { resetSettings(); applySettings(); A.sfx('click'); return render(); }
  if (a === 'layout') { A.sfx('click'); return openPanel('layout'); }
  if (a === 'ldone') { A.sfx('click'); saveLayout(); return openPanel('settings'); }
  if (a === 'lreset') { delete LAYOUT[layoutSel]; saveLayout(); applyLayout(); A.sfx('click'); return render(); }
  if (a === 'lresetall') { resetLayout(); applyLayout(); A.sfx('click'); return render(); }
  if (a === 'slot') { const i = +b.dataset.i; if (swapFrom === null) { if (inv.slots[i]) swapFrom = i; } else { inv.swap(swapFrom, i); swapFrom = null; } }
  if (a === 'craft') { const r = craft(inv, id); A.sfx(r.ok ? 'craft' : 'deny'); toast(r.ok ? `Создано: ${ITEMS[id].name}` : r.reason === 'full' ? 'Инвентарь полон' : 'Не хватает ресурсов'); }
  if (a === 'wear' || a === 'unwear') {
    const r = a === 'wear' ? wearArmor(V, inv, id) : takeOffArmor(V, inv);
    A.sfx(r.ok ? 'equip' : 'deny'); toast(r.ok ? (a === 'wear' ? `Надето: ${ITEMS[id].name}` : 'Броня снята') : r.reason === 'full' ? 'Инвентарь полон' : 'Не получилось');
    renderVitals(true);
  }
  if (a === 'load') { curFurnace.furnace.load(inv, id); A.sfx('click'); }
  if (a === 'collect') { curFurnace.furnace.collect(inv); A.sfx('pickup'); }
  render(); renderHotbar();
});
// ползунки настроек: не перерисовываем панель, чтобы палец не «терял» ползунок
$('panel').addEventListener('input', (e) => {
  if (e.target.dataset?.k === 'lsize') { const v = +e.target.value; setBtnScale(layoutSel, v); $('v_lsize').textContent = '×' + v.toFixed(2); return; }
  const k = e.target.dataset?.k; if (!k || e.target.type !== 'range') return;
  S[k] = +e.target.value; if (k === 'view' || k === 'quality') S[k] = Math.round(S[k]);
  const lab = $('v_' + k), v = S[k];
  lab.textContent = k === 'fov' ? v + '°' : k === 'quality' ? QUALITY[v].name : k === 'view' ? ['Близко', 'Средне', 'Далеко'][v] : k === 'sens' ? '×' + v.toFixed(2) : pct(v);
  applySettings();
});
$('panel').addEventListener('change', (e) => { if (e.target.type === 'range') { saveSettings(); saveLayout(); A.sfx('click'); } });

// ---------- смерть («Суицид» из меню) ----------
function die(killer) {
  suicideArm = false; panel = null; render(); dead = true; releaseAll();
  A.sfx('die'); $('death').textContent = killer ? `ВАС УБИЛ ${killer.name.toUpperCase()}` : 'ВЫ ПОГИБЛИ'; $('death').classList.add('on');
  setTimeout(() => {
    inv = startInventory(); sel = 0; V.hp = CONFIG.maxHp; V.armor = null; V.sinceHit = 99; lastAttacker = null;
    const b = world.bag, sp = b ? { x: b.x, y: b.y, z: b.z, yaw: P.yaw } : world.spawn; // со спальным мешком возрождаемся возле него
    P.pos.set(sp.x, sp.y, sp.z); P.yaw = sp.yaw; P.pitch = -0.05; P.vy = 0; P.ground = true; P.crouch = false; $('bCrouch').classList.remove('on');
    renderHotbar(); renderVitals(true); $('death').classList.remove('on'); dead = false; A.sfx('spawn'); toast(b ? 'Вы возродились у спального мешка' : 'Вы возродились на берегу');
  }, 1800);
}
// здоровье: полоска, число, значок брони
function renderVitals(force) {
  const sig = Math.ceil(V.hp) + '|' + V.armor;
  if (!force && sig === vitSig) return; vitSig = sig;
  const pctHp = Math.max(0, V.hp) / CONFIG.maxHp;
  $('hpbar').firstElementChild.style.width = pctHp * 100 + '%';
  $('hpbar').classList.toggle('low', pctHp < 0.3);
  $('hpn').textContent = Math.ceil(V.hp);
  $('armor').textContent = V.armor ? ITEMS[V.armor].icon : '';
}
function hurtPlayer(n, by) {
  const d = V.hurt(n); A.sfx('hurt'); renderVitals();
  const f = $('hurt'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); // красная вспышка по краям экрана
  if (V.dead) die(by);
  return d;
}

// ---------- действия ----------
function act() {
  if (panel || dead) return;
  if (target?.nt === 'furnace') { A.sfx('click'); return openPanel('furnace', target); }
  if (target?.nt === 'crate') { // ящик на заправке: забираем содержимое
    holdHit = false;
    const r = world.lootCrate(target, inv); toast(r.msg); A.sfx(r.ok ? 'crate' : 'deny'); if (r.ok) renderHotbar(); return;
  }
  if (heldId === 'sleeping_bag') {
    holdHit = false;
    const x = P.pos.x + fwd.x * 2.2, z = P.pos.z + fwd.z * 2.2;
    if (!world.canPlace(x, z)) { A.sfx('deny'); return toast('Сюда не поставить'); }
    inv.remove('sleeping_bag', 1); world.placeBag(x, z, P.yaw); toast('Спальный мешок поставлен — вы возродитесь здесь'); A.sfx('place'); return renderHotbar();
  }
  if (heldId === 'bone_armor') {
    holdHit = false;
    const r = wearArmor(V, inv, 'bone_armor'); A.sfx(r.ok ? 'equip' : 'deny'); toast(r.ok ? 'Костяная броня надета' : r.reason === 'full' ? 'Инвентарь полон' : 'Не получилось');
    renderVitals(true); return renderHotbar();
  }
  if (heldId === 'furnace') {
    holdHit = false;
    const x = P.pos.x + fwd.x * 2.4, z = P.pos.z + fwd.z * 2.4;
    if (!world.canPlace(x, z)) { A.sfx('deny'); return toast('Сюда не поставить'); }
    inv.remove('furnace', 1); world.addFurnace(x, z, P.yaw + Math.PI); toast('Печь установлена'); A.sfx('place'); return renderHotbar();
  }
  if (swingT > 0) return;
  swingT = 1;
  if (!target) return A.sfx('swing');
  if (target.nt === 'animal') { // бьём животное
    const r = world.hitAnimal(target, heldId, P.pos.x, P.pos.z); toast(r.msg);
    A.sfx(r.killed ? 'kill' : 'hitFlesh'); if (!r.killed && target.type !== 'deer' && Math.random() < 0.4) A.sfx(target.type === 'bear' ? 'growl' : 'squeal');
    return;
  }
  if (target.nt === 'corpse') { // разделываем тушу
    const r = world.harvestCorpse(target, heldId, inv); toast(r.msg); A.sfx(r.ok ? 'pickup' : 'deny'); if (r.ok) renderHotbar(); return;
  }
  const nt = target.nt, r = world.harvest(target, heldId, inv); toast(r.msg);
  if (r.ok) renderHotbar();
  if (nt !== 'barrel' && !r.ok) A.sfx('deny');             // нет инструмента / инвентарь полон
  else if (target.dead) A.sfx('break');                    // объект выработан
  else A.sfx(nt === 'tree' ? 'hitWood' : nt === 'stone' ? 'hitStone' : nt === 'barrel' ? 'hitMetal' : 'hitOre');
}

// ---------- ввод ----------
const zone = $('zone'); let joy = null, look = null;
const stickEl = $('stick'), knob = stickEl.firstElementChild;
const showStick = (x, y) => { stickEl.style.display = 'block'; stickEl.style.left = x + 'px'; stickEl.style.top = y + 'px'; };
const hideStick = () => { stickEl.style.display = 'none'; knob.style.transform = ''; };
zone.addEventListener('pointerdown', (e) => {
  A.unlock(); lockLandscape();
  if (panel || dead) return;
  if (e.pointerType !== 'touch') { if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); return; }
  if (joy && !zone.hasPointerCapture(joy.id)) { joy = null; input.jx = input.jy = 0; hideStick(); } // палец уже убран, а pointerup не пришёл
  if (look && !zone.hasPointerCapture(look.id)) look = null;
  zone.setPointerCapture(e.pointerId);
  if (e.clientX < innerWidth * 0.45 && !joy) {
    const ox = S.stickFixed ? 135 : e.clientX, oy = S.stickFixed ? innerHeight - 115 : e.clientY;
    joy = { id: e.pointerId, ox, oy }; showStick(ox, oy); moveStick(e);
  } else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
function moveStick(e) {
  const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, a = Math.atan2(dy, dx);
  let m = Math.min(1, Math.hypot(dx, dy) / 55); m = m < 0.12 ? 0 : (m - 0.12) / 0.88; // мёртвая зона
  input.jx = Math.cos(a) * m; input.jy = Math.sin(a) * m;
  knob.style.transform = `translate(${Math.cos(a) * m * 40}px,${Math.sin(a) * m * 40}px)`;
}
zone.addEventListener('pointermove', (e) => {
  if (joy && e.pointerId === joy.id) moveStick(e);
  else if (look && e.pointerId === look.id) {
    lookBy(e.clientX - look.x, e.clientY - look.y); look.x = e.clientX; look.y = e.clientY;
  }
});
const endPtr = (e) => {
  if (joy && e.pointerId === joy.id) { joy = null; input.jx = input.jy = 0; hideStick(); }
  if (look && e.pointerId === look.id) look = null;
  if (e.pointerType !== 'touch') holdHit = false;
};
for (const t of ['pointerup', 'pointercancel']) { zone.addEventListener(t, endPtr); addEventListener(t, endPtr, true); } // и на уровне окна: палец отпущен где угодно
zone.addEventListener('lostpointercapture', endPtr);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) lookBy(e.movementX, e.movementY, 0.0025); });
// lookable: палец, зажавший кнопку, можно вести по экрану — камера поворачивается (как кнопка огня в мобильных шутерах)
const press = (id, on, off, lookable) => {
  const b = $(id); let lk = null;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); if (panel === 'layout') return; on();
    if (lookable && e.pointerType === 'touch') { try { b.setPointerCapture(e.pointerId); } catch { /* ok */ } lk = { id: e.pointerId, x: e.clientX, y: e.clientY }; }
  });
  b.addEventListener('pointermove', (e) => { if (lk && e.pointerId === lk.id && !panel && !dead) { lookBy(e.clientX - lk.x, e.clientY - lk.y); lk.x = e.clientX; lk.y = e.clientY; } });
  const up = (e) => { if (lk && e.pointerId === lk.id) lk = null; off?.(); };
  for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) b.addEventListener(t, up);
};
press('bHit', () => { A.unlock(); holdHit = true; }, () => { holdHit = false; }, true);
press('bJump', () => { input.jump = true; }, () => { input.jump = false; }, true);
press('bAim', () => { aiming = true; }, () => { aiming = false; }, true);
press('bCrouch', () => { if (panel || dead) return; P.crouch = !P.crouch; $('bCrouch').classList.toggle('on', P.crouch); A.sfx('click'); });
press('bInv', () => { A.unlock(); A.sfx('click'); openPanel('inv'); });
press('bMenu', () => { A.unlock(); A.sfx('click'); openPanel('menu'); });

// ---------- расположение и размер кнопок ----------
function applyLayout() {
  for (const id of LAYOUT_IDS) {
    const st = $(id).style, L = LAYOUT[id];
    if (!L) { st.left = st.top = st.right = st.bottom = st.transform = st.transformOrigin = ''; continue; } // стандартное место из CSS
    st.left = L.x * 100 + '%'; st.top = L.y * 100 + '%'; st.right = 'auto'; st.bottom = 'auto';
    st.transformOrigin = 'center'; st.transform = `translate(-50%,-50%) scale(${(S.btn * L.s).toFixed(3)})`;
  }
}
function ensureLayout(id) { // первое касание: запоминаем, где кнопка стоит сейчас
  if (LAYOUT[id]) return LAYOUT[id];
  const r = $(id).getBoundingClientRect();
  return (LAYOUT[id] = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, s: 1 });
}
function setBtnScale(id, s) { ensureLayout(id).s = Math.min(2, Math.max(0.5, s)); applyLayout(); }
for (const id of LAYOUT_IDS) {
  const el = $(id); let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (panel !== 'layout') return;
    e.preventDefault(); e.stopPropagation();
    const L = ensureLayout(id); layoutSel = id; el.setPointerCapture(e.pointerId);
    drag = { dx: e.clientX / innerWidth - L.x, dy: e.clientY / innerHeight - L.y }; applyLayout(); render();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return; const L = LAYOUT[id];
    L.x = Math.min(0.97, Math.max(0.03, e.clientX / innerWidth - drag.dx)); L.y = Math.min(0.95, Math.max(0.05, e.clientY / innerHeight - drag.dy)); applyLayout();
  });
  const end = () => { if (drag) { drag = null; saveLayout(); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
// горизонтальная ориентация: в APK её задаёт манифест, в браузере пробуем заблокировать (работает в полноэкранном режиме)
function lockLandscape() { try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch { /* не поддерживается */ } }
// поворот камеры: одним местом для пальца на экране, пальца на кнопке и мыши; при приближении вращается медленнее
function lookBy(dx, dy, k = 0.006) {
  if (!P) return;
  const z = k * S.sens * (camera.fov / S.fov);
  P.yaw -= dx * z; P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch - dy * z * (S.invY ? -1 : 1)));
}
// сброс всего «зажатого»: при открытии панели, смерти и уходе из приложения
function releaseAll() {
  joy = null; look = null; holdHit = false; aiming = false; input.jump = false; input.jx = input.jy = 0; hideStick();
}
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
$('clock').addEventListener('pointerdown', (e) => { e.stopPropagation(); world.wx.cycle(); }); // тап по часам листает погоду (для проверки)
$('hotbar').addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-i]'); if (b) { sel = +b.dataset.i; renderHotbar(); A.sfx('click'); } });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code; input.keys.add(k); A.unlock();
  if (dead) return;
  if (k === 'Tab' || k === 'KeyI') { e.preventDefault(); panel ? closePanel() : openPanel('inv'); }
  else if (k === 'KeyM') panel === 'map' ? closePanel() : openPanel('map');
  else if (k === 'KeyC' && !panel) { P.crouch = !P.crouch; $('bCrouch').classList.toggle('on', P.crouch); }
  else if (k === 'Escape') { if (panel === 'layout') { saveLayout(); openPanel('settings'); } else if (panel === 'settings' || panel === 'map') openPanel('menu'); else if (panel) closePanel(); }
  else if (k === 'KeyE') act();
  else if (k === 'KeyZ' && !panel) aiming = true;
  else if (/^Digit[1-6]$/.test(k)) { sel = +k[5] - 1; renderHotbar(); A.sfx('click'); }
});
addEventListener('keyup', (e) => { input.keys.delete(e.code); if (e.code === 'KeyZ') aiming = false; });
// Esc при захваченной мыши браузер «съедает» — открываем меню по выходу из захвата
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && !panel && !dead && world) openPanel('menu'); });
addEventListener('wheel', (e) => { if (!panel) { sel = (sel + (e.deltaY > 0 ? 1 : 5)) % CONFIG.hotbarSize; renderHotbar(); } });
addEventListener('mousedown', (e) => { if (panel || document.pointerLockElement !== canvas) return; if (e.button === 0) holdHit = true; else if (e.button === 2) act(); });
addEventListener('mouseup', (e) => { if (e.button === 0) holdHit = false; });
addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- игровой цикл ----------
function movePlayer(dt) {
  const K = input.keys;
  let mx = input.jx + (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0), mz = -input.jy + (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0);
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const crouch = P.crouch || K.has('ControlLeft'), run = !crouch && (K.has('ShiftLeft') || Math.hypot(input.jx, input.jy) > 0.95 || (S.autoRun && len > 0.05)), sp = crouch ? CONFIG.walkSpeed * 0.5 : (run ? CONFIG.runSpeed : CONFIG.walkSpeed);
  P.hT = crouch ? 1.05 : CONFIG.playerHeight;
  const s = Math.sin(P.yaw), c = Math.cos(P.yaw), ox = P.pos.x, oz = P.pos.z, oy = P.pos.y;
  P.pos.x += (c * mx - s * mz) * sp * dt; P.pos.z += (-s * mx - c * mz) * sp * dt;
  world.collidePlayer(P.pos, CONFIG.playerRadius);
  const gh = world.groundHeight(P.pos.x, P.pos.z);
  if (gh < -0.5 || gh - oy > 0.25 + Math.hypot(P.pos.x - ox, P.pos.z - oz) * 1.6) { P.pos.x = ox; P.pos.z = oz; } // вода и слишком крутой склон
  if (P.ground && !crouch && (input.jump || K.has('Space'))) { P.vy = CONFIG.jumpSpeed; P.ground = false; A.sfx('jump'); }
  if (!P.ground) { P.vy -= CONFIG.gravity * dt; P.pos.y += P.vy * dt; }
  const g = world.groundHeight(P.pos.x, P.pos.z);
  if (P.pos.y <= g || (P.ground && P.pos.y - g < 0.45)) { P.pos.y = g; P.vy = 0; P.ground = true; } else P.ground = false;
  P.bob += Math.hypot(P.pos.x - ox, P.pos.z - oz) * 2.2;
  // приземление и шаги
  if (P.ground && !wasGround) A.sfx('land');
  wasGround = P.ground;
  const sn = Math.floor(P.bob / Math.PI);
  if (sn !== lastStepN) { lastStepN = sn; if (P.ground && !crouch) { const b = world.T.biomeAt(P.pos.x, P.pos.z); A.step(world.T.roadDist(P.pos.x, P.pos.z) < ROAD_WIDTH * 0.6 ? 'road' : b === 'forest' ? 'grass' : b === 'winter' ? 'snow' : 'sand'); } }
}
let last = 0, furSig = '';
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!panel && !dead) movePlayer(dt);
  P.h += (P.hT - P.h) * Math.min(1, dt * 10);
  const tf = S.fov * (aiming ? 0.45 : 1); // прицел: плавное приближение
  if (Math.abs(camera.fov - tf) > 0.05) { camera.fov += (tf - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); } else if (camera.fov !== tf) { camera.fov = tf; camera.updateProjectionMatrix(); }
  $('cross').classList.toggle('aim', aiming);
  const bite = world.update(dt, P.pos, { sneak: P.crouch || input.keys.has('ControlLeft') });
  if (!dead) { V.update(dt); if (bite > 0) hurtPlayer(bite, lastAttacker); renderVitals(); }
  camera.position.set(P.pos.x, P.pos.y + P.h + (P.ground ? Math.sin(P.bob) * 0.04 : 0), P.pos.z);
  camera.rotation.set(P.pitch, P.yaw, 0);
  camera.getWorldDirection(dir); fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  target = panel ? null : world.pick(camera.position, dir, CONFIG.reach);
  setHint();
  if ((ambT -= dt) < 0) { // окружение обновляем 5 раз в секунду
    ambT = 0.2;
    const gh = world.groundHeight(P.pos.x, P.pos.z); let fire = 0;
    for (const f of world.furnaces) if (f.furnace.active) fire = Math.max(fire, 1 - Math.hypot(f.x - P.pos.x, f.z - P.pos.z) / 12);
    amb = { coast: Math.max(0, Math.min(1, 1 - (gh - 0.8) / 3.5)), night: world.night, biome: world.T.biomeAt(P.pos.x, P.pos.z), fire: Math.max(0, fire) };
  }
  A.ambience(dt, amb);
  if (holdHit && swingT <= 0) act();
  swingT = Math.max(0, swingT - dt * swingRate(heldId));
  if (held) {
    const sw = Math.sin((1 - swingT) * Math.PI) * (swingT > 0 ? 1 : 0);
    held.position.set(0.4, -0.38 + Math.sin(P.bob * 2) * 0.006, -0.7 + sw * -0.12); held.rotation.set(0.15 - sw * 1.0, -0.35, 0.12);
    if (held.userData.light) { held.userData.light.intensity = 1.3 + 0.4 * Math.random() + world.night * 0.6; held.userData.flame.scale.setScalar(0.9 + Math.random() * 0.25); }
  }
  if (curFurnace) { if (Math.hypot(curFurnace.x - P.pos.x, curFurnace.z - P.pos.z) > 6) closePanel(); else { const f = curFurnace.furnace, sg = [f.fuel, f.ore.iron_ore, f.ore.sulfur_ore, f.out.metal, f.out.sulfur, f.active].join(); if (sg !== furSig) { furSig = sg; render(); } } }
  const hr = world.tod * 24; $('clock').textContent = `${String((hr | 0) % 24).padStart(2, '0')}:${String(((hr % 1) * 60) | 0).padStart(2, '0')} ${world.night > 0.5 ? '🌙' : '☀️'} ${WEATHER[world.wx.kind].icon}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// мир строится синхронно — даём браузеру показать экран загрузки
requestAnimationFrame(() => setTimeout(() => {
  world = new World(scene); inv = startInventory();
  const sp = world.spawn;
  P = { pos: new THREE.Vector3(sp.x, sp.y, sp.z), vy: 0, yaw: sp.yaw, pitch: -0.05, ground: true, bob: 0, crouch: false, h: CONFIG.playerHeight, hT: CONFIG.playerHeight };
  world.onEvent = (name, a) => { if (name === 'attack') lastAttacker = a; else if (name === 'growl') A.sfx('growl'); };
  applySettings();
  renderHotbar(); renderVitals(true); $('load').remove(); last = performance.now(); requestAnimationFrame(frame);
}, 40));
