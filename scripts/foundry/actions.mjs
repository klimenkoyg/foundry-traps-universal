/* Действия ведущего с ловушками: поставить, взвести, показать, обезвредить, искать, сохранить;
   триггеры ловушки — поставить, убрать. */

import { activatorSpots, moveShape, placementRect, quarterTurn, rangeCells, rectCells, rectCenter, rectContains, turnPivot } from "../core/geometry.mjs";
import { addNoticer, fromBehaviorData, knowsTrap, MAX_ACTIVATORS, normalizeTrap, notices, resolveDisarm, toBehaviorData } from "../core/trap.mjs";
import { ACTIVATOR_COLOR, ACTIVATOR_TYPE, BEHAVIOR_TYPE, MODULE_ID, SETTINGS, SEVERITY_COLOR, THEME_ATTR } from "./constants.mjs";
import { passiveSkill, rollCheck, rules, rulesSnapshot, skillLabel } from "./universal.mjs";
import { checkDegree } from "../core/rules.mjs";
import { rollMessageId, waitForDice } from "./dice.mjs";
import { esc, t } from "./i18n.mjs";
import { getEntry, saveCustom } from "./library.mjs";
import { noticeCard, visButton } from "./chat.mjs";
import {
  activatorBehavior,
  activatorsOf,
  cellsBetween,
  hasLineOfSight,
  isRevealed,
  ownerIds,
  postMessage,
  regionBounds,
  sceneTraps,
  setVisible,
} from "./scene.mjs";
import { setting } from "./settings.mjs";
import { fireTrap } from "./trigger.mjs";

/**
 * Поставить ловушку: point — точка сцены (центр клетки под курсором).
 * source — id из библиотеки или запись { id, trap, name, text, flavor } из окна настройки.
 */
export async function placeTrap(scene, source, point) {
  const entry = typeof source === "string" ? getEntry(source) : source;
  if (!entry || !scene) return null;
  const trap = normalizeTrap(entry.trap);
  const rect = placementRect(point, trap.width, scene.grid.size, trap.height);
  const system = toBehaviorData(trap, { flavor: entry.flavor, text: entry.text });
  if (entry.id) system.trapId = entry.id;
  const name = entry.name || trap.name || t("Title");
  const data = {
    name,
    color: SEVERITY_COLOR[trap.severity] ?? SEVERITY_COLOR.dangerous,
    shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }],
    visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
    behaviors: [{ type: BEHAVIOR_TYPE, name, system }],
    flags: { [MODULE_ID]: { trapId: entry.id ?? trap.id } },
  };
  // v14: области живут на уровнях сцены — ставим на тот, что сейчас открыт.
  if (game.release.generation >= 14 && canvas.scene?.id === scene.id && canvas.level?.id) data.levels = [canvas.level.id];
  const [region] = await scene.createEmbeddedDocuments("Region", [data]);
  if (!region) return null;
  // Триггеры из предустановки ловушки — в её области, дальше ведущий их передвигает. Не вышли
  // (например, мир не перезапустили после обновления модуля) — ловушка срабатывает от своей области.
  if (trap.activators) {
    try {
      await addActivators(region, trap.activators);
    } catch (err) {
      console.warn(`${MODULE_ID} | триггер не поставился`, err);
      ui.notifications.warn(t("Notify.activatorFailed", { name }));
    }
  }
  ui.notifications.info(t("Notify.placed", { name }));
  return region;
}

/** Поведение «Ловушка» области. */
const trapBehaviorOf = (region) => [...(region?.behaviors ?? [])].find((b) => b.type === BEHAVIOR_TYPE) ?? null;

/**
 * Поставить ловушке ещё count триггеров (не больше трёх всего). Они встают в клетки её области,
 * свободные от других триггеров, бирюзовые; ведущий перетаскивает их за ручку на карте. Это обычные
 * области сцены. → созданные области.
 */
export async function addActivators(trapRegion, count = 1) {
  const scene = trapRegion?.parent;
  if (!scene) return [];
  const existing = activatorsOf(trapRegion);
  const n = Math.max(0, Math.min(count, MAX_ACTIVATORS - existing.length));
  if (!n) return [];
  const behavior = trapBehaviorOf(trapRegion);
  const spots = activatorSpots(regionBounds(trapRegion), n, scene.grid.size || 100, existing.map(regionBounds));
  const name = `${behavior?.name || trapRegion.name} · ${t("ActivatorName")}`;
  // v14: на том же уровне сцены, что и ловушка.
  const levels = trapRegion.levels;
  const onLevels = game.release?.generation >= 14 && (levels?.size || levels?.length) ? { levels: [...levels] } : {};
  const data = spots.map((rect) => ({
    name,
    color: ACTIVATOR_COLOR,
    shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }],
    visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
    behaviors: [{ type: ACTIVATOR_TYPE, name, system: { trap: trapRegion.id } }],
    ...onLevels,
  }));
  return (await scene.createEmbeddedDocuments("Region", data)) ?? [];
}

/** Триггеры 0.2.4 были цвета опасности — перекрасить в бирюзовый (делает активный ведущий). */
export async function recolorActivators(scene) {
  if (!scene) return;
  const css = (c) => String(c?.css ?? c ?? "").toLowerCase();
  const updates = [...(scene.regions ?? [])]
    .filter((r) => activatorBehavior(r) && css(r.color) !== ACTIVATOR_COLOR)
    .map((r) => ({ _id: r.id, color: ACTIVATOR_COLOR }));
  if (updates.length) await scene.updateEmbeddedDocuments("Region", updates);
}

/** Убрать триггеры ловушки: все или только последние, чтобы осталось keep. */
export async function removeActivators(trapRegion, keep = 0) {
  const scene = trapRegion?.parent;
  const ids = activatorsOf(trapRegion)
    .slice(Math.max(0, keep))
    .map((r) => r.id)
    .filter((id) => scene?.regions?.has?.(id) ?? true);
  if (!ids.length) return 0;
  try {
    await scene.deleteEmbeddedDocuments("Region", ids);
  } catch (err) {
    // Ведущий удалял ловушку вместе с триггерами — их уже нет.
    console.warn(`${MODULE_ID} | триггеры уже удалены`, err);
  }
  return ids.length;
}

/** Сколько у ловушки триггеров на сцене — ровно count: недостающие добавить, лишние (последние) убрать. */
export async function setActivatorCount(trapRegion, count) {
  const have = activatorsOf(trapRegion).length;
  const want = Math.max(0, Math.min(MAX_ACTIVATORS, Number(count) || 0));
  if (want > have) await addActivators(trapRegion, want - have);
  else if (want < have) await removeActivators(trapRegion, want);
  const behavior = trapBehaviorOf(trapRegion);
  if (behavior && behavior.system.activators !== want) await behavior.update({ "system.activators": want });
  return want;
}

/**
 * Сдвинуть область ловушки или триггера на (dx, dy) пикселей сцены. withInside — у ловушки: её
 * триггеры, которые лежат внутри неё, едут вместе с ней (снаружи — остаются, где их поставили).
 */
export async function moveRegion(region, dx, dy, { withInside = false } = {}) {
  const scene = region?.parent;
  if (!scene || (!dx && !dy)) return;
  const shifted = (r) => ({ _id: r.id, shapes: r.shapes.map((sh) => moveShape(sh.toObject?.() ?? { ...sh }, dx, dy)) });
  const updates = [shifted(region)];
  // Точка поворота на 90° едет вместе с ловушкой.
  const pivot = region.getFlag?.(MODULE_ID, "pivot");
  if (pivot?.at) {
    const [x, y, w, h] = pivot.at;
    updates[0][`flags.${MODULE_ID}.pivot`] = { x: pivot.x + dx, y: pivot.y + dy, at: [x + dx, y + dy, w, h] };
  }
  if (withInside) {
    const b = regionBounds(region);
    for (const part of activatorsOf(region)) if (rectContains(b, rectCenter(regionBounds(part)))) updates.push(shifted(part));
  }
  await scene.updateEmbeddedDocuments("Region", updates);
}

/**
 * Повернуть ловушку на 90° по часовой стрелке (ширина ↔ высота) вместе с триггерами внутри неё.
 * Поворачиваем вокруг середины средней клетки и запоминаем эту точку: четыре нажатия возвращают
 * ловушку точно на место. Только для области из одного прямоугольника. → false, если нельзя.
 */
export async function rotateTrap90(region) {
  const scene = region?.parent;
  const shapes = region?.shapes ?? [];
  if (!scene || shapes.length !== 1 || shapes[0].type !== "rectangle") return false;
  const grid = scene.grid.size || 100;
  const b = regionBounds(region);
  // Точка поворота живёт, пока область та же, что после прошлого ↻: поменяли её иначе (в настройке,
  // в «Регионах») — считаем заново.
  const saved = region.getFlag?.(MODULE_ID, "pivot");
  const same = (r) => Array.isArray(saved?.at) && saved.at.join() === [r.x, r.y, r.width, r.height].join();
  const pivot = same(b) ? { x: saved.x, y: saved.y } : turnPivot(b, grid);
  const next = quarterTurn(b, pivot);
  const rect = (r) => [{ type: "rectangle", ...r, rotation: 0, hole: false }];
  const updates = [{ _id: region.id, shapes: rect(next), [`flags.${MODULE_ID}.pivot`]: { ...pivot, at: [next.x, next.y, next.width, next.height] } }];
  for (const part of activatorsOf(region)) {
    const pb = regionBounds(part);
    if (rectContains(b, rectCenter(pb))) updates.push({ _id: part.id, shapes: rect(quarterTurn(pb, pivot)) });
  }
  await scene.updateEmbeddedDocuments("Region", updates);
  const behavior = trapBehaviorOf(region);
  if (behavior) await behavior.update({ "system.width": behavior.system.height, "system.height": behavior.system.width });
  return true;
}

/** Ловушку на сцене поправили в окне настройки: поведение, имя, цвет и размер области, триггеры. */
export async function updatePlaced(region, behavior, trap) {
  const t0 = normalizeTrap(trap);
  const system = toBehaviorData(t0, { flavor: t0.flavor, text: t0.text });
  system.trapId = behavior.system.trapId || system.trapId;
  const change = { name: t0.name };
  for (const [key, value] of Object.entries(system)) change[`system.${key}`] = value;
  await behavior.update(change);

  const regionChange = { name: t0.name, color: SEVERITY_COLOR[t0.severity] ?? SEVERITY_COLOR.dangerous };
  const grid = region.parent.grid.size;
  const b = regionBounds(region);
  const cells = rectCells(b, grid);
  if (cells.width !== t0.width || cells.height !== t0.height) {
    const rect = placementRect({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, t0.width, grid, t0.height);
    regionChange.shapes = [{ type: "rectangle", ...rect, rotation: 0, hole: false }];
  }
  await region.update(regionChange);
  // Триггеров ровно столько, сколько выбрано в окне (оно открывается с их числом на сцене).
  await setActivatorCount(region, t0.activators);
}

/** Взвести / выключить. Взведённая заново больше не «обезврежена» и для игроков. */
export const setArmed = (behavior, armed) => behavior.update(armed ? { disabled: false, "system.disarmed": false } : { disabled: true });

/** Показать игрокам / скрыть. Показанная считается замеченной. */
export async function setRevealed(region, behavior, revealed) {
  await setVisible(region, revealed);
  if (revealed && !behavior.system.detected) await behavior.update({ "system.detected": true });
}

/** Показать игрокам или спрятать все ловушки сцены. → сколько ловушек изменилось. */
export async function setAllRevealed(scene, revealed) {
  const done = new Set();
  let changed = 0;
  for (const { region, behavior } of sceneTraps(scene)) {
    if (done.has(region.id)) continue;
    done.add(region.id);
    if (isRevealed(region) === Boolean(revealed)) continue;
    await setRevealed(region, behavior, revealed);
    changed++;
  }
  return changed;
}

/** Кому ведущий сообщил о ловушке лично (кнопка «Сообщить только игроку»): id персонажей. */
export function toldTo(region) {
  const list = region?.getFlag?.(MODULE_ID, "toldTo");
  return Array.isArray(list) ? list : [];
}

/**
 * Знает ли игрок о ловушке так, что ему можно её показать: её показали всем или ведущий сообщил
 * этому персонажу. «Заметил, но ведущий ещё не решил» — не считается: иначе кнопка выдала бы ловушку.
 */
export const playerKnows = (region, actorId) => isRevealed(region) || toldTo(region).includes(actorId);

/** Кто уже заметил ловушку: [{ id, name }] — флаг области. */
export function noticedBy(region) {
  const list = region.getFlag?.(MODULE_ID, "noticedBy");
  return Array.isArray(list) ? list : [];
}

/** Знает ли персонаж о ловушке: её показали всем или он уже замечал её. */
const knows = (region, token) => knowsTrap({ revealed: isRevealed(region), noticedBy: noticedBy(region) }, token.actor?.id ?? token.id);

/** Шёпот игроку (и ведущему): «… замечает ловушку»; у ведущего в нём кнопка «показать / скрыть». */
export function tellPlayer(region, behavior, token) {
  const text = t("Chat.noticed", { name: esc(token.name), trap: esc(behavior.name) });
  return postMessage({
    alias: t("Title"),
    audience: ownerIds(token.actor),
    content: `<p ${THEME_ATTR} class="ssl-traps-note"><i class="fa-solid fa-eye" inert></i> ${text}${visButton(region)}</p>`,
  });
}

/**
 * Персонаж заметил ловушку; how — { kind: "passive" | "approach" | "search", skill, value, dc }.
 * Режим «сразу показать»: ловушка видна всем, игроку и ведущему приходит шёпот.
 * Режим «сообщить ведущему»: игроки ничего не узнают; ведущему — шёпот, кто и чем заметил,
 * с кнопками «показать игрокам», «сообщить только игроку», «на карте» (foundry/chat.mjs).
 * Каждого персонажа учитываем один раз → true, если он узнал о ловушке только сейчас.
 */
export async function markDetected(region, behavior, token, how = null) {
  if (knows(region, token)) return false;
  const who = { id: token.actor?.id ?? token.id, name: token.name };
  await behavior.update({ "system.detected": true });
  await region.update({ [`flags.${MODULE_ID}.noticedBy`]: addNoticer(noticedBy(region), who) });
  if (setting(SETTINGS.detectMode) === "reveal") {
    await setVisible(region, true);
    await tellPlayer(region, behavior, token);
    return true;
  }
  await postMessage({ alias: t("Title"), audience: "gm", content: noticeCard({ region, behavior, token, how }) });
  ui.notifications.info(t("Notify.noticed", { name: token.name, trap: behavior.name }));
  return true;
}

/**
 * Ловушки сцены, которые токен может заметить: не дальше, чем «заметить с» у самой ловушки (по
 * клеткам, как линейка Foundry: 10 фт — через одну пустую клетку, в том числе по диагонали),
 * не обезврежены и, если включено, в прямой видимости — сквозь стену и закрытую дверь не заметить.
 */
function trapsNear(token) {
  const scene = token.parent;
  const sight = setting(SETTINGS.detectSight) !== false;
  return sceneTraps(scene).filter(({ region, behavior }) => {
    if (behavior.disabled) return false;
    const range = rangeCells(behavior.system.detectRange ?? 10) + 1e-6;
    // Заметить можно и саму ловушку, и любой её триггер — что ближе и что видно.
    return [region, ...activatorsOf(region)].some((part) => cellsBetween(token, part) <= range && (!sight || hasLineOfSight(token, part)));
  });
}

/** Кто уже получил тайную проверку у этой ловушки: id персонажей (флаг области). */
function checkedBy(region) {
  const list = region.getFlag?.(MODULE_ID, "checkedBy");
  return Array.isArray(list) ? list : [];
}

/** Заметил ли: итог против Сл обнаружения по правилам мастера (не меньше / не больше, криты). */
const spotted = (check, dc) => checkDegree(check, check?.target ?? dc, rulesSnapshot()) >= 2;

/**
 * Токен игрока передвинулся к ловушкам. Как замечать, решает мастер:
 * «пассивно» — число из листа против Сл; «проверкой» — модуль тайно бросает навык ловушки
 * (один раз на ловушку для каждого персонажа, иначе с каждым шагом кто-нибудь да заметил бы);
 * «никак» — только вручную.
 */
export async function checkPassive(token) {
  const actor = token.actor;
  if (!actor?.hasPlayerOwner) return;
  const mode = rules().detect;
  if (mode === "off") return;
  for (const { region, behavior } of trapsNear(token)) {
    if (knows(region, token)) continue;
    const skill = behavior.system.detectSkill || "notice";
    const dc = behavior.system.detectDC;
    if (mode === "passive") {
      const value = passiveSkill(actor);
      if (value === null || !notices(value, dc)) continue;
      await markDetected(region, behavior, token, { kind: "passive", skill, value, dc });
      continue;
    }
    if (checkedBy(region).includes(actor.id)) continue;
    await region.update({ [`flags.${MODULE_ID}.checkedBy`]: [...checkedBy(region), actor.id] });
    const check = await rollCheck(actor, skill, dc, { silent: true });
    if (check && spotted(check, dc)) await markDetected(region, behavior, token, { kind: "approach", skill, value: check.total, dc });
  }
}

/** Поиск ловушек: каждый выделенный токен бросает навык обнаружения (итог видит ведущий). */
export async function searchWith(tokens) {
  // Бросаем каждым навыком, каким замечают ловушки этой сцены, — по сцене, а не по тому, что рядом:
  // иначе сам бросок выдал бы, что ловушка близко.
  const skills = [...new Set(["notice", ...sceneTraps(tokens[0]?.parent).map(({ behavior }) => behavior.system.detectSkill || "notice")])];
  for (const token of tokens) {
    if (!token.actor) continue;
    const rolls = {};
    for (const skill of skills) {
      rolls[skill] = await rollCheck(token.actor, skill, undefined, { whisper: true });
      await waitForDice(rollMessageId(rolls[skill]));
    }
    let found = 0;
    let known = 0;
    for (const { region, behavior } of trapsNear(token)) {
      if (knows(region, token)) {
        known++;
        continue;
      }
      const skill = behavior.system.detectSkill || "notice";
      const check = rolls[skill];
      if (!check || !spotted(check, behavior.system.detectDC)) continue;
      if (await markDetected(region, behavior, token, { kind: "search", skill, value: check.total, dc: behavior.system.detectDC })) found++;
    }
    if (found) continue;
    // Ничего нового. В режиме «сообщить ведущему» игрок не должен догадаться по тишине или по ответу,
    // поэтому ответ получает только ведущий.
    const gmOnly = setting(SETTINGS.detectMode) !== "reveal";
    const key = known ? "Chat.searchNothingNew" : gmOnly ? "Chat.searchNoneGm" : "Chat.searchNone";
    await postMessage({
      alias: t("Title"),
      audience: gmOnly ? "gm" : ownerIds(token.actor),
      content: `<p ${THEME_ATTR} class="ssl-traps-note">${t(key, { name: esc(token.name), value: rolls.notice?.total ?? "—" })}</p>`,
    });
  }
}

/**
 * Попытка обезвредить, бросает ведущий сразу. В режиме «исходы отмечает ведущий» вместо броска —
 * окошко «Обезврежена / Не вышло / Сработала».
 */
export async function attemptDisarm(region, behavior, token) {
  const trap = normalizeTrap(behavior.system.toObject());
  if (setting(SETTINGS.saveRolls) === "gm") {
    const outcome = await askDisarmOutcome(behavior, token);
    return outcome ? finishDisarm(region, behavior, token, { outcome }) : null;
  }
  const check = await rollCheck(token.actor, trap.disarmSkill, trap.disarmDC);
  if (!check) return null;
  await waitForDice(rollMessageId(check));
  return finishDisarm(region, behavior, token, check);
}

/** Окошко ведущему: чем закончилась попытка обезвредить. → "success" | "fail" | "triggered" | null. */
async function askDisarmOutcome(behavior, token) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const skill = esc(skillLabel(behavior.system.disarmSkill));
  try {
    return await DialogV2.wait({
      window: { title: t("Chat.disarmAskGmTitle") },
      content: `<p>${t("Chat.disarmAskGm", { name: esc(token.name), trap: esc(behavior.name), skill, dc: behavior.system.disarmDC })}</p>`,
      buttons: [
        { action: "success", label: t("Chat.disarmMarkOk"), icon: "fa-solid fa-shield-halved" },
        { action: "fail", label: t("Chat.disarmMarkFail"), icon: "fa-solid fa-hand" },
        { action: "triggered", label: t("Chat.disarmMarkTriggered"), icon: "fa-solid fa-burst" },
      ],
      rejectClose: false,
    });
  } catch {
    return null;
  }
}

/**
 * Итог попытки обезвредить (правила мастера): успех — ловушка выключена и видна всем как
 * обезвреженная; провал — ничего, можно ещё; провал на N и больше (или крит. провал) — ловушка
 * срабатывает на того, кто копался. check — { total, natural?, faces? }, итог числом или
 * { outcome } — исход отметил ведущий. Делает активный ведущий. → исход.
 */
export async function finishDisarm(region, behavior, token, check) {
  const trap = normalizeTrap(behavior.system.toObject());
  const roll = typeof check === "number" ? { total: check } : (check ?? {});
  const outcome = roll.outcome ?? resolveDisarm(roll, trap.disarmDC, rulesSnapshot());
  const marked = Boolean(roll.outcome);
  const key = { success: "Chat.disarmOk", fail: "Chat.disarmFail", triggered: "Chat.disarmTriggered" }[outcome] + (marked ? "Gm" : "");
  const icon = { success: "fa-shield-halved", fail: "fa-hand", triggered: "fa-burst" }[outcome];
  const data = { name: esc(token.name), trap: esc(behavior.name), skill: esc(skillLabel(trap.disarmSkill)), total: roll.total ?? "—", dc: trap.disarmDC };
  await postMessage({
    alias: t("Title"),
    content: `<p ${THEME_ATTR} class="ssl-traps-note is-${outcome}"><i class="fa-solid ${icon}" inert></i> ${t(key, data)}</p>`,
  });
  const who = { id: token.actor?.id ?? token.id, name: token.name };
  await region.update({ [`flags.${MODULE_ID}.noticedBy`]: addNoticer(noticedBy(region), who) });
  if (outcome === "success") {
    await behavior.update({ disabled: true, "system.detected": true, "system.disarmed": true });
    await setVisible(region, true);
  } else if (outcome === "triggered") {
    await fireTrap(behavior, { trigger: token, targets: trap.affects === "area" ? null : [token], cause: "disarm" });
  } else if (!behavior.system.detected) {
    await behavior.update({ "system.detected": true });
  }
  return outcome;
}

/** Сработать вручную: по выделенным токенам или по всем в области. */
export function triggerNow(behavior, tokens) {
  return fireTrap(behavior, { targets: tokens?.length ? tokens : null });
}

/** Своя ловушка, из которой поставлена эта (если она ещё есть в «Моих ловушках»). */
export function sourceCustom(behavior) {
  const id = behavior.system.trapId;
  const entry = id?.startsWith("custom-") ? getEntry(id) : null;
  return entry?.custom ? entry : null;
}

/**
 * Расставленную ловушку — в «Мои ловушки».
 * name — как назвать; asNew — новой, даже если поставлена из своей (иначе своя обновляется).
 */
export async function saveToLibrary(region, behavior, { name, asNew = false } = {}) {
  const system = behavior.system.toObject();
  const { width, height } = rectCells(regionBounds(region), region.parent.grid.size);
  const id = !asNew ? sourceCustom(behavior)?.id : undefined;
  const trap = fromBehaviorData(system, { id, name: name || behavior.name || region.name, width, height });
  trap.activators = Math.min(MAX_ACTIVATORS, activatorsOf(region).length);
  const entry = await saveCustom(trap);
  ui.notifications.info(t("Notify.saved", { name: entry.name }));
  return entry;
}
