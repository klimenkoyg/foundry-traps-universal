/* Устройство ловушки: параметры на языке мира (глубина ямы, число дротиков, вид газа…).
   Устройство переводит свои параметры в поля ловушки — урон, состояние, сложности — для партии
   уровня, как в каталоге; дальше мастер правит числа под свою систему. Подписи — в lang/*.json:
   TRAPS.Device.<устройство>.<параметр>.label и .<значение>. */

/**
 * @typedef {object} DeviceParam
 * @property {string} key
 * @property {"choice"|"range"|"toggle"} type
 * @property {string[]} [options]   choice: значения по порядку
 * @property {number} [min]         range
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]        range: единица (ft) — TRAPS.Unit.<unit>
 * @property {string[]} fields      Какие поля ловушки задаёт параметр (для подсказки под ним)
 */

/** Сила по описанию → во сколько раз больше кубиков, чем у обычной. */
const POWER = { weak: 0.5, normal: 1, strong: 1.5, devastating: 2 };

const dice = (n, die) => `${Math.max(1, Math.round(n))}d${die}`;

/** «3d8» × 1.5 → «5d8» (только число кубиков). */
function times(formula, k) {
  return String(formula || "").replace(/(\d*)d(\d+)/gi, (m, n, d) => dice((Number(n) || 1) * k, d));
}

/** @type {Record<string, { params: DeviceParam[], derive: (o: object) => object }>} */
export const DEVICES = {
  pit: {
    params: [
      { key: "depth", type: "range", min: 10, max: 200, step: 10, unit: "ft", fields: ["damage"] },
      { key: "spikes", type: "choice", options: ["none", "stakes", "poisoned"], fields: ["damage2", "condition"] },
      { key: "walls", type: "choice", options: ["rough", "smooth", "slick"], fields: ["escapeDC"] },
    ],
    // Падение — 1d6 за каждые 10 фт, не больше 20d6 (так в большинстве d20-систем).
    derive: ({ depth, spikes, walls }) => ({
      damage: dice(Math.min(20, depth / 10), 6),
      damageType: "bludgeoning",
      damage2: spikes === "none" ? "" : "2d6",
      damage2Type: spikes === "none" ? "" : "piercing",
      condition: spikes === "poisoned" ? "poisoned" : "prone",
      fx: spikes === "none" ? "pit" : "spikes",
      escapeDC: { rough: 10, smooth: 15, slick: 20 }[walls],
      escapeSkill: "force",
    }),
  },

  bearTrap: {
    params: [
      { key: "jaws", type: "choice", options: ["small", "bear", "giant"], fields: ["damage", "escapeDC"] },
      { key: "venom", type: "toggle", fields: ["damage2"] },
    ],
    derive: ({ jaws, venom }) => ({
      damage: { small: "1d4", bear: "1d10", giant: "2d10" }[jaws],
      damageType: "piercing",
      damage2: venom ? "1d6" : "",
      damage2Type: venom ? "poison" : "",
      condition: "restrained",
      escapeDC: { small: 13, bear: 15, giant: 18 }[jaws],
      escapeSkill: "force",
    }),
  },

  darts: {
    params: [
      { key: "count", type: "range", min: 1, max: 4, step: 1, fields: ["damage"] },
      { key: "poison", type: "choice", options: ["none", "venom", "sleep"], fields: ["damage2", "condition"] },
    ],
    derive: ({ count, poison }) => ({
      damage: dice(count, 4),
      damageType: "piercing",
      damage2: poison === "venom" ? "2d6" : "",
      damage2Type: poison === "venom" ? "poison" : "",
      condition: { none: "", venom: "poisoned", sleep: "unconscious" }[poison],
    }),
  },

  arrows: {
    params: [
      { key: "count", type: "range", min: 1, max: 4, step: 1, fields: ["damage"] },
      { key: "tips", type: "choice", options: ["plain", "fire", "poison"], fields: ["damage2", "condition"] },
    ],
    derive: ({ count, tips }) => ({
      damage: dice(count, 6),
      damageType: "piercing",
      damage2: tips === "plain" ? "" : dice(count, 4),
      damage2Type: { plain: "", fire: "fire", poison: "poison" }[tips],
      condition: tips === "poison" ? "poisoned" : "",
    }),
  },

  blade: {
    params: [
      { key: "height", type: "choice", options: ["low", "waist", "high"], fields: ["damage", "condition"] },
      { key: "speed", type: "choice", options: ["slow", "fast", "blur"], fields: ["attackBonus"] },
    ],
    derive: ({ height, speed }) => ({
      damage: { low: "1d10", waist: "2d10", high: "3d10" }[height],
      damageType: "slashing",
      condition: height === "low" ? "prone" : "",
      attackBonus: { slow: 4, fast: 7, blur: 10 }[speed],
    }),
  },

  net: {
    params: [{ key: "net", type: "choice", options: ["rope", "weighted", "hooked", "chain"], fields: ["damage", "escapeDC"] }],
    derive: ({ net }) => ({
      damage: { rope: "", weighted: "1d6", hooked: "1d6", chain: "2d6" }[net],
      damageType: net === "hooked" ? "piercing" : "bludgeoning",
      condition: "restrained",
      escapeDC: { rope: 10, weighted: 12, hooked: 13, chain: 15 }[net],
      escapeSkill: "force",
    }),
  },

  roof: {
    params: [
      { key: "debris", type: "choice", options: ["gravel", "stones", "slabs"], fields: ["damage"] },
      { key: "buried", type: "toggle", fields: ["condition", "escapeDC"] },
    ],
    derive: ({ debris, buried }) => ({
      damage: { gravel: "2d10", stones: "4d10", slabs: "6d10" }[debris],
      damageType: "bludgeoning",
      condition: buried ? "restrained" : "",
      escapeDC: buried ? 15 : 0,
      escapeSkill: "force",
    }),
  },

  boulder: {
    params: [
      { key: "boulder", type: "choice", options: ["medium", "large", "huge"], fields: ["damage"] },
      { key: "knockdown", type: "toggle", fields: ["condition"] },
    ],
    derive: ({ boulder, knockdown }) => ({
      damage: { medium: "2d10", large: "4d10", huge: "6d10" }[boulder],
      damageType: "bludgeoning",
      condition: knockdown ? "prone" : "",
    }),
  },

  jet: {
    params: [
      { key: "pressure", type: "choice", options: ["weak", "normal", "strong"], fields: ["damage"] },
      { key: "nozzles", type: "choice", options: ["one", "ring"], fields: ["affects"] },
    ],
    derive: ({ pressure, nozzles }) => ({
      damage: { weak: "1d10", normal: "2d10", strong: "4d10" }[pressure],
      affects: nozzles === "ring" ? "area" : "trigger",
    }),
  },

  gas: {
    params: [
      { key: "toxin", type: "choice", options: ["choking", "sleep", "smoke", "madness"], fields: ["damage", "condition", "onSave"] },
      { key: "density", type: "choice", options: ["thin", "dense", "thick"], fields: ["saveDC"] },
    ],
    derive: ({ toxin, density }) => ({
      damage: toxin === "choking" ? "2d10" : "",
      damageType: "poison",
      condition: { choking: "poisoned", sleep: "unconscious", smoke: "blinded", madness: "frightened" }[toxin],
      onSave: toxin === "choking" ? "half" : "none",
      fx: toxin === "sleep" ? "sleep" : "gas",
      saveAbility: "endure",
      saveDC: { thin: 11, dense: 13, thick: 15 }[density],
    }),
  },

  // Руны: «обычная» — урон из описания (скрытый параметр base), остальные — во столько-то раз больше.
  rune: {
    params: [{ key: "power", type: "choice", options: ["weak", "normal", "strong", "devastating"], fields: ["damage"] }],
    derive: ({ power, base }) => ({ damage: times(base || "2d8", POWER[power] ?? 1) }),
  },

  alarm: {
    params: [{ key: "signal", type: "choice", options: ["bell", "gong", "chime"], fields: ["sound"] }],
    derive: ({ signal }) => ({ sound: { bell: "alarm", gong: "boom", chime: "chime" }[signal] }),
  },
};

export const DEVICE_NAMES = Object.keys(DEVICES);

/** Скрытые параметры устройств: хранятся вместе с остальными, но в окне не показываются. */
const HIDDEN = { rune: ["base"] };

/** Значение параметра по умолчанию: середина выбора, начало диапазона, «выключено». */
function fallback(param) {
  if (param.type === "toggle") return false;
  if (param.type === "range") return param.min;
  return param.options[Math.floor((param.options.length - 1) / 2)];
}

/** Привести параметр к допустимому значению. */
export function normalizeParam(param, value) {
  if (param.type === "toggle") return value === true || value === "true" || value === "on" || value === 1;
  if (param.type === "range") {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback(param);
    const stepped = param.min + Math.round((n - param.min) / param.step) * param.step;
    return Math.min(param.max, Math.max(param.min, stepped));
  }
  return param.options.includes(value) ? value : fallback(param);
}

/** Параметры устройства → полный корректный набор. Неизвестное устройство → {}. */
export function normalizeOptions(device, options = {}) {
  const def = DEVICES[device];
  if (!def) return {};
  const src = options && typeof options === "object" ? options : {};
  const out = Object.fromEntries(def.params.map((p) => [p.key, normalizeParam(p, src[p.key])]));
  for (const key of HIDDEN[device] ?? []) if (typeof src[key] === "string" && src[key]) out[key] = src[key];
  return out;
}

/** Поля ловушки, которые задаёт устройство при этих параметрах (для 1–4 уровня). */
export function deriveDevice(device, options) {
  const def = DEVICES[device];
  return def ? def.derive(normalizeOptions(device, options)) : {};
}

/** Все поля, которыми управляет устройство: по ним окно показывает «задано устройством». */
export function deviceFields(device) {
  const def = DEVICES[device];
  if (!def) return [];
  return [...new Set(Object.keys(def.derive(normalizeOptions(device, {}))))];
}
