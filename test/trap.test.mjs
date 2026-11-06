import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG } from "../scripts/core/catalog.mjs";
import {
  filterTraps,
  fromBehaviorData,
  isFormula,
  normalizeTrap,
  resolveDisarm,
  resolveTarget,
  activation,
  MAX_ACTIVATORS,
  toBehaviorData,
  trapMode,
} from "../scripts/core/trap.mjs";
import { FX_PRESETS, SOUND_NAMES } from "../scripts/core/fx/presets.mjs";

test("каталог: уникальные id, корректные данные, известные анимации и звуки", () => {
  const ids = new Set();
  for (const raw of CATALOG) {
    assert.ok(!ids.has(raw.id), `повтор id ${raw.id}`);
    ids.add(raw.id);
    const t = normalizeTrap(raw);
    for (const key of Object.keys(raw)) assert.deepEqual(t[key], raw[key], `${raw.id}.${key} изменился при нормализации`);
    assert.ok(t.fx in FX_PRESETS, `${raw.id}: нет анимации ${t.fx}`);
    assert.ok(SOUND_NAMES.includes(t.sound), `${raw.id}: нет звука ${t.sound}`);
    if (raw.damage) assert.ok(isFormula(raw.damage));
  }
  assert.ok(CATALOG.length >= 15);
});

test("нормализация: мусор → значения по умолчанию, атака отменяет спасбросок", () => {
  const t = normalizeTrap({ severity: "nope", size: 99, detectDC: "abc", damage: "rm -rf", attackBonus: "5", saveAbility: "dodge" });
  assert.equal(t.severity, "dangerous");
  assert.equal(t.size, 12);
  assert.equal(t.detectDC, 15);
  assert.equal(t.damage, "");
  assert.equal(t.attackBonus, 5);
  assert.equal(t.saveAbility, "");
  assert.equal(trapMode(t), "attack");
  assert.equal(trapMode(normalizeTrap({ saveAbility: "Breath Attack" })), "save");
  assert.equal(normalizeTrap({ saveAbility: "Breath Attack" }).saveAbility, "breath-attack", "любой ключ мастера");
  assert.equal(trapMode(normalizeTrap({})), "auto");
});

test("формулы", () => {
  assert.ok(isFormula("2d6"));
  assert.ok(isFormula("1d4 + 2d10 - 1"));
  assert.ok(isFormula("d8"));
  assert.ok(!isFormula("2d6; alert(1)"));
  assert.ok(!isFormula(""));
});

test("исход по правилам мастера: половина при успехе, крит. провал вдвое по галочке", () => {
  const trap = normalizeTrap({ saveAbility: "dodge", saveDC: 15, onSave: "half" });
  const at = (save, rules = {}) => resolveTarget({ ...trap, rules }, { save });
  assert.deepEqual([at({ total: 15 }).multiplier, at({ total: 14 }).multiplier], [0.5, 1]);
  assert.equal(at({ total: 4 }, { crits: "tens", critDouble: true }).multiplier, 2);
  assert.equal(at({ total: 4 }, { crits: "tens" }).multiplier, 1, "без галочки — не вдвое");
  assert.equal(at({ total: 26 }, { crits: "tens" }).multiplier, 0, "крит. успех — без урона");
  assert.equal(at({ total: 40, target: 45 }, { compare: "lte" }).success, true, "цель из листа, бросить меньше");
  assert.equal(at({ degree: 1 }).success, false, "ведущий отметил провал");
});

test("обезвреживание: провал на 5 и больше — срабатывает (по умолчанию)", () => {
  assert.equal(resolveDisarm(15, 15), "success");
  assert.equal(resolveDisarm(11, 15), "fail");
  assert.equal(resolveDisarm(10, 15), "triggered");
  assert.equal(resolveDisarm(10, 15, { failBy: 0 }), "fail");
});

test("в поведение и обратно: числа как записаны", () => {
  const raw = CATALOG.find((x) => x.id === "fireJet");
  const system = toBehaviorData(raw, { flavor: "Пламя!" });
  assert.equal(system.damage, "2d10");
  assert.equal(system.flavor, "Пламя!");
  assert.equal(system.trapId, "fireJet");
  const back = fromBehaviorData(system, { id: "custom-1", name: "Моя струя", size: 1 });
  assert.equal(back.damage, "2d10");
  assert.equal(back.name, "Моя струя");
  assert.equal(back.id, "custom-1");
});

test("фильтр библиотеки", () => {
  const entries = CATALOG.map((raw) => ({ trap: normalizeTrap(raw), name: raw.id, text: "" }));
  assert.ok(filterTraps(entries, { kind: "magical" }).every((e) => e.trap.magical));
  assert.ok(filterTraps(entries, { severity: "deadly" }).every((e) => e.trap.severity === "deadly"));
  assert.deepEqual(filterTraps(entries, { damageType: "poison" }).map((e) => e.trap.id).sort(), ["poisonDarts", "poisonGas"]);
  assert.deepEqual(filterTraps(entries, { query: "PIT" }).map((e) => e.trap.id), ["pit", "spikedPit"]);
});

test("кто заметил ловушку: каждый персонаж учитывается один раз", async () => {
  const { DETECT_MODES, addNoticer, knowsTrap } = await import("../scripts/core/trap.mjs");
  assert.deepEqual(DETECT_MODES, ["gm", "reveal"], "по умолчанию — сообщить ведущему");
  let list = addNoticer([], { id: "mira", name: "Мира" });
  list = addNoticer(list, { id: "mira", name: "Мира" });
  list = addNoticer(list, { id: "brom", name: "Бром" });
  assert.deepEqual(list, [{ id: "mira", name: "Мира" }, { id: "brom", name: "Бром" }]);
  assert.deepEqual(addNoticer(null, { id: "x", name: 5 }), [{ id: "x", name: "5" }]);
  assert.deepEqual(addNoticer([{ name: "без id" }], {}), [], "мусор отбрасывается");
  assert.equal(knowsTrap({ noticedBy: list }, "mira"), true);
  assert.equal(knowsTrap({ noticedBy: list }, "goblin"), false);
  assert.equal(knowsTrap({ revealed: true }, "goblin"), true, "показанную видят все");
  assert.equal(knowsTrap({ noticedBy: "не список" }, "mira"), false);
});

test("ширина и высота ловушки: старый size — квадрат, туда и обратно через поведение", async () => {
  const { fromBehaviorData, normalizeTrap, toBehaviorData } = await import("../scripts/core/trap.mjs");
  const sq = normalizeTrap({ size: 3 });
  assert.deepEqual([sq.width, sq.height, sq.size], [3, 3, 3]);
  const corridor = normalizeTrap({ width: 1, height: 4 });
  assert.deepEqual([corridor.width, corridor.height, corridor.size], [1, 4, 4]);
  assert.deepEqual([normalizeTrap({ width: 0, height: 99 }).width, normalizeTrap({ width: 0, height: 99 }).height], [1, 12]);
  const sys = toBehaviorData(corridor);
  assert.deepEqual([sys.width, sys.height], [1, 4]);
  const back = fromBehaviorData(sys, { width: 4, height: 1 });
  assert.deepEqual([back.width, back.height], [4, 1], "размер берётся с области на сцене");
  const old = fromBehaviorData({ ...sys, width: undefined, height: undefined, size: 2 });
  assert.deepEqual([old.width, old.height], [2, 2], "старая ловушка без ширины — квадрат");
});

test("срабатывание: вручную, от триггера или от самой области; предустановки каталога", () => {
  assert.equal(activation({ manual: true }, 3), "manual");
  assert.equal(activation({ manual: false }, 2), "activator");
  assert.equal(activation({ manual: false }, 0), "area");
  const clean = normalizeTrap({ activators: 9, manual: "yes" });
  assert.equal(clean.activators, MAX_ACTIVATORS);
  assert.equal(clean.manual, true);
  assert.equal(normalizeTrap({}).manual, false);
  assert.equal(normalizeTrap({}).activators, 0);
  assert.equal(normalizeTrap({ activators: -1 }).activators, 0);
  // Ловушки 0.2.4: «плита» или «растяжка» — это один триггер.
  assert.equal(normalizeTrap({ activator: "wire" }).activators, 1);
  assert.equal(normalizeTrap({ activator: "" }).activators, 0);
  const byId = Object.fromEntries(CATALOG.map((e) => [e.id, normalizeTrap(e)]));
  for (const id of ["arrowVolley", "fallingNet", "collapsingRoof", "rollingBoulder", "poisonGas", "sleepGas"]) assert.equal(byId[id].activators, 1, id);
  assert.equal(byId.pit.activators, 0);
  assert.equal(byId.fireJet.activators, 0);
  // В поведение области и обратно.
  const system = toBehaviorData({ ...byId.arrowVolley, activators: 2, manual: true });
  assert.equal(system.activators, 2);
  assert.equal(system.manual, true);
  assert.equal(fromBehaviorData(system, { id: "x" }).activators, 2);
});

test("чем заметить: категория каталога или навык мастера, в поведение и обратно", () => {
  assert.equal(normalizeTrap({}).detectSkill, "notice");
  assert.equal(normalizeTrap({ detectSkill: "Search" }).detectSkill, "search");
  const system = toBehaviorData({ ...CATALOG[0], detectSkill: "investigation" });
  assert.equal(system.detectSkill, "investigation");
  assert.equal(fromBehaviorData(system, { id: "x" }).detectSkill, "investigation");
});
