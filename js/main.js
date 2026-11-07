// Точка входа: игрок, управление (тач + клавиатура/мышь), HUD, инвентарь, крафт, печь.
import * as THREE from 'three';
import { CONFIG, ITEMS, RECIPES, SMELT, startInventory, craft } from './data.js';
import { World } from './world.js';
import { makeHeld } from './models.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 600);
camera.rotation.order = 'YXZ'; scene.add(camera);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

let world, inv, P, sel = 0, swingT = 0, target = null, holdHit = false, held = null, heldId = null, panel = null, curFurnace = null, swapFrom = null, hintTxt = '';
const input = { jx: 0, jy: 0, keys: new Set(), jump: false };
const heldCache = new Map(), fwd = new THREE.Vector3(), dir = new THREE.Vector3();

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1500); }
const slotHTML = (i, extra = '') => {
  const s = inv.slots[i];
  return `<div class="slot ${extra}" data-a="slot" data-i="${i}">${s ? `<span>${ITEMS[s.id].icon}</span>${s.n > 1 ? `<b>${s.n}</b>` : ''}` : ''}${i < CONFIG.hotbarSize ? `<i>${i + 1}</i>` : ''}</div>`;
};
function renderHotbar() {
  $('hotbar').innerHTML = Array.from({ length: CONFIG.hotbarSize }, (_, i) => slotHTML(i, sel === i ? 'sel' : '')).join('');
  const id = inv.slots[sel]?.id || null;
  if (id !== heldId) {
    if (held) camera.remove(held);
    heldId = id; held = id ? (heldCache.get(id) || (heldCache.set(id, makeHeld(id)), heldCache.get(id))) : null;
    if (held) camera.add(held);
  }
  $('bHit').textContent = id === 'furnace' ? '🧱' : id === 'stone_axe' ? '🪓' : id === 'rock' ? '🪨' : id === 'torch' ? '🔥' : '⛏️';
}
function setHint() {
  let t = '';
  if (target) {
    const n = target.nt;
    t = n === 'furnace' ? 'Печь — открыть' : n === 'barrel' ? 'Бочка' : `${ITEMS[({ tree: 'wood', stone: 'stone', iron: 'iron_ore', sulfur: 'sulfur_ore' })[n]].name} · осталось ${Math.ceil(target.pool)}`;
  } else if (heldId === 'furnace') t = 'Поставить печь';
  if (t !== hintTxt) { hintTxt = t; $('hint').textContent = t; $('hint').classList.toggle('on', !!t); }
}

// ---------- панели ----------
function render() {
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
    h = `<div class="card"><div><h3>Инвентарь</h3><div class="grid">${grid}</div></div><div class="col"><h3>Крафт</h3>${recs}</div><button class="x" data-a="close">✕</button></div>`;
  } else {
    const f = curFurnace.furnace, ld = (id, label) => `<button class="act" data-a="load" data-id="${id}" ${inv.count(id) ? '' : 'disabled'}>+ ${label} (${inv.count(id)})</button>`;
    h = `<div class="card"><div class="col"><h3>Печь ${f.active ? '🔥 плавит' : ''}</h3>
      <div class="rec">🪵 Топливо: ${f.fuel}</div><div class="rec">🟤 Железная руда: ${f.ore.iron_ore}</div><div class="rec">🟡 Серная руда: ${f.ore.sulfur_ore}</div>
      <div class="rec">Готово: 🔩 ${f.out.metal} · 💛 ${f.out.sulfur}</div></div>
      <div class="col"><h3>Загрузить всё</h3>${ld('wood', 'Дерево')}<br><br>${ld('iron_ore', 'Железная руда')}<br><br>${ld('sulfur_ore', 'Серная руда')}<br><br>
      <button class="act" data-a="collect" ${f.out.metal + f.out.sulfur ? '' : 'disabled'}>Забрать готовое</button></div><button class="x" data-a="close">✕</button></div>`;
  }
  $('panel').innerHTML = h;
}
function openPanel(p, f) {
  panel = p; curFurnace = f || null; swapFrom = null; holdHit = false; input.jx = input.jy = 0; $('stick').style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  render();
}
const closePanel = () => { panel = null; curFurnace = null; swapFrom = null; render(); renderHotbar(); };
$('panel').addEventListener('click', (e) => {
  if (e.target === $('panel')) return closePanel();
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === 'close') return closePanel();
  if (a === 'slot') { const i = +b.dataset.i; if (swapFrom === null) { if (inv.slots[i]) swapFrom = i; } else { inv.swap(swapFrom, i); swapFrom = null; } }
  if (a === 'craft') { const r = craft(inv, id); toast(r.ok ? `Создано: ${ITEMS[id].name}` : r.reason === 'full' ? 'Инвентарь полон' : 'Не хватает ресурсов'); }
  if (a === 'load') curFurnace.furnace.load(inv, id);
  if (a === 'collect') curFurnace.furnace.collect(inv);
  render(); renderHotbar();
});

// ---------- действия ----------
function act() {
  if (panel) return;
  if (target?.nt === 'furnace') return openPanel('furnace', target);
  if (heldId === 'furnace') {
    holdHit = false;
    const x = P.pos.x + fwd.x * 2.4, z = P.pos.z + fwd.z * 2.4;
    if (!world.canPlace(x, z)) return toast('Сюда не поставить');
    inv.remove('furnace', 1); world.addFurnace(x, z, P.yaw + Math.PI); toast('Печь установлена'); return renderHotbar();
  }
  if (swingT > 0) return;
  swingT = 1;
  if (target) { const r = world.harvest(target, heldId, inv); toast(r.msg); if (r.ok) renderHotbar(); }
}

// ---------- ввод ----------
const zone = $('zone'); let joy = null, look = null;
zone.addEventListener('pointerdown', (e) => {
  if (panel) return;
  if (e.pointerType !== 'touch') { if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); return; }
  zone.setPointerCapture(e.pointerId);
  if (e.clientX < innerWidth * 0.45 && !joy) { joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY }; const s = $('stick'); s.style.display = 'block'; s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; }
  else if (!look) look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
zone.addEventListener('pointermove', (e) => {
  if (joy && e.pointerId === joy.id) {
    const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, m = Math.min(1, Math.hypot(dx, dy) / 55), a = Math.atan2(dy, dx);
    input.jx = Math.cos(a) * m; input.jy = Math.sin(a) * m;
    $('stick').firstElementChild.style.transform = `translate(${Math.cos(a) * m * 40}px,${Math.sin(a) * m * 40}px)`;
  } else if (look && e.pointerId === look.id) {
    P.yaw -= (e.clientX - look.x) * 0.006; P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch - (e.clientY - look.y) * 0.006)); look.x = e.clientX; look.y = e.clientY;
  }
});
const endPtr = (e) => {
  if (joy && e.pointerId === joy.id) { joy = null; input.jx = input.jy = 0; $('stick').style.display = 'none'; $('stick').firstElementChild.style.transform = ''; }
  if (look && e.pointerId === look.id) look = null;
  if (e.pointerType !== 'touch') holdHit = false;
};
zone.addEventListener('pointerup', endPtr); zone.addEventListener('pointercancel', endPtr);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { P.yaw -= e.movementX * 0.0025; P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch - e.movementY * 0.0025)); } });
const press = (id, on, off) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); }); for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, () => off?.()); };
press('bHit', () => { holdHit = true; }, () => { holdHit = false; });
press('bJump', () => { input.jump = true; }, () => { input.jump = false; });
press('bInv', () => openPanel('inv'));
$('hotbar').addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-i]'); if (b) { sel = +b.dataset.i; renderHotbar(); } });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code; input.keys.add(k);
  if (k === 'Tab' || k === 'KeyI') { e.preventDefault(); panel ? closePanel() : openPanel('inv'); }
  else if (k === 'Escape' && panel) closePanel();
  else if (k === 'KeyE') act();
  else if (/^Digit[1-6]$/.test(k)) { sel = +k[5] - 1; renderHotbar(); }
});
addEventListener('keyup', (e) => input.keys.delete(e.code));
addEventListener('wheel', (e) => { if (!panel) { sel = (sel + (e.deltaY > 0 ? 1 : 5)) % CONFIG.hotbarSize; renderHotbar(); } });
addEventListener('mousedown', (e) => { if (panel || document.pointerLockElement !== canvas) return; if (e.button === 0) holdHit = true; else if (e.button === 2) act(); });
addEventListener('mouseup', (e) => { if (e.button === 0) holdHit = false; });
addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- игровой цикл ----------
function movePlayer(dt) {
  const K = input.keys;
  let mx = input.jx + (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0), mz = -input.jy + (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0);
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const run = K.has('ShiftLeft') || Math.hypot(input.jx, input.jy) > 0.95, sp = (run ? CONFIG.runSpeed : CONFIG.walkSpeed);
  const s = Math.sin(P.yaw), c = Math.cos(P.yaw), ox = P.pos.x, oz = P.pos.z, oy = P.pos.y;
  P.pos.x += (c * mx - s * mz) * sp * dt; P.pos.z += (-s * mx - c * mz) * sp * dt;
  world.collide(P.pos, CONFIG.playerRadius);
  const gh = world.groundHeight(P.pos.x, P.pos.z);
  if (gh < -0.5 || gh - oy > 0.25 + Math.hypot(P.pos.x - ox, P.pos.z - oz) * 1.6) { P.pos.x = ox; P.pos.z = oz; } // вода и слишком крутой склон
  if (P.ground && (input.jump || K.has('Space'))) { P.vy = CONFIG.jumpSpeed; P.ground = false; }
  if (!P.ground) { P.vy -= CONFIG.gravity * dt; P.pos.y += P.vy * dt; }
  const g = world.groundHeight(P.pos.x, P.pos.z);
  if (P.pos.y <= g || (P.ground && P.pos.y - g < 0.45)) { P.pos.y = g; P.vy = 0; P.ground = true; } else P.ground = false;
  P.bob += Math.hypot(P.pos.x - ox, P.pos.z - oz) * 2.2;
}
let last = 0, furSig = '';
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!panel) movePlayer(dt);
  world.update(dt, P.pos);
  camera.position.set(P.pos.x, P.pos.y + CONFIG.playerHeight + (P.ground ? Math.sin(P.bob) * 0.04 : 0), P.pos.z);
  camera.rotation.set(P.pitch, P.yaw, 0);
  camera.getWorldDirection(dir); fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  target = panel ? null : world.pick(camera.position, dir, CONFIG.reach);
  setHint();
  if (holdHit && swingT <= 0) act();
  swingT = Math.max(0, swingT - dt * 3);
  if (held) {
    const sw = Math.sin((1 - swingT) * Math.PI) * (swingT > 0 ? 1 : 0);
    held.position.set(0.4, -0.38 + Math.sin(P.bob * 2) * 0.006, -0.7 + sw * -0.12); held.rotation.set(0.15 - sw * 1.0, -0.35, 0.12);
    if (held.userData.light) { held.userData.light.intensity = 1.3 + 0.4 * Math.random() + world.night * 0.6; held.userData.flame.scale.setScalar(0.9 + Math.random() * 0.25); }
  }
  if (curFurnace) { if (Math.hypot(curFurnace.x - P.pos.x, curFurnace.z - P.pos.z) > 6) closePanel(); else { const f = curFurnace.furnace, sg = [f.fuel, f.ore.iron_ore, f.ore.sulfur_ore, f.out.metal, f.out.sulfur, f.active].join(); if (sg !== furSig) { furSig = sg; render(); } } }
  const hr = world.tod * 24; $('clock').textContent = `${String((hr | 0) % 24).padStart(2, '0')}:${String(((hr % 1) * 60) | 0).padStart(2, '0')} ${world.night > 0.5 ? '🌙' : '☀️'}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// мир строится синхронно — даём браузеру показать экран загрузки
requestAnimationFrame(() => setTimeout(() => {
  world = new World(scene); inv = startInventory();
  const sp = world.spawn;
  P = { pos: new THREE.Vector3(sp.x, sp.y, sp.z), vy: 0, yaw: sp.yaw, pitch: -0.05, ground: true, bob: 0 };
  renderHotbar(); $('load').remove(); last = performance.now(); requestAnimationFrame(frame);
}, 40));
