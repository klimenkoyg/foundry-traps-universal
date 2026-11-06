/* Розыгрыш срабатывания ловушки: кто попал под неё, чем проверялся, что получит.
   Чистые данные без Foundry. Их хранит карточка в чате: игроки дописывают свои спасброски,
   ведущий бросает за отсутствующих и наносит урон (foundry/card.mjs).

   state = {
     sceneId, name,
     trap: снимок нужных полей ловушки (trapSnapshot),
     parts: [{ value, type, formula }]   — урон один раз на всех; value null, пока не брошен,
     rolled — урон брошен (сам — когда пришли все проверки, или кнопкой ведущего),
     targets: [{ id, actorId, name, img, cause, check, by, res, applied, dealt, conditioned }],
     saves: "players" | "module", damage: "button" | "auto"
   }
   cause — почему цель под ударом: "trigger" наступила, "area" в области, "manual" ведущий запустил.
   check — { total, natural?, faces?, ac?, target? }, или { degree } — исход отметил ведущий, или
   null (ещё не бросали); res — итог resolveTarget или null. */

import { resolveTarget, trapMode } from "./trap.mjs";

/** Кто бросает спасброски. */
export { SAVE_ROLLS } from "./rules.mjs";
/** Когда наносить урон и состояние. */
export const DAMAGE_MODES = ["button", "auto"];

/**
 * Поля ловушки, которые нужны розыгрышу (копия на момент срабатывания), и правила мастера, по
 * которым считать исход (ruleSnapshot из core/rules.mjs): мастер может поменять правила, а уже
 * открытая карточка доиграет по старым.
 */
export function trapSnapshot(trap, rules = {}) {
  return {
    rules: { compare: "gte", crits: "none", critDouble: false, failBy: 5, ...rules },
    mode: trapMode(trap),
    icon: trap.icon,
    severity: trap.severity,
    flavor: trap.flavor ?? "",
    attackBonus: trap.attackBonus ?? null,
    saveAbility: trap.saveAbility ?? "",
    saveDC: trap.saveDC,
    onSave: trap.onSave,
    condition: trap.condition ?? "",
    escapeDC: trap.escapeDC ?? 0,
    escapeSkill: trap.escapeSkill ?? "",
  };
}

/** Новая цель розыгрыша. */
export const newTarget = ({ id, actorId, name, img = "", cause = "trigger" }) => ({
  id,
  actorId,
  name,
  img,
  cause,
  check: null,
  by: null,
  res: null,
  applied: false,
  dealt: null,
  conditioned: false,
});

/** Записать итог проверки цели (by — кто бросал: "player", "gm", "module"). Без проверки — check null. */
export function settle(trap, target, check = null, by = null) {
  const res =
    trap.mode === "attack" ? resolveTarget(trap, { attack: check }) : trap.mode === "save" ? resolveTarget(trap, { save: check }) : resolveTarget(trap);
  return { ...target, check: check ? { ...check } : null, by, res };
}

export const totalDamage = (parts = []) => parts.reduce((sum, p) => sum + (Number(p.value) || 0), 0);

/** Урон ещё не брошен (есть что бросать). */
export const needsDamageRoll = (state) => state.parts.length > 0 && !state.rolled;

/** Все проверки пришли: ни одна цель не ждёт спасброска. */
export const allChecked = (state) => state.targets.every((t) => t.res);

/** Пора бросать урон сам: проверки все, а урон ещё не брошен. */
export const damageDue = (state) => needsDamageRoll(state) && allChecked(state);

/** Записать брошенный урон: values — числа по порядку частей. */
export function setDamage(state, values) {
  state.parts = state.parts.map((p, i) => ({ ...p, value: Number(values[i]) || 0 }));
  state.rolled = true;
  return state;
}

/** Получит ли цель урон (а не только состояние). */
const takesDamage = (state, target) => state.parts.length > 0 && target.res.multiplier > 0;

/** Сколько урона получит цель до сопротивлений (половина — с округлением вниз); null — урон не брошен. */
export function nominal(state, target) {
  if (!target.res) return 0;
  if (takesDamage(state, target) && needsDamageRoll(state)) return null;
  return Math.floor(totalDamage(state.parts) * target.res.multiplier);
}

/** Есть ли что применить к цели: урон или состояние. */
export function hasEffect(state, target) {
  if (!target.res) return false;
  return (state.parts.length > 0 && target.res.multiplier > 0) || Boolean(state.trap.condition && target.res.condition);
}

/**
 * Стадия цели: "roll" — ждёт спасброска; "damage" — итог есть, ждёт броска урона;
 * "ready" — можно наносить; "applied" — нанесено; "clear" — обошлось (промах, успех без урона).
 */
export function stage(state, target) {
  if (!target.res) return "roll";
  if (target.applied) return "applied";
  if (!hasEffect(state, target)) return "clear";
  return takesDamage(state, target) && needsDamageRoll(state) ? "damage" : "ready";
}

/** Сколько целей на каждой стадии. */
export function counts(state) {
  const c = { roll: 0, damage: 0, ready: 0, applied: 0, clear: 0 };
  for (const t of state.targets) c[stage(state, t)]++;
  return c;
}

/** Показывать ли строку «выбраться»: хоть кого-то задело. */
export const anyHit = (state) => state.targets.some((t) => t.res && (t.res.multiplier > 0 || t.res.condition));
