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
