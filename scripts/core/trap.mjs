/* Ловушка в чистом виде: описание, исход срабатывания, обезвреживание — по правилам, которые
   настроил мастер (core/rules.mjs). Без Foundry — всё здесь покрыто тестами. */

import { CRIT_FAILURE, CRIT_SUCCESS, SUCCESS } from "./degrees.mjs";
import { deriveDevice, DEVICES, normalizeOptions } from "./devices.mjs";
import { checkDegree, disarmOutcome } from "./rules.mjs";

/**
 * @typedef {object} TrapDef
 * @property {string} id
 * @property {string} [name]          Своё название (у встроенных — из перевода)
 * @property {string} [text]          Заметка для ведущего
 * @property {string} [flavor]        Что видят игроки при срабатывании
 * @property {string} icon            Значок Font Awesome
 * @property {"setback"|"dangerous"|"deadly"} severity
 * @property {boolean} magical
 * @property {number} width           Ширина области в клетках
 * @property {number} height          Высота области в клетках
 * @property {number} size            Большая сторона (для старых ловушек — сторона квадрата)
 * @property {"trigger"|"area"} affects  Только наступивший или все в области
 * @property {boolean} stops          Останавливает движение наступившего (яма, капкан, сеть)
 * @property {number} detectDC
 * @property {number} detectRange   С какого расстояния её можно заметить, фт (по клеткам, как линейка)
 * @property {string} detectSkill    Чем замечают: навык мастера или категория каталога (notice)
 * @property {number} disarmDC
 * @property {string} disarmSkill     Навык из списка мастера или категория каталога (tools, force, magic)
 * @property {number|null} attackBonus Ловушка с атакой: бонус к попаданию против КД (путь — у мастера)
 * @property {string} saveAbility     Спасбросок из списка мастера или категория (dodge, endure, mind); "" — без
 * @property {number} saveDC
 * @property {"half"|"none"} onSave   Урон при успешном спасброске
 * @property {string} damage
 * @property {string} damageType
 * @property {string} damage2
 * @property {string} damage2Type
 * @property {string} condition       Состояние при провале / попадании
 * @property {string} fx              Анимация (fx/presets.mjs)
 * @property {string} sound
 * @property {"auto"|"once"} rearm    Взводится снова или срабатывает один раз
 * @property {string} device          Устройство (devices.mjs): параметры на языке мира
 * @property {object} options         Параметры устройства: { depth: 30, spikes: "stakes", … }
 * @property {number} escapeDC        Выбраться (из ямы, капкана, сети): Сл; 0 — не нужно
 * @property {string} escapeSkill     Чем выбираться: навык мастера или категория (force)
 * @property {boolean} manual         Срабатывает только по кнопке ведущего
 * @property {number} activators      Сколько триггеров ставить вместе с ловушкой: 0 — ни одного,
 *                                    срабатывает сама область; 1–3 — столько триггеров, их потом
 *                                    расставляет ведущий. Старое activator ("plate"/"wire") — один.
 */

export const SEVERITIES = ["setback", "dangerous", "deadly"];

/** Больше триггеров у одной ловушки не ставим. */
export const MAX_ACTIVATORS = 3;
/** Подписи типов урона по умолчанию (мастер правит свой список в окне «Правила»). */
export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
/** Состояния, которые хотят ловушки каталога; модуль ищет такие же у системы (CONFIG.statusEffects). */
export const CONDITIONS = [
  "blinded", "deafened", "frightened", "grappled", "incapacitated", "paralyzed",
  "poisoned", "prone", "restrained", "stunned", "unconscious",
];

/** Ключ спасброска или навыка: латиница, цифры, - и _. */
const key = (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : "");

const DEFAULTS = {
  id: "",
  name: "",
  text: "",
  flavor: "",
  icon: "fa-solid fa-triangle-exclamation",
  severity: "dangerous",
  magical: false,
  size: 1,
  affects: "trigger",
  stops: false,
  detectDC: 15,
  detectRange: 10,
  detectSkill: "notice",
  disarmDC: 15,
  disarmSkill: "tools",
  attackBonus: null,
  saveAbility: "",
  saveDC: 13,
  onSave: "half",
  damage: "",
  damageType: "bludgeoning",
  damage2: "",
  damage2Type: "",
  condition: "",
  fx: "burst",
  sound: "",
  rearm: "auto",
  device: "",
  options: {},
  escapeDC: 0,
  escapeSkill: "force",
  manual: false,
  activators: 0,
};

const int = (v, fallback, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Любые данные (из каталога, настроек, поведения области) → полная корректная ловушка. */
export function normalizeTrap(raw = {}) {
  const t = { ...DEFAULTS, ...raw };
  // Ширина и высота; у старых ловушек и в каталоге — только size, это квадрат.
  const width = int(raw.width ?? raw.size, 1, 1, 12);
  const height = int(raw.height ?? raw.size, 1, 1, 12);
  const attack = t.attackBonus === null || t.attackBonus === undefined || t.attackBonus === "" ? null : int(t.attackBonus, null, -5, 30);
  return {
    id: str(t.id),
    name: str(t.name),
    text: str(t.text),
    flavor: str(t.flavor),
    icon: str(t.icon) || DEFAULTS.icon,
    severity: oneOf(t.severity, SEVERITIES, DEFAULTS.severity),
    magical: Boolean(t.magical),
    width,
    height,
    size: Math.max(width, height),
    affects: oneOf(t.affects, ["trigger", "area"], "trigger"),
    stops: Boolean(t.stops),
    detectDC: int(t.detectDC, DEFAULTS.detectDC, 0, 100),
    detectRange: int(t.detectRange, DEFAULTS.detectRange, 5, 120),
    detectSkill: key(t.detectSkill) || DEFAULTS.detectSkill,
    disarmDC: int(t.disarmDC, DEFAULTS.disarmDC, 0, 100),
    disarmSkill: key(t.disarmSkill) || DEFAULTS.disarmSkill,
    attackBonus: attack,
    saveAbility: attack === null ? key(t.saveAbility) : "",
    saveDC: int(t.saveDC, DEFAULTS.saveDC, 1, 100),
    onSave: oneOf(t.onSave, ["half", "none"], "half"),
    damage: isFormula(t.damage) ? str(t.damage) : "",
    damageType: key(t.damageType) || DEFAULTS.damageType,
    damage2: isFormula(t.damage2) ? str(t.damage2) : "",
    damage2Type: key(t.damage2Type) || key(t.damageType) || DEFAULTS.damageType,
    condition: str(t.condition),
    fx: str(t.fx) || DEFAULTS.fx,
    sound: str(t.sound),
    rearm: oneOf(t.rearm, ["auto", "once"], "auto"),
    device: str(t.device) in DEVICES ? str(t.device) : "",
    options: normalizeOptions(str(t.device), t.options),
    escapeDC: int(t.escapeDC, 0, 0, 100),
    escapeSkill: key(t.escapeSkill) || DEFAULTS.escapeSkill,
    manual: Boolean(t.manual),
    // У ловушек 0.2.4 было activator: "plate" | "wire" — это один триггер.
    activators: int(raw.activators ?? (raw.activator ? 1 : 0), 0, 0, MAX_ACTIVATORS),
  };
}

/**
 * Как срабатывает ловушка: "manual" — только по кнопке ведущего; "activator" — когда наступают
 * на её триггер (count — сколько их на сцене); "area" — когда заходят в саму область.
 */
export function activation({ manual = false } = {}, count = 0) {
  if (manual) return "manual";
  return count > 0 ? "activator" : "area";
}

/** Простая проверка формулы урона: кубики, числа, + и −. Пустая строка — урона нет. */
export function isFormula(value) {
  const s = str(value);
  if (!s) return false;
  return /^\s*(\d*d\d+|\d+)(\s*[+-]\s*(\d*d\d+|\d+))*\s*$/i.test(s);
}

/**
 * Ловушка «под партию»: в универсальной версии числа такие, как их записал мастер, — пересчёта
 * по уровню нет (у каждой системы он свой). Оставлено, чтобы окна звали одно и то же.
 */
export const scaleTrap = (trap) => normalizeTrap(trap);
export const unscaleTrap = (trap) => normalizeTrap(trap);

/** Поменять параметры устройства: поля, которые оно задаёт, пересчитываются, остальное — как было. */
export function withDevice(trap, options) {
  const t = normalizeTrap(trap);
  if (!t.device) return t;
  const opts = normalizeOptions(t.device, { ...t.options, ...options });
  return normalizeTrap({ ...t, ...deriveDevice(t.device, opts), options: opts });
}

/** Чем проверяется ловушка: атака, спасбросок или ничем (сработала — и всё). */
export function trapMode(trap) {
  if (trap.attackBonus !== null && trap.attackBonus !== undefined) return "attack";
  if (trap.saveAbility) return "save";
  return "auto";
}

export const hasDamage = (trap) => Boolean(trap.damage || trap.damage2);

/** Степень из проверки: отметил ведущий или прислала система — она; иначе считаем по правилам. */
const degreeOf = (check, target, rules) => (Number.isInteger(check?.degree) ? check.degree : checkDegree(check, target, rules));

/**
 * Исход для одной цели по правилам мастера (trap.rules — снимок ruleSnapshot: compare, crits,
 * critDouble). attack: { total, natural, faces, ac } или { degree } (ведущий отметил);
 * save: { total, natural?, faces?, target? } или { degree }. target — цель из листа (OSR);
 * без неё — Сл ловушки.
 * → { mode, degree, hit?, success?, multiplier, condition }
 *   multiplier — доля урона (2, 1, 0.5, 0); condition — накладывать ли состояние.
 */
export function resolveTarget(trap, { attack, save } = {}) {
  const mode = trapMode(trap);
  const rules = trap.rules ?? {};
  if (mode === "attack") {
    // Атака ловушки: естественные 20 и 1 — всегда попадание и промах, как привыкли за столом.
    const degree = degreeOf(attack, attack?.ac ?? 10, { compare: "gte", crits: rules.crits === "tens" ? "tens" : "natural" });
    const hit = degree >= SUCCESS;
    const multiplier = !hit ? 0 : degree === CRIT_SUCCESS && rules.critDouble ? 2 : 1;
    return { mode, degree, hit, multiplier, condition: hit };
  }
  if (mode === "save") {
    const degree = degreeOf(save, save?.target ?? trap.saveDC, rules);
    const success = degree >= SUCCESS;
    let multiplier = 1;
    if (degree === CRIT_SUCCESS) multiplier = 0;
    else if (success) multiplier = trap.onSave === "half" ? 0.5 : 0;
    else if (degree === CRIT_FAILURE && rules.critDouble) multiplier = 2;
    return { mode, degree, success, multiplier, condition: !success };
  }
  return { mode, degree: null, multiplier: 1, condition: true };
}

/**
 * Обезвреживание по правилам мастера: успех; провал; провал на failBy и больше (или крит.
 * провал, если криты включены) — ловушка срабатывает. check — итог числом или { total, natural,
 * faces } / { degree }.
 */
export function resolveDisarm(check, dc, rules = { failBy: 5 }) {
  const c = typeof check === "number" ? { total: check } : check;
  return disarmOutcome(c, dc, { failBy: 5, ...rules });
}

/** Замечает ли персонаж ловушку пассивной Внимательностью. */
export const notices = (passive, dc) => Number(passive) >= Number(dc);

/** Что делать, когда персонаж заметил ловушку: сообщить ведущему (по умолчанию) или сразу показать игрокам. */
export const DETECT_MODES = ["gm", "reveal"];
/** Кто бросает обезвреживание, когда ведущий жмёт ключ: игрок (карточкой) или ведущий сразу. */
export const DISARM_ROLLS = ["players", "gm"];
/** Свой ключ у игроков на замеченных ловушках: есть или нет. */
export const PLAYER_DISARM = ["on", "off"];

/** Знает ли персонаж о ловушке: её показали всем или он сам уже замечал её. */
export const knowsTrap = ({ revealed = false, noticedBy = [] } = {}, actorId) =>
  Boolean(revealed) || (Array.isArray(noticedBy) && noticedBy.some((n) => n?.id === actorId));

/** Список заметивших [{ id, name }] с ещё одним — без повторов. */
export function addNoticer(list, who) {
  const clean = Array.isArray(list) ? list.filter((n) => n?.id) : [];
  if (!who?.id || clean.some((n) => n.id === who.id)) return clean;
  return [...clean, { id: who.id, name: String(who.name ?? "") }];
}

/** Ловушка → данные поведения области (плоские поля схемы). */
export function toBehaviorData(trap, { flavor = "", text = "" } = {}) {
  const t = normalizeTrap(trap);
  return {
    trapId: t.id,
    icon: t.icon,
    severity: t.severity,
    magical: t.magical,
    affects: t.affects,
    stops: t.stops,
    detectDC: t.detectDC,
    detectRange: t.detectRange,
    detectSkill: t.detectSkill,
    disarmDC: t.disarmDC,
    disarmSkill: t.disarmSkill,
    attackBonus: t.attackBonus,
    saveAbility: t.saveAbility,
    saveDC: t.saveDC,
    onSave: t.onSave,
    damage: t.damage,
    damageType: t.damageType,
    damage2: t.damage2,
    damage2Type: t.damage2 ? t.damage2Type : "",
    condition: t.condition,
    fx: t.fx,
    sound: t.sound,
    rearm: t.rearm,
    device: t.device,
    options: t.options,
    escapeDC: t.escapeDC,
    escapeSkill: t.escapeSkill,
    manual: t.manual,
    activators: t.activators,
    flavor: flavor || t.flavor,
    notes: text || t.text,
    size: t.size,
    width: t.width,
    height: t.height,
  };
}

/** Данные поведения → ловушка для библиотеки (сохранить расставленную как свою). */
export function fromBehaviorData(system, { id, name, size, width, height } = {}) {
  const w = width ?? size ?? system.width ?? system.size;
  const h = height ?? size ?? system.height ?? system.size;
  return normalizeTrap({ ...system, id, name, text: system.notes, width: w, height: h });
}

/** Поиск и фильтр библиотеки. entries: [{ trap, name, text }] */
export function filterTraps(entries, { query = "", severity = "", kind = "", damageType = "" } = {}) {
  const q = str(query).toLowerCase();
  return entries.filter(({ trap, name, text }) => {
    if (severity && trap.severity !== severity) return false;
    if (kind === "magical" && !trap.magical) return false;
    if (kind === "mechanical" && trap.magical) return false;
    if (damageType) {
      // Тип урона без самого урона (сонный газ) не считается; окно передаёт только типы — им верим.
      const first = trap.damage === undefined || trap.damage ? trap.damageType : "";
      const second = trap.damage2 === undefined || trap.damage2 ? trap.damage2Type : "";
      if (first !== damageType && second !== damageType) return false;
    }
    if (!q) return true;
    return `${name} ${text}`.toLowerCase().includes(q);
  });
}

/** Новый id для своей ловушки: custom-<время>-<случайное>. */
export const customId = (now = Date.now(), rnd = Math.random()) => `custom-${now.toString(36)}${Math.floor(rnd * 1296).toString(36).padStart(2, "0")}`;
