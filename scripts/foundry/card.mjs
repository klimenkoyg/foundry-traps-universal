/* Карточка срабатывания в чате и всё, что с ней делают.
   Состояние розыгрыша (core/resolve.mjs) лежит во флаге сообщения: у каждой цели видно, почему она
   под ударом, чем проверялась и что получит. По правилам мастера спасбросок бросает модуль, игрок
   кнопкой (или вводит свой итог), либо исход отмечает ведущий кнопками «Успех / Провал»; ведущий
   наносит урон. Менять сообщение может только ведущий, поэтому
   броски игроков приходят ему по сокету модуля, а он дописывает их в карточку. */

import { allChecked, anyHit, counts, damageDue, needsDamageRoll, newTarget, nominal, setDamage, settle, stage, trapSnapshot } from "../core/resolve.mjs";
import { MODULE_ID, SETTINGS, SOCKET, THEME_ATTR } from "./constants.mjs";
import {
  abilityLabel,
  applyCondition,
  applyDamage,
  armorClass,
  conditionLabel,
  damageLabel,
  rollAttack,
  rollSave,
  rollSaveVisible,
  rulesSnapshot,
  skillLabel,
} from "./universal.mjs";
import { rollMessageId, waitForDice } from "./dice.mjs";
import { esc, t } from "./i18n.mjs";
import { ownerIds, postMessage } from "./scene.mjs";
import { setting } from "./settings.mjs";

const FLAG = "resolution";

/* ---------------------------------------------------------------- данные */

const read = (message) => {
  const state = message?.getFlag?.(MODULE_ID, FLAG) ?? message?.flags?.[MODULE_ID]?.[FLAG];
  return state ? foundry.utils.deepClone(state) : null;
};

function tokenDoc(state, id) {
  const scene = game.scenes?.get?.(state.sceneId) ?? (canvas?.scene?.id === state.sceneId ? canvas.scene : null);
  return scene?.tokens?.get?.(id) ?? null;
}

const actorOf = (state, target) => tokenDoc(state, target.id)?.actor ?? game.actors?.get?.(target.actorId) ?? null;

/** Может ли пользователь бросать за эту цель: ведущий или владелец персонажа. */
function canRoll(state, target, user = game.user) {
  if (user.isGM) return true;
  return Boolean(actorOf(state, target)?.testUserPermission?.(user, "OWNER"));
}

/* ---------------------------------------------------------------- карточка */

/** Ждёт ли цель отметки ведущего: так решил мастер или у атаки ловушки нет КД в листе. */
const needsMark = (state, tg) => !tg.res && (state.saves === "gm" || Boolean(tg.mark));

function checkLine(trap) {
  if (trap.mode === "attack") return t("Chat.attack", { bonus: trap.attackBonus });
  if (trap.mode === "save" && trap.rules?.target === "sheet") return t("Chat.saveSheet", { ability: abilityLabel(trap.saveAbility) });
  if (trap.mode === "save") return t("Chat.save", { ability: abilityLabel(trap.saveAbility), dc: trap.saveDC });
  return t("Chat.noCheck");
}

/** «Почему»: под ударом ли и чем закончилась проверка. */
function why(state, tg) {
  const { trap } = state;
  const cause = t(`Chat.cause.${tg.cause}`);
  if (!tg.res && trap.mode === "attack") return `${cause} · ${t("Chat.waitAttackGm", { total: tg.check?.total ?? "—" })}`;
  if (!tg.res && state.saves === "gm") return `${cause} · ${t("Chat.waitGm", { ability: abilityLabel(trap.saveAbility), dc: trap.saveDC })}`;
  if (!tg.res) return `${cause} · ${t("Chat.waitSave", { ability: abilityLabel(trap.saveAbility), dc: trap.saveDC })}`;
  // Исход отметил ведущий: чисел может не быть.
  const marked = tg.by === "mark";
  if (trap.mode === "attack") {
    const outcome = t(tg.res.hit ? "Chat.hit" : "Chat.miss");
    if (marked) return `${cause} · ${t("Chat.whyAttackGm", { total: tg.check?.total ?? "—", outcome })}`;
    const nat = tg.check?.natural === 20 ? ` (${t("Chat.nat20")})` : tg.check?.natural === 1 ? ` (${t("Chat.nat1")})` : "";
    return `${cause} · ${t("Chat.whyAttack", { total: tg.check?.total ?? 0, ac: tg.check?.ac ?? 10, outcome })}${nat}`;
  }
  if (trap.mode === "save") {
    const ok = tg.res.success;
    const m = tg.res.multiplier;
    const effect = m >= 2 ? t("Chat.doubleDamage") : m >= 1 ? t("Chat.fullDamage") : m > 0 ? t("Chat.halfDamage") : t("Chat.noDamage");
    const crit = tg.res.degree === 3 || tg.res.degree === 0 ? ` (${t("Chat.crit")})` : "";
    const outcome = `${t(ok ? "Chat.saveOk" : "Chat.saveFail")}${crit}${state.parts.length ? `, ${effect}` : ""}`;
    if (marked) return `${cause} · ${t("Chat.whySaveGm", { ability: abilityLabel(trap.saveAbility), outcome })}`;
    return `${cause} · ${t("Chat.whySave", { ability: abilityLabel(trap.saveAbility), total: tg.check?.total ?? 0, dc: tg.check?.target ?? trap.saveDC, outcome })}`;
  }
  return `${cause} · ${t("Chat.noCheckWhy")}`;
}

/** Что цель получит или получила. */
function effects(state, tg, st) {
  const bits = [];
  if (st === "roll") return `<span class="st-chip is-wait"><i class="fa-solid fa-dice-d20" inert></i> ${esc(t("Chat.waiting"))}</span>`;
  if (st === "clear") return `<span class="st-chip is-good">${esc(t("Chat.tookNone"))}</span>`;
  const done = st === "applied";
  if (st === "damage") {
    const half = tg.res.multiplier > 0 && tg.res.multiplier < 1 ? ` · ${t("Chat.halfDamage")}` : "";
    bits.push(`<span class="st-chip is-wait"><i class="fa-solid fa-hourglass-half" inert></i> ${esc(t("Chat.damageWait"))}${esc(half)}</span>`);
  } else if (state.parts.length && tg.res.multiplier > 0) {
    const n = nominal(state, tg);
    const dealt = done && Number.isFinite(tg.dealt) ? tg.dealt : n;
    const types = [...new Set(state.parts.map((p) => damageLabel(p.type)))].join(", ");
    const text = done ? t("Chat.takes", { n: dealt }) : t("Chat.willTake", { n });
    const less = done && Number.isFinite(tg.dealt) && tg.dealt < n ? ` <small>${esc(t("Chat.ofNominal", { n }))}</small>` : "";
    bits.push(`<span class="st-chip st-dmg${done ? " is-done" : ""}" data-tooltip="${esc(types)}"><b>${esc(text)}</b>${less}</span>`);
  }
  if (state.trap.condition && tg.res.condition) {
    const text = t(done ? "Chat.condition" : "Chat.willCondition", { condition: conditionLabel(state.trap.condition) });
    bits.push(`<span class="st-chip st-cond${done ? " is-done" : ""}">${esc(text)}</span>`);
  }
  if (done) bits.push(`<span class="st-chip is-applied"><i class="fa-solid fa-check" inert></i> ${esc(t("Chat.applied"))}</span>`);
  return bits.join("");
}

function targetHtml(state, tg, i) {
  const st = stage(state, tg);
  const img = tg.img ? `<img src="${esc(tg.img)}" alt="">` : "";
  const actions = [];
  if (st === "roll" && needsMark(state, tg)) {
    // Исход отмечает ведущий: «Успех / Провал» (у атаки без КД в листе — «Попадание / Промах»).
    const attack = state.trap.mode === "attack";
    const yes = t(attack ? "Chat.markHit" : "Chat.markSuccess");
    const no = t(attack ? "Chat.markMiss" : "Chat.markFail");
    actions.push(`<button type="button" class="st-card-btn is-apply" data-ssl-traps-mark="${i}:2"><i class="fa-solid fa-check" inert></i> ${esc(yes)}</button>`);
    actions.push(`<button type="button" class="st-card-btn is-roll" data-ssl-traps-mark="${i}:1"><i class="fa-solid fa-xmark" inert></i> ${esc(no)}</button>`);
  } else if (st === "roll") {
    const key = state.saves === "enter" ? "Chat.enterSave" : "Chat.rollSave";
    actions.push(`<button type="button" class="st-card-btn is-roll" data-ssl-traps-roll="${i}"><i class="fa-solid fa-dice-d20" inert></i> ${esc(t(key, { ability: abilityLabel(state.trap.saveAbility) }))}</button>`);
  }
  if (st === "ready") {
    const label = state.parts.length && tg.res.multiplier > 0 ? t("Chat.apply") : t("Chat.applyCondition");
    actions.push(`<button type="button" class="st-card-btn is-apply" data-ssl-traps-apply="${i}"><i class="fa-solid fa-heart-crack" inert></i> ${esc(label)}</button>`);
  }
  return `<li class="is-${st}">${img}<div class="st-target"><b>${esc(tg.name)}</b><small class="st-why">${esc(why(state, tg))}</small></div>
    <div class="st-chips">${effects(state, tg, st)}${actions.length ? `<span class="st-target-actions">${actions.join("")}</span>` : ""}</div></li>`;
}

export function cardHtml(state) {
  const { trap } = state;
  const sev = t(`Severity.${trap.severity}`);
  const dmg = needsDamageRoll(state)
    ? `${state.parts.map((p) => `<span>${esc(p.formula)} ${esc(damageLabel(p.type))}</span>`).join(" + ")} <small>· ${esc(t("Chat.damageLater"))}</small>`
    : state.parts.map((p) => `<span><b>${p.value}</b> ${esc(damageLabel(p.type))} <small>${esc(p.formula)}</small></span>`).join(" + ");
  const escape = trap.escapeDC && anyHit(state) ? t("Chat.escape", { skill: skillLabel(trap.escapeSkill), dc: trap.escapeDC }) : "";
  const list = state.targets.length
    ? `<ul class="st-targets">${state.targets.map((tg, i) => targetHtml(state, tg, i)).join("")}</ul>`
    : `<p class="st-empty">${t("Chat.noTargets")}</p>`;
  const c = counts(state);
  const footer = [];
  if (c.roll > 0) footer.push(`<button type="button" class="st-card-btn" data-ssl-traps-roll-all><i class="fa-solid fa-dice" inert></i> ${esc(t("Chat.rollAll"))}</button>`);
  if (needsDamageRoll(state)) footer.push(`<button type="button" class="st-card-btn is-damage" data-ssl-traps-damage data-tooltip="${esc(t("Chat.rollDamageHint"))}"><i class="fa-solid fa-burst" inert></i> ${esc(t("Chat.rollDamage"))}</button>`);
  if (c.ready > 1 || (c.ready === 1 && c.roll > 0)) footer.push(`<button type="button" class="st-card-btn is-apply" data-ssl-traps-apply-all><i class="fa-solid fa-heart-crack" inert></i> ${esc(t("Chat.applyAll"))}</button>`);
  return `<div class="ssl-traps-card" ${THEME_ATTR} data-severity="${trap.severity}">
  <header><i class="${esc(trap.icon)}" inert></i><div><h3>${esc(state.name)}</h3><small>${esc(sev)}</small></div></header>
  ${trap.flavor ? `<p class="st-flavor">${esc(trap.flavor)}</p>` : ""}
  <div class="st-meta"><span>${esc(checkLine(trap))}</span>${dmg ? `<span class="st-damage">${dmg}</span>` : ""}</div>
  ${escape ? `<p class="st-escape"><i class="fa-solid fa-person-arrow-up-from-line" inert></i> ${esc(escape)}</p>` : ""}
  ${list}
  ${footer.length ? `<div class="st-card-actions">${footer.join("")}</div>` : ""}
</div>`;
}

/* ---------------------------------------------------------------- ведущий: броски и урон */

/** Нанести урон и наложить состояние одной цели (мутирует state). */
async function applyTarget(state, i) {
  const tg = state.targets[i];
  if (stage(state, tg) !== "ready") return;
  const actor = actorOf(state, tg);
  if (!actor) return;
  if (state.parts.length && tg.res.multiplier > 0) {
    try {
      tg.dealt = await applyDamage(actor, state.parts, tg.res.multiplier, tokenDoc(state, tg.id));
    } catch (err) {
      console.warn("ssl_traps_universal | урон не нанесён", err);
    }
  }
  if (state.trap.condition && tg.res.condition) {
    try {
      tg.conditioned = await applyCondition(actor, state.trap.condition);
    } catch (err) {
      console.warn("ssl_traps_universal | состояние не наложено", err);
    }
  }
  tg.applied = true;
}

/** Бросить урон один раз на всех (мутирует state). → броски. */
async function rollDamage(state) {
  const rolls = [];
  const values = [];
  for (const p of state.parts) {
    try {
      const roll = await new Roll(p.formula).evaluate();
      rolls.push(roll);
      values.push(roll.total);
    } catch (err) {
      console.warn(`ssl_traps_universal | неверная формула урона «${p.formula}»`, err);
      values.push(0);
    }
  }
  setDamage(state, values);
  return rolls;
}

/** Урон, брошенный позже карточки, — отдельным сообщением: кубики видят все, кто видит карточку. */
async function postDamage(state, rolls) {
  const parts = state.parts.map((p) => `<b>${p.value}</b> ${esc(damageLabel(p.type))} <small>${esc(p.formula)}</small>`).join(" + ");
  const message = await postMessage({
    alias: state.name,
    rolls,
    audience: state.audience ?? "auto",
    content: `<p ${THEME_ATTR} class="ssl-traps-note"><i class="fa-solid fa-burst" inert></i> ${t("Chat.damageRolled", { trap: esc(state.name) })} ${parts}</p>`,
  });
  // С Dice So Nice числа в карточке появляются, когда кубики урона докатились.
  await waitForDice(message);
}

/** Все проверки пришли — бросить урон сам. force — ведущий нажал «Бросить урон», не дожидаясь. */
async function settleDamage(state, force = false) {
  if (!(force ? needsDamageRoll(state) : damageDue(state))) return;
  await postDamage(state, await rollDamage(state));
}

/** Урон «сразу»: применить всем, у кого итог уже есть. */
async function autoApply(state) {
  if (state.damage !== "auto") return;
  for (let i = 0; i < state.targets.length; i++) await applyTarget(state, i);
}

/** Спасбросок за цель без окна и сообщения — итог сразу в карточке (модуль или «бросить за всех»). */
async function quietSave(state, i, by) {
  const tg = state.targets[i];
  const actor = actorOf(state, tg);
  const check = actor ? await rollSave(actor, state.trap.saveAbility, state.trap.saveDC) : null;
  const { roll, ...result } = check ?? { total: 0 };
  state.targets[i] = settle(state.trap, tg, result, by);
  return roll ?? null;
}

/** Изменения одного сообщения — по очереди: два броска игроков одновременно не затирают друг друга. */
const queues = new Map();
function mutate(messageId, fn) {
  const prev = queues.get(messageId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const message = game.messages.get(messageId);
      const state = read(message);
      if (!state) return;
      if ((await fn(state)) === false) return;
      await message.update({ content: cardHtml(state), [`flags.${MODULE_ID}.${FLAG}`]: state });
    });
  queues.set(messageId, next);
  return next;
}

/**
 * Начать розыгрыш (активный ведущий): цели, атаки и спасброски модуля, карточка в чате.
 * tokens — кто под ударом; trigger — кто наступил; manual — ловушку запустил ведущий.
 */
export async function startCard({ scene, trap, name, tokens, trigger, manual, cause: forced = null, parts, rolls = [] }) {
  const saves = ["players", "enter", "module", "gm"].includes(setting(SETTINGS.saveRolls)) ? setting(SETTINGS.saveRolls) : "players";
  const damage = setting(SETTINGS.damageMode) === "auto" ? "auto" : "button";
  const snapshot = trapSnapshot(trap, rulesSnapshot());
  const state = { v: 1, sceneId: scene.id, name, trap: snapshot, parts: parts.map(({ type, formula }) => ({ value: null, type, formula })), rolled: false, targets: [], saves, damage };
  const allRolls = [...rolls];
  for (const token of tokens) {
    // forced — особая причина для того, кто запустил ловушку (например, «ошибается, обезвреживая»).
    const own = trigger && token.id === trigger.id;
    const cause = own && forced ? forced : manual ? "manual" : own ? "trigger" : "area";
    let tg = newTarget({ id: token.id, actorId: token.actor?.id, name: token.name, img: token.texture?.src ?? "", cause });
    if (snapshot.mode === "attack") {
      const { roll, natural } = await rollAttack(trap.attackBonus);
      allRolls.push(roll);
      const ac = armorClass(token.actor);
      // КД в листе не нашёлся — попадание отметит ведущий, итог атаки в карточке есть.
      if (ac === null) tg = { ...tg, mark: true, check: { total: roll.total, natural } };
      else tg = settle(snapshot, tg, { total: roll.total, natural, faces: 20, ac }, "module");
    } else if (snapshot.mode === "save") {
      // Режим «отмечает ведущий» — ждём его кнопок; персонажа без игрока бросает модуль.
      const waits = saves === "gm" || ((saves === "players" || saves === "enter") && ownerIds(token.actor).length > 0);
      if (!waits) {
        state.targets.push(tg);
        const roll = await quietSave(state, state.targets.length - 1, "module");
        if (roll) allRolls.push(roll);
        continue;
      }
    } else {
      tg = settle(snapshot, tg);
    }
    state.targets.push(tg);
  }
  // Ждать нечего (атака, без проверки, спасброски модуля, никого нет) — урон сразу, кубики в карточке.
  if (state.parts.length && (allChecked(state) || !state.targets.length)) allRolls.push(...(await rollDamage(state)));
  await autoApply(state);

  // Карточка видна всем или только ведущим; бросать свои спасброски — владельцам целей.
  let audience = "auto";
  if (setting(SETTINGS.chatMode) === "gm") {
    const owners = state.targets.filter((tg) => !tg.res).flatMap((tg) => ownerIds(actorOf(state, tg)));
    audience = owners.length ? [...new Set(owners)] : "gm";
  }
  state.audience = audience;
  return postMessage({ alias: name, rolls: allRolls, content: cardHtml(state), audience, flags: { [FLAG]: state } });
}

/** Игрок прислал свой спасбросок. Принимает только активный ведущий. */
async function receiveSave({ messageId, index, total, natural = null, faces = null, target = null, compare = null, userId }) {
  if (!game.user.isActiveGM) return;
  const user = game.users.get(userId);
  await mutate(messageId, async (state) => {
    const tg = state.targets[index];
    if (!tg || stage(state, tg) !== "roll" || !user || !canRoll(state, tg, user)) return false;
    const check = { total: Number(total) || 0, natural, faces, ...(target === null ? {} : { target }), ...(compare ? { compare } : {}) };
    state.targets[index] = settle(state.trap, tg, check, user.isGM ? "gm" : "player");
    await settleDamage(state);
    await autoApply(state);
  });
}

export function registerCardSocket() {
  game.socket.on(SOCKET, (payload) => {
    if (payload?.action === "trapSave") receiveSave(payload).catch((err) => console.warn("ssl_traps_universal | спасбросок игрока", err));
  });
}

/* ---------------------------------------------------------------- кнопки в карточке */

async function onRoll(message, index) {
  const state = read(message);
  const tg = state?.targets[index];
  if (!tg || stage(state, tg) !== "roll" || !canRoll(state, tg)) return;
  const actor = actorOf(state, tg);
  if (!actor) return;
  const check = await rollSaveVisible(actor, state.trap.saveAbility, state.trap.saveDC, { mode: state.saves === "enter" ? "enter" : "players" });
  if (!check) return;
  await waitForDice(rollMessageId(check));
  const { roll, ...result } = check;
  if (game.user.isGM) {
    await mutate(message.id, async (s) => {
      if (stage(s, s.targets[index]) !== "roll") return false;
      s.targets[index] = settle(s.trap, s.targets[index], result, "gm");
      await settleDamage(s);
      await autoApply(s);
    });
  } else {
    game.socket.emit(SOCKET, { action: "trapSave", messageId: message.id, index, ...result, userId: game.user.id });
  }
}

/** Ведущий отметил исход: degree 2 — успех (попадание), 1 — провал (промах). */
function onMark(message, index, degree) {
  return mutate(message.id, async (state) => {
    const tg = state.targets[index];
    if (!tg || stage(state, tg) !== "roll") return false;
    state.targets[index] = settle(state.trap, tg, { ...(tg.check ?? {}), degree }, "mark");
    await settleDamage(state);
    await autoApply(state);
  });
}

function onRollAll(message) {
  return mutate(message.id, async (state) => {
    let any = false;
    for (let i = 0; i < state.targets.length; i++) {
      // Атаку без КД бросками не решить — её отмечает ведущий.
      if (stage(state, state.targets[i]) !== "roll" || state.targets[i].mark) continue;
      await quietSave(state, i, "gm");
      any = true;
    }
    if (!any) return false;
    await settleDamage(state);
    await autoApply(state);
  });
}

/** «Бросить урон» — не дожидаясь отстающих спасбросков. */
function onRollDamage(message) {
  return mutate(message.id, async (state) => {
    if (!needsDamageRoll(state)) return false;
    await settleDamage(state, true);
    await autoApply(state);
  });
}

function onApply(message, index) {
  return mutate(message.id, async (state) => {
    if (stage(state, state.targets[index]) !== "ready") return false;
    await applyTarget(state, index);
  });
}

function onApplyAll(message) {
  return mutate(message.id, async (state) => {
    let any = false;
    for (let i = 0; i < state.targets.length; i++) {
      if (stage(state, state.targets[i]) !== "ready") continue;
      await applyTarget(state, i);
      any = true;
    }
    return any ? undefined : false;
  });
}

function bind(el, fn) {
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  el.addEventListener("click", async (event) => {
    event.preventDefault();
    el.disabled = true;
    try {
      await fn();
    } catch (err) {
      console.error("ssl_traps_universal | кнопка карточки", err);
    } finally {
      el.disabled = false;
    }
  });
}

/** Хук renderChatMessageHTML: кнопки — только тем, кому они нужны. */
export function onRenderCard(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const state = read(message);
  if (!root?.querySelectorAll || !state) return;
  for (const el of root.querySelectorAll("[data-ssl-traps-roll]")) {
    const index = Number(el.dataset.sslTrapsRoll);
    if (!canRoll(state, state.targets[index] ?? {})) el.remove();
    else bind(el, () => onRoll(message, index));
  }
  for (const el of root.querySelectorAll("[data-ssl-traps-apply], [data-ssl-traps-apply-all], [data-ssl-traps-roll-all], [data-ssl-traps-damage], [data-ssl-traps-mark]")) {
    if (!game.user.isGM) {
      el.remove();
      continue;
    }
    if (el.hasAttribute("data-ssl-traps-mark")) {
      const [index, degree] = el.dataset.sslTrapsMark.split(":").map(Number);
      bind(el, () => onMark(message, index, degree));
    } else if (el.hasAttribute("data-ssl-traps-apply")) bind(el, () => onApply(message, Number(el.dataset.sslTrapsApply)));
    else if (el.hasAttribute("data-ssl-traps-apply-all")) bind(el, () => onApplyAll(message));
    else if (el.hasAttribute("data-ssl-traps-damage")) bind(el, () => onRollDamage(message));
    else bind(el, () => onRollAll(message));
  }
  // Пустые ряды кнопок (у игрока) не оставляем.
  for (const box of root.querySelectorAll(".st-target-actions, .st-card-actions")) if (!box.children.length) box.remove();
}

