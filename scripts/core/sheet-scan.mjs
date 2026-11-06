/* «Найти в листе»: модуль обходит данные персонажа неизвестной системы и по знакомым словам
   (dex / agility / reflex, hp / health, ac / armor, perception / notice…) предлагает пути к числам
   для спасбросков, навыков, КД, хитов и пассивного обнаружения. Мастер потом проверяет — это
   подсказка, а не истина. Без Foundry — всё здесь покрыто тестами. */

import { SAVE_CATEGORIES, SKILL_CATEGORIES } from "./rules.mjs";

/** Слова, по которым узнаём категории ловушек и поля листа. */
export const WORDS = {
  dodge: ["dex", "dexterity", "agi", "agility", "ag", "reflex", "reflexes", "ref", "dodge", "evasion", "evade", "breath", "speed", "quickness"],
  endure: ["con", "constitution", "fort", "fortitude", "tough", "toughness", "endurance", "body", "vigor", "vitality", "poison", "death", "physique", "stamina"],
  mind: ["wis", "wisdom", "will", "willpower", "mind", "spirit", "pow", "power", "spells", "spell", "sanity", "resolve", "presence"],
  notice: ["perception", "prc", "per", "perc", "notice", "spot", "spothidden", "awareness", "alertness", "instinct", "wits", "search", "observation"],
  tools: ["thievery", "sleight", "sleightofhand", "slt", "thief", "thieves", "lockpick", "lockpicking", "locksmith", "tools", "disable", "mechanics", "mechanical", "traps", "trap"],
  force: ["athletics", "ath", "str", "strength", "might", "brawn", "climb", "climbing", "muscle"],
  magic: ["arcana", "arc", "magic", "occult", "occultism", "lore", "knowledge", "spellcraft", "int", "intelligence", "sorcery"],
  ac: ["ac", "armor", "armour", "armorclass", "armourclass", "defense", "defence", "def", "evasion"],
  hp: ["hp", "health", "hitpoints", "hits", "wounds", "life", "lifepoints"],
};

/** Ключи, которые не обходим: ссылки назад, схемы, источник данных. */
const SKIP = new Set(["parent", "_source", "schema", "constructor", "_id", "flags", "_stats", "items", "effects", "token", "prototypeToken", "ownership", "description", "biography", "notes"]);
/** Последний ключ пути: насколько он похож на нужное число (выше — лучше). */
const LEAF = { save: 5, saves: 5, mod: 4, modifier: 4, bonus: 4, total: 3, value: 2, current: 2, base: -2, max: -4, min: -6, dc: -6, proficient: -8, prof: -8, cost: -8 };

/** Слова из ключа: «sleightOfHand» → sleight, of, hand, sleightofhand; «hit_points» → hit, points, hitpoints. */
function tokens(key) {
  const raw = String(key);
  const parts = raw.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([...parts, raw.toLowerCase().replace(/[^a-z0-9]/g, "")])];
}

/** Число из значения: число или строка-число. Объект с value/total/mod — тоже число (берём его). */
function numberOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Все числа в данных персонажа: [{ path, value, keys }]. Объект с value/total/mod тоже
 * кандидат (путь на сам объект — модуль возьмёт из него число). Глубина ограничена, циклы — нет.
 */
export function scanSheet(data, prefix = "system", { depth = 7 } = {}) {
  const out = [];
  const seen = new WeakSet();
  const walk = (obj, path, keys, level) => {
    if (!obj || typeof obj !== "object" || level > depth || seen.has(obj)) return;
    if (obj.documentName || typeof obj.then === "function") return;
    seen.add(obj);
    if (Array.isArray(obj)) return;
    // Как модуль читает число из объекта (foundry/universal.mjs, readNumber): total, mod, value.
    const inner = numberOf(obj.total) ?? numberOf(obj.mod) ?? numberOf(obj.value);
    if (inner !== null && level > 0) out.push({ path, value: inner, keys, object: true, hasMax: numberOf(obj.max) !== null });
    for (const [key, v] of Object.entries(obj)) {
      if (SKIP.has(key) || key.startsWith("_")) continue;
      const p = `${path}.${key}`;
      const n = numberOf(v);
      if (n !== null) out.push({ path: p, value: n, keys: [...keys, key] });
      else if (v && typeof v === "object") walk(v, p, [...keys, key], level + 1);
    }
  };
  walk(data, prefix, [], 0);
  return out;
}

/**
 * Насколько кандидат подходит под слова. kind: "save" — ценим «save» в пути, «skill» — «skills»,
 * «passive» — «passive», «hp» — объект с max, «ac» — обычное число.
 */
function score(cand, words, kind) {
  const set = new Set(words);
  let s = 0;
  let hit = false;
  cand.keys.forEach((key, i) => {
    for (const tok of tokens(key)) {
      if (set.has(tok)) {
        // Слово ближе к концу пути весит больше: abilities.dex.mod лучше, чем dex.something.deep.
        s += 10 + i;
        hit = true;
      }
    }
  });
  if (!hit) return -Infinity;
  const path = cand.keys.map((k) => k.toLowerCase());
  const last = path.at(-1);
  // Объект с value/total/mod короче и понятнее мастеру, чем тот же путь с «.value» на конце.
  s += cand.object ? 3 : (LEAF[last] ?? 0);
  if (kind === "save" && path.some((k) => k.startsWith("save"))) s += 8;
  if (kind === "skill" && path.some((k) => k.startsWith("skill"))) s += 4;
  if (kind === "passive") s += path.includes("passive") ? 12 : -20;
  // Пассивное значение — не бонус к броску: для спасбросков и навыков его не берём вовсе.
  if (kind !== "passive" && path.includes("passive")) return -Infinity;
  if (kind === "hp") s += cand.object && cand.hasMax ? 10 : -5;
  if (kind !== "hp" && path.includes("max")) s -= 6;
  // Чем короче путь, тем вероятнее это «главное» число, а не служебное.
  s -= cand.keys.length * 0.5;
  return s;
}

/** Лучший кандидат под слова или null. */
export function bestPath(cands, words, kind = "skill") {
  let best = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const s = score(c, words, kind);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best && bestScore > 0 ? best : null;
}

/** Слова для строки списка: её ключ, название и категории, которые мастер к ней привязал. */
function rowWords(profile, row, cats) {
  const words = [...tokens(row.key), ...tokens(row.label ?? "")];
  for (const c of cats) if (profile.map?.[c] === row.key) words.push(...WORDS[c]);
  return words.filter((w) => w.length >= 2);
}

/**
 * Что предложить по данным персонажа: { saves: { key: path }, skills: { key: path }, acPath,
 * hpPath, passivePath, found: [{ what, path, value }] }. Заполняет только пустые пути (свои
 * пути мастера не трогаем). В режиме «цель из листа» для спасбросков ищем цель, а не бонус.
 */
export function suggestPaths(profile, cands) {
  const result = { saves: {}, skills: {}, acPath: "", hpPath: "", passivePath: "", found: [] };
  const sheetTarget = profile.target === "sheet";
  for (const row of profile.saves ?? []) {
    const field = sheetTarget ? "target" : "bonus";
    if (row[field]) continue;
    const c = bestPath(cands, rowWords(profile, row, SAVE_CATEGORIES), "save");
    if (c) {
      result.saves[row.key] = { [field]: c.path };
      result.found.push({ what: row.label || row.key, path: c.path, value: c.value });
    }
  }
  for (const row of profile.skills ?? []) {
    if (row.bonus) continue;
    const c = bestPath(cands, rowWords(profile, row, SKILL_CATEGORIES), "skill");
    if (c) {
      result.skills[row.key] = { bonus: c.path };
      result.found.push({ what: row.label || row.key, path: c.path, value: c.value });
    }
  }
  if (!profile.acPath) {
    const c = bestPath(cands, WORDS.ac, "ac");
    if (c) {
      result.acPath = c.path;
      result.found.push({ what: "ac", path: c.path, value: c.value });
    }
  }
  if (!profile.passivePath) {
    const c = bestPath(cands, WORDS.notice, "passive");
    if (c) {
      result.passivePath = c.path;
      result.found.push({ what: "passive", path: c.path, value: c.value });
    }
  }
  const hp = bestPath(cands, WORDS.hp, "hp");
  if (hp) {
    result.hpPath = hp.path;
    result.found.push({ what: "hp", path: hp.path, value: hp.value });
  }
  return result;
}

/** Применить предложение к профилю: только пустые поля. */
export function applySuggestion(profile, s) {
  const fill = (rows, map) => rows.map((r) => ({ ...r, ...Object.fromEntries(Object.entries(map[r.key] ?? {}).filter(([k]) => !r[k])) }));
  return {
    ...profile,
    saves: fill(profile.saves, s.saves),
    skills: fill(profile.skills, s.skills),
    acPath: profile.acPath || s.acPath,
    passivePath: profile.passivePath || s.passivePath,
    hpPath: profile.hpPath || s.hpPath,
  };
}
