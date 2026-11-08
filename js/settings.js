// Настройки игрока: хранятся в localStorage, безопасно работают и в Node (для тестов).
export const DEFAULTS = {
  master: 0.8,     // общая громкость
  sfx: 0.9,        // звуки действий
  amb: 0.6,        // окружение (ветер, волны, птицы)
  sens: 1,         // чувствительность камеры
  invY: false,     // инвертировать вертикаль
  fov: 72,         // угол обзора
  view: 1,         // дальность прорисовки: 0 близко, 1 средне, 2 далеко
  quality: 1,      // качество графики: 0 низкая, 1 средняя, 2 высокая (тени, трава, чёткость)
  stickFixed: false, // джойстик: false — появляется под пальцем, true — на одном месте
  autoRun: false,  // всегда бегать
  btn: 1,          // размер кнопок
};
const LIMITS = { master: [0, 1], sfx: [0, 1], amb: [0, 1], sens: [0.3, 2.5], fov: [60, 100], view: [0, 2], quality: [0, 2], btn: [0.8, 1.3] };
const KEY = 'xust.settings.v1';

export const S = { ...DEFAULTS };

export function sanitize(o) {
  const r = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = o?.[k];
    if (typeof DEFAULTS[k] === 'boolean') { if (typeof v === 'boolean') r[k] = v; }
    else if (typeof v === 'number' && Number.isFinite(v)) { const [a, b] = LIMITS[k]; r[k] = Math.min(b, Math.max(a, v)); }
  }
  r.view = Math.round(r.view); r.quality = Math.round(r.quality);
  return r;
}
export function loadSettings() {
  try { Object.assign(S, sanitize(JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}'))); } catch { /* нет хранилища — берём значения по умолчанию */ }
}
export function saveSettings() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ }
}
export function resetSettings() { Object.assign(S, DEFAULTS); saveSettings(); }

// ---- расположение и размер кнопок (отдельный ключ, не трогает DEFAULTS и sanitize) ----
// LAYOUT[id] = { x, y, s }: центр кнопки в долях экрана (0..1) и множитель размера
export const LAYOUT_IDS = ['bHit', 'bAim', 'bJump', 'bCrouch', 'bInv', 'bMenu'];
export const LAYOUT = {};
const LKEY = 'xust.layout.v1';
const lclamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function sanitizeLayout(o) {
  const r = {};
  for (const id of LAYOUT_IDS) {
    const v = o?.[id];
    if (!v || typeof v !== 'object') continue;
    const { x, y, s } = v;
    if (![x, y, s].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    r[id] = { x: lclamp(x, 0.03, 0.97), y: lclamp(y, 0.05, 0.95), s: lclamp(s, 0.5, 2) };
  }
  return r;
}
export function loadLayout() {
  try {
    const l = sanitizeLayout(JSON.parse(globalThis.localStorage?.getItem(LKEY) || '{}'));
    for (const k of Object.keys(LAYOUT)) delete LAYOUT[k];
    Object.assign(LAYOUT, l);
  } catch { /* нет хранилища — стандартная раскладка */ }
}
export function saveLayout() { try { globalThis.localStorage?.setItem(LKEY, JSON.stringify(LAYOUT)); } catch { /* ignore */ } }
export function resetLayout() { for (const k of Object.keys(LAYOUT)) delete LAYOUT[k]; saveLayout(); }
