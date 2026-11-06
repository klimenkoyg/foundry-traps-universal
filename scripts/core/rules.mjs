/* Правила ловушек, которые настраивает мастер: модуль не знает систему, всё берёт отсюда.
   Профиль — обычный объект (настройка мира `rules`): формула броска, с чем сравнивать, криты,
   списки спасбросков и навыков с путями к числам в листе персонажа, куда списывать урон,
   как замечать и обезвреживать ловушки. Без Foundry — всё здесь покрыто тестами. */

import { CRIT_FAILURE, CRIT_SUCCESS, FAILURE, SUCCESS } from "./degrees.mjs";

/**
 * Категории, которыми пользуются ловушки каталога. Мастер сопоставляет каждую своему спасброску
 * или навыку: «увернуться» → Ловкость (D&D), Рефлекс (PF2e), Breath (OSE)…
 */
export const SAVE_CATEGORIES = ["dodge", "endure", "mind"];
export const SKILL_CATEGORIES = ["notice", "tools", "force", "magic"];

/** Кто бросает спасброски от ловушки. */
export const SAVE_ROLLS = ["players", "enter", "module", "gm"];
/** Как сравнивать итог с целью: не меньше (d20 + бонус ≥ Сл) или не больше (d100 ≤ навыка). */
export const COMPARES = ["gte", "lte"];
/** Критические исходы: нет; естественный максимум/минимум кубика сдвигают исход; ±10 от цели. */
export const CRITS = ["none", "natural", "tens"];
/** Откуда цель проверки: Сл ловушки или число из листа персонажа (цели спасбросков OSR). */
export const TARGETS = ["trap", "sheet"];
/** Куда списывать урон: полоска токена (bar1), свой путь к хитам, никуда (мастер вычитает сам). */
export const HP_MODES = ["bar", "path", "none"];
/** Как замечать ловушки: никак, пассивным числом из листа, тайной проверкой. */
export const DETECT_MODES_RULES = ["off", "passive", "roll"];
/** Готовые наборы правил. */
export const PRESET_NAMES = ["d20", "gm"];

const DEFAULT_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

/** Обычный d20: 1d20 + бонус ≥ Сл, игроки бросают сами, урон — в полоску хитов токена. */
const D20 = {
  version: 1,
  preset: "d20",
  formula: "1d20 + @bonus",
  compare: "gte",
  target: "trap",
  crits: "none",
  critDouble: false,
  askBonus: true,
  saves: [
    { key: "dex", label: "", bonus: "", target: "" },
    { key: "con", label: "", bonus: "", target: "" },
    { key: "wis", label: "", bonus: "", target: "" },
  ],
  skills: [
    { key: "perception", label: "", bonus: "", target: "" },
    { key: "thievery", label: "", bonus: "", target: "" },
    { key: "athletics", label: "", bonus: "", target: "" },
    { key: "arcana", label: "", bonus: "", target: "" },
  ],
  map: { dodge: "dex", endure: "con", mind: "wis", notice: "perception", tools: "thievery", force: "athletics", magic: "arcana" },
  acPath: "",
  hp: "bar",
  hpPath: "",
  onSave: "half",
  types: DEFAULT_TYPES,
  conditions: {},
  detect: "passive",
  passivePath: "",
  disarmFailBy: 5,
};

/** Только ведущий: модуль ничего не бросает за персонажей, исходы отмечает мастер. */
const GM = {
  ...D20,
  preset: "gm",
  askBonus: false,
  detect: "off",
  hp: "bar",
};

export const PRESETS = { d20: D20, gm: GM };
/** Кто бросает спасброски по умолчанию в пресете (это отдельная настройка мира). */
export const PRESET_SAVE_ROLLS = { d20: "players", gm: "gm" };

const str = (v) => (typeof v === "string" ? v.trim() : "");
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const int = (v, fallback, min, max) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
/** Ключ строки: латиница, цифры, -, _ (из него собираются id и ключи перевода). */
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
/**
 * Путь в листе: system.saves.dex.value — буквы, цифры, точки, _, - и > (в CoC7 навыки лежат по
 * ключам вида «i>>skill>>dodge»). Можно сложить несколько путей через «+» (навык + модификатор
 * характеристики) и дать запасной через «|» (нет навыка в листе — берём характеристику).
 */
export function cleanPath(v) {
  const s = str(v);
  if (!/^[A-Za-z0-9_.>+| -]*$/.test(s)) return "";
  return s
    .split("|")
    .map((alt) => alt.split("+").map((p) => p.trim().replace(/^\.+|\.+$/g, "")).filter(Boolean).join(" + "))
    .filter(Boolean)
    .join(" | ");
}

/**
 * Число по выражению путей: «a + b | c» — сумма a и b, а если какого-то из них нет — c.
 * get(path) → число или null (как его прочитать, решает Foundry-часть). → число или null.
 */
export function readExpr(expr, get) {
  for (const alt of String(expr ?? "").split("|")) {
    const parts = alt.split("+").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    const values = parts.map(get);
    if (values.every((n) => Number.isFinite(n))) return values.reduce((a, b) => a + b, 0);
  }
  return null;
}

/** Формула броска: кубики, числа, @bonus, + и −. Неверная — по умолчанию. */
export function isRollFormula(value) {
  const s = str(value);
  return Boolean(s) && /^\s*(\d*d\d+|\d+|@bonus)(\s*[+-]\s*(\d*d\d+|\d+|@bonus))*\s*$/i.test(s);
}

function rows(list, fallback) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(list) ? list : []) {
    const key = slug(row?.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Своя формула и сравнение у строки — для систем, где проверки разные (OSE: спасбросок d20 ≥
    // цели, поиск ловушки 1d6 ≤ навыка, проверка характеристики d20 ≤ значения).
    out.push({
      key,
      label: str(row.label),
      bonus: cleanPath(row.bonus),
      target: cleanPath(row.target),
      formula: isRollFormula(row.formula) ? str(row.formula) : "",
      compare: COMPARES.includes(row.compare) ? row.compare : "",
    });
  }
  return out.length ? out : fallback.map((r) => ({ ...r }));
}

/** Любые данные (настройка мира, импорт JSON) → полный корректный профиль. */
export function normalizeProfile(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = PRESETS[src.preset] ?? D20;
  const p = { ...base, ...src };
  const saves = rows(p.saves, base.saves);
  const skills = rows(p.skills, base.skills);
  const map = {};
  for (const c of SAVE_CATEGORIES) map[c] = saves.some((s) => s.key === p.map?.[c]) ? p.map[c] : (saves.find((s) => s.key === base.map[c])?.key ?? saves[0].key);
  for (const c of SKILL_CATEGORIES) map[c] = skills.some((s) => s.key === p.map?.[c]) ? p.map[c] : (skills.find((s) => s.key === base.map[c])?.key ?? skills[0].key);
  const types = [...new Set((Array.isArray(p.types) ? p.types : base.types).map(slug).filter(Boolean))];
  const conditions = {};
  for (const [k, v] of Object.entries(p.conditions && typeof p.conditions === "object" ? p.conditions : {})) {
    if (slug(k) && typeof v === "string") conditions[slug(k)] = str(v);
  }
  return {
    version: 1,
    // "system" — правила из готовых под систему мира (core/system-presets.mjs).
    preset: oneOf(p.preset, [...PRESET_NAMES, "system"], "d20"),
    // Из правил какой системы сделан профиль (id системы Foundry: «ose», «CoC7»…).
    system: typeof p.system === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.system) ? p.system : "",
    formula: isRollFormula(p.formula) ? str(p.formula) : base.formula,
    compare: oneOf(p.compare, COMPARES, "gte"),
    target: oneOf(p.target, TARGETS, "trap"),
    crits: oneOf(p.crits, CRITS, "none"),
    critDouble: Boolean(p.critDouble),
    askBonus: Boolean(p.askBonus),
    saves,
    skills,
    map,
    acPath: cleanPath(p.acPath),
    hp: oneOf(p.hp, HP_MODES, "bar"),
    hpPath: cleanPath(p.hpPath),
    onSave: oneOf(p.onSave, ["half", "none"], "half"),
    types: types.length ? types : [...DEFAULT_TYPES],
    conditions,
    detect: oneOf(p.detect, DETECT_MODES_RULES, "passive"),
    passivePath: cleanPath(p.passivePath),
    disarmFailBy: int(p.disarmFailBy, 5, 0, 50),
  };
}

/** Пресет с нуля (кнопка в окне «Правила»). */
export const presetProfile = (name) => normalizeProfile({ ...(PRESETS[name] ?? D20) });

/** Строка спасброска или навыка по ключу или категории каталога («dodge» → «dex»). */
export function findRow(profile, list, key) {
  const rowsOf = profile[list] ?? [];
  const real = profile.map?.[key] ?? key;
  return rowsOf.find((r) => r.key === real) ?? null;
}
export const saveRow = (profile, key) => findRow(profile, "saves", key);
export const skillRow = (profile, key) => findRow(profile, "skills", key);

/** То, что нужно карточке, чтобы самой посчитать исход: копия в состоянии розыгрыша. */
export const ruleSnapshot = (profile) => ({ compare: profile.compare, crits: profile.crits, critDouble: profile.critDouble, failBy: profile.disarmFailBy });

/**
 * Степень успеха проверки по правилам мастера.
 * check — { total, natural?, faces? }; target — Сл или число из листа.
 * compare "gte": успех, если итог не меньше цели; "lte": если не больше.
 * crits "none" — только успех/провал; "natural" — максимум кубика поднимает на ступень, единица
 * опускает (при «не больше» — наоборот); "tens" — ещё и ±10 от цели (как в PF2e).
 * → 0 крит. провал, 1 провал, 2 успех, 3 крит. успех.
 */
export function checkDegree(check, target, { compare: ruleCompare = "gte", crits = "none" } = {}) {
  // Своё сравнение у спасброска или навыка (строка правил) важнее общего.
  const compare = check?.compare || ruleCompare;
  const total = Number(check?.total) || 0;
  const t = Number(target) || 0;
  const margin = compare === "lte" ? t - total : total - t;
  let degree = margin >= 0 ? SUCCESS : FAILURE;
  if (crits === "tens") {
    if (margin >= 10) degree = CRIT_SUCCESS;
    else if (margin <= -10) degree = CRIT_FAILURE;
  }
  if (crits !== "none" && Number.isFinite(check?.natural) && Number(check?.faces) > 1) {
    const top = check.natural === Number(check.faces);
    const bottom = check.natural === 1;
    const up = compare === "lte" ? bottom : top;
    const down = compare === "lte" ? top : bottom;
    if (up) degree += 1;
    else if (down) degree -= 1;
  }
  return Math.min(CRIT_SUCCESS, Math.max(CRIT_FAILURE, degree));
}

/**
 * Обезвреживание: успех; провал; провал на failBy и больше (или крит. провал) — срабатывает.
 * → "success" | "fail" | "triggered"
 */
export function disarmOutcome(check, dc, rules = {}) {
  const degree = Number.isInteger(check?.degree) ? check.degree : checkDegree(check, check?.target ?? dc, rules);
  if (degree >= SUCCESS) return "success";
  if (degree === CRIT_FAILURE && rules.crits && rules.crits !== "none") return "triggered";
  const total = Number(check?.total);
  const target = Number.isFinite(check?.target) ? check.target : Number(dc);
  if (rules.failBy > 0 && Number.isFinite(total)) {
    const miss = (check?.compare || rules.compare) === "lte" ? total - target : target - total;
    if (miss >= rules.failBy) return "triggered";
  }
  return "fail";
}

/** Подставить бонус в формулу мастера: «1d20 + @bonus» с бонусом 3 → «1d20 + 3». */
export const withBonus = (formula, bonus) => String(formula).replace(/@bonus/gi, String(Number(bonus) || 0)).replace(/\+\s*-/g, "- ");

/** Сколько граней у первого кубика формулы (для естественных максимума и минимума). */
export function firstDieFaces(formula) {
  const m = String(formula).match(/(\d*)d(\d+)/i);
  return m ? Number(m[2]) : 0;
}
