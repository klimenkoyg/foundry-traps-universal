/* Всё, что в D&D- и PF2e-версиях делала система, — здесь по правилам мастера (core/rules.mjs):
   подписи спасбросков и навыков, числа из листа персонажа по путям, бросок формулой мастера,
   урон в полоску хитов токена или по пути, состояния самой системы (CONFIG.statusEffects).
   Модуль ничего не знает о системе: чего не нашёл — спрашивает у игрока или оставляет ведущему. */

import { CONDITIONS, DAMAGE_TYPES } from "../core/trap.mjs";
import { firstDieFaces, normalizeProfile, readExpr, ruleSnapshot, SAVE_CATEGORIES, saveRow, SKILL_CATEGORIES, skillRow, withBonus } from "../core/rules.mjs";
import { MODULE_ID, SETTINGS } from "./constants.mjs";
import { esc, t } from "./i18n.mjs";

/** Правила мастера (настройка мира), всегда полные и корректные. */
export const rules = () => normalizeProfile(game.settings.get(MODULE_ID, SETTINGS.rules));
/** Снимок правил для карточки розыгрыша. */
export const rulesSnapshot = () => ({ ...ruleSnapshot(rules()), target: rules().target });

const has = (key) => Boolean(game.i18n?.has?.(`TRAPS.${key}`));
/** Подпись строки списка: своя у мастера, иначе перевод модуля для ключей по умолчанию, иначе ключ. */
const rowLabel = (row, key) => row?.label || (has(`RuleKey.${row?.key ?? key}`) ? t(`RuleKey.${row?.key ?? key}`) : row?.key ?? key);

/* ---------- подписи ---------- */

export function abilityLabel(key) {
  return rowLabel(saveRow(rules(), key), key);
}
export const abilityAbbr = abilityLabel;

export function skillLabel(key) {
  return rowLabel(skillRow(rules(), key), key);
}

export function damageLabel(key) {
  if (!key) return "";
  return has(`DamageType.${key}`) ? t(`DamageType.${key}`) : key.charAt(0).toUpperCase() + key.slice(1);
}

function statusEntry(id) {
  const list = CONFIG.statusEffects;
  if (!list || !id) return null;
  return Array.isArray(list) ? list.find((s) => s.id === id) : list[id];
}

/**
 * Как ещё называют состояния каталога в системах: core Foundry («blind», «restrain»), Savage Worlds
 * («entangled», «incapacitated»)… Нет такого id у системы — пробуем эти по порядку.
 */
const ALIASES = {
  blinded: ["blind"],
  deafened: ["deaf"],
  frightened: ["fear", "scared", "shaken"],
  grappled: ["restrain", "restrained", "entangled", "grabbed"],
  incapacitated: ["stun", "stunned"],
  paralyzed: ["paralysis"],
  poisoned: ["poison", "sickened"],
  restrained: ["restrain", "entangled", "bound", "immobilized"],
  stunned: ["stun"],
  unconscious: ["incapacitated", "sleep"],
};

/** Состояние ловушки → id состояния системы: сопоставление мастера, тот же id, похожий id. */
export function statusId(id) {
  const mapped = rules().conditions?.[id];
  if (mapped) return mapped;
  if (!id || statusEntry(id)) return id;
  return (ALIASES[id] ?? []).find((a) => statusEntry(a)) ?? id;
}

export function conditionLabel(id) {
  if (!id) return "";
  const s = statusEntry(statusId(id));
  const name = s?.name ?? s?.label;
  if (name) return game.i18n.localize(name);
  return has(`Condition.${id}`) ? t(`Condition.${id}`) : id;
}

/** Все состояния системы: [{ id, label }]. */
export function systemStatuses() {
  const list = CONFIG.statusEffects;
  const arr = Array.isArray(list) ? list : Object.values(list ?? {});
  return arr.filter((s) => s?.id).map((s) => ({ id: s.id, label: game.i18n.localize(s.name ?? s.label ?? s.id) }));
}

/**
 * Списки для выпадающих меню окна настройки. Сначала — категории каталога («Увернуться →
 * Ловкость»: ловушка пойдёт за правилами мастера, если он их поменяет), потом — свой список мастера.
 */
const category = (cat, label) => [cat, t(`RuleCat.${cat}`, { name: label })];
export const choices = {
  abilities: () => ({
    "": "—",
    ...Object.fromEntries(SAVE_CATEGORIES.map((c) => category(c, abilityLabel(c)))),
    ...Object.fromEntries(rules().saves.map((r) => [r.key, rowLabel(r)])),
  }),
  damageTypes: () => Object.fromEntries([...new Set([...rules().types, ...DAMAGE_TYPES])].map((k) => [k, damageLabel(k)])),
  damageTypesOptional: () => ({ "": "—", ...choices.damageTypes() }),
  skills: () => ({
    ...Object.fromEntries(SKILL_CATEGORIES.map((c) => category(c, skillLabel(c)))),
    ...Object.fromEntries(rules().skills.map((r) => [r.key, rowLabel(r)])),
  }),
  conditions: () => ({
    "": "—",
    ...Object.fromEntries(CONDITIONS.map((k) => [k, conditionLabel(k)])),
    ...Object.fromEntries(systemStatuses().map((s) => [s.id, s.label])),
  }),
};

/* ---------- числа из листа ---------- */

/**
 * Число по пути в персонаже: «system.abilities.dex.save». Если там объект — берём total, mod или
 * value (так устроено во многих системах). → число или null (пути нет или там не число).
 */
export function readNumber(actor, path) {
  if (!actor || !path) return null;
  return readExpr(path, (one) => {
    let v = foundry.utils.getProperty(actor, one);
    // total и mod — раньше value: у навыков dnd5e value — уровень владения (0, 1, 2), а не бонус.
    if (v && typeof v === "object") v = v.total ?? v.mod ?? v.value;
    // «+2» в DCC — строка: Number её прочтёт.
    const n = Number(v);
    return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
  });
}

/** Пассивное значение (обнаружение «пассивно»); null — у этого персонажа его нет. */
export const passiveSkill = (actor) => readNumber(actor, rules().passivePath);

/** КД против атаки ловушки; null — пути нет: попадание отметит ведущий. */
export const armorClass = (actor) => readNumber(actor, rules().acPath);

/** Цель из листа (OSR: «спасбросок против дыхания — 13», d100 ≤ навыка), если у строки есть путь к ней. */
const sheetTarget = (actor, row) => (row?.target ? readNumber(actor, row.target) : null);

/** Своё сравнение строки — в проверку: карточка посчитает исход по нему. */
const withRow = (check, row, target) => ({ ...check, ...(row?.compare ? { compare: row.compare } : {}), ...(target === null ? {} : { target }) });

/* ---------- броски ---------- */

/** Окошко с одним числом (бонус или итог). → число или null (закрыли). */
async function askNumber(title, label, value = "") {
  const DialogV2 = foundry.applications.api.DialogV2;
  try {
    const n = await DialogV2.prompt({
      window: { title },
      content: `<label class="ssl-traps-ask">${esc(label)} <input type="number" name="n" value="${esc(String(value))}" step="1" autofocus></label>`,
      ok: { label: t("Rules.ask.ok"), callback: (event, button) => button.form.elements.n.valueAsNumber },
      rejectClose: false,
    });
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Бросок формулой мастера (или своей у строки) с бонусом → { total, natural, faces, roll }. */
async function rollFormula(bonus, row = null) {
  const formula = row?.formula || rules().formula;
  const roll = await new Roll(withBonus(formula, bonus)).evaluate();
  const die = roll.dice?.[0];
  const faces = die?.faces ?? firstDieFaces(formula);
  const natural = die && die.number === 1 ? (die.results?.find((r) => r.active !== false)?.result ?? die.total) : null;
  return { total: Number(roll.total) || 0, natural, faces, roll };
}

/**
 * Бонус персонажа к проверке: из листа по пути; пути нет — спросить игрока (если так решил мастер
 * и бросок интерактивный), иначе 0. → число или null (игрок закрыл окно).
 */
async function bonusOf(actor, row, { interactive = false, label = "" } = {}) {
  const fromSheet = readNumber(actor, row?.bonus);
  if (fromSheet !== null) return fromSheet;
  if (!interactive || !rules().askBonus) return 0;
  return askNumber(label, t("Rules.ask.bonus", { check: label }), 0);
}

/** Спасбросок без окна и без сообщения — итог сразу в карточку. → { total, natural, faces, target, roll }. */
export async function rollSave(actor, key, dc) {
  const row = saveRow(rules(), key);
  const check = await rollFormula(await bonusOf(actor, row), row);
  return withRow(check, row, sheetTarget(actor, row));
}

/**
 * Спасбросок, который делает сам игрок (или ведущий за него): mode "players" — бросок формулой
 * мастера с сообщением в чате (бонус из листа или из окошка); "enter" — игрок бросил по-своему и
 * вводит итог. → { total, natural, faces, target } или null (окно закрыли).
 */
export async function rollSaveVisible(actor, key, dc, { mode = "players" } = {}) {
  const row = saveRow(rules(), key);
  const label = t("Chat.rollSave", { ability: abilityLabel(key) });
  const target = sheetTarget(actor, row);
  if (mode === "enter") {
    const total = await askNumber(label, t("Rules.ask.total", { check: label }));
    if (total === null) return null;
    return withRow({ total, natural: null }, row, target);
  }
  const bonus = await bonusOf(actor, row, { interactive: true, label });
  if (bonus === null) return null;
  const check = await rollFormula(bonus, row);
  await check.roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: t("Chat.saveFlavor", { ability: abilityLabel(key), dc: target ?? dc }) });
  return withRow(check, row, target);
}

/** Атака ловушки → { roll, natural }. */
export async function rollAttack(bonus) {
  const roll = await new Roll("1d20 + @bonus", { bonus }).evaluate();
  const natural = roll.dice[0]?.total ?? 0;
  return { roll, natural };
}

/**
 * Проверка навыка (обезвреживание, поиск) с сообщением в чате. configure — бросает сам игрок:
 * при «игрок вводит итог» — окошко для итога, иначе бонус из листа или из окошка.
 * whisper — сообщение только ведущему (поиск); silent — без сообщения.
 * → { total, natural, faces, roll? } или null.
 */
export async function rollCheck(actor, key, dc, { configure = false, whisper = false, silent = false } = {}) {
  const row = skillRow(rules(), key);
  const label = skillLabel(key);
  const target = sheetTarget(actor, row);
  if (configure && game.settings.get(MODULE_ID, SETTINGS.saveRolls) === "enter") {
    const total = await askNumber(label, t("Rules.ask.total", { check: label }));
    return total === null ? null : withRow({ total, natural: null }, row, target);
  }
  const bonus = await bonusOf(actor, row, { interactive: configure, label });
  if (bonus === null) return null;
  const check = withRow(await rollFormula(bonus, row), row, target);
  // Тайная проверка, когда персонаж подошёл: без сообщения — ведущий узнает, только если заметил.
  if (silent) return check;
  const data = { speaker: ChatMessage.getSpeaker({ actor }), flavor: label };
  if (whisper) data.whisper = game.users.filter((u) => u.isGM).map((u) => u.id);
  await check.roll.toMessage(data);
  return check;
}

/* ---------- урон и состояния ---------- */

/** Хиты из полоски токена или по пути: { read, write } или null (мастер вычитает сам). */
function hpAccess(actor, token) {
  const p = rules();
  if (p.hp === "none") return null;
  if (p.hp === "path" && p.hpPath) {
    const raw = foundry.utils.getProperty(actor, p.hpPath);
    const path = raw && typeof raw === "object" ? `${p.hpPath}.value` : p.hpPath;
    return {
      read: () => readNumber(actor, path),
      write: async (delta) => {
        const now = readNumber(actor, path);
        if (now === null) return;
        await actor.update({ [path]: Math.max(0, now + delta) });
      },
    };
  }
  const tokenDoc = token?.document ?? token;
  const bar = tokenDoc?.getBarAttribute?.("bar1");
  const attribute = bar?.attribute ?? game.system?.primaryTokenAttribute;
  if (!attribute) return null;
  // Полоска — объект { value, max }: хиты — именно value.
  const path = (() => {
    const raw = foundry.utils.getProperty(actor, `system.${attribute}`);
    return raw && typeof raw === "object" ? `system.${attribute}.value` : `system.${attribute}`;
  })();
  return {
    read: () => readNumber(actor, path),
    // Как правка полоски на токене: система сама учтёт временные хиты, если умеет.
    write: (delta) => actor.modifyTokenAttribute(attribute, delta, true, true),
  };
}

/**
 * parts: [{ value, type }] — урон до множителя. → сколько хитов реально снято, или null —
 * мастер вычитает сам (или хитов у персонажа не нашлось).
 */
export async function applyDamage(actor, parts, multiplier, token = null) {
  const total = Math.floor(parts.reduce((s, p) => s + (Number(p.value) || 0), 0) * multiplier);
  if (total <= 0) return 0;
  const hp = hpAccess(actor, token);
  if (!hp) return null;
  const before = hp.read();
  await hp.write(-total);
  const after = hp.read();
  return before === null || after === null ? null : Math.max(0, before - after);
}

/** Наложить состояние системы. Нет такого у системы — false (в карточке оно останется словами). */
export async function applyCondition(actor, id) {
  const sid = statusId(id);
  if (!sid || !statusEntry(sid)) return false;
  if (actor.statuses?.has?.(sid)) return true;
  await actor.toggleStatusEffect(sid, { active: true });
  return true;
}

/** Для окна «Правила»: какие числа нашлись по путям у выделенного токена. */
export function probe(actor, profile = rules()) {
  const line = (label, path) => ({ label, path, value: path ? readNumber(actor, path) : null });
  return [
    ...profile.saves.flatMap((r) => [line(rowLabel(r), r.bonus), ...(profile.target === "sheet" ? [line(`${rowLabel(r)} · ${t("Rules.target")}`, r.target)] : [])]),
    ...profile.skills.map((r) => line(rowLabel(r), r.bonus)),
    line(t("Rules.fields.acPath"), profile.acPath),
    line(t("Rules.fields.passivePath"), profile.passivePath),
    line(t("Rules.fields.hpPath"), profile.hp === "path" ? profile.hpPath : ""),
  ].filter((l) => l.path);
}
