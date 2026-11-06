import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDegree,
  cleanPath,
  disarmOutcome,
  firstDieFaces,
  isRollFormula,
  normalizeProfile,
  presetProfile,
  saveRow,
  skillRow,
  withBonus,
} from "../scripts/core/rules.mjs";

test("профиль по умолчанию — обычный d20; мусор → допустимые значения", () => {
  const p = normalizeProfile({ compare: "nope", formula: "rm -rf", crits: 5, hp: "x", disarmFailBy: -3, saves: "не список" });
  assert.equal(p.preset, "d20");
  assert.equal(p.formula, "1d20 + @bonus");
  assert.equal(p.compare, "gte");
  assert.equal(p.crits, "none");
  assert.equal(p.hp, "bar");
  assert.equal(p.disarmFailBy, 0);
  assert.deepEqual(p.saves.map((s) => s.key), ["dex", "con", "wis"]);
  assert.equal(p.map.dodge, "dex");
});

test("свой список спасбросков: ключи чистятся, повторы выкидываются, категории перепривязываются", () => {
  const p = normalizeProfile({
    saves: [{ key: "Breath Attack", label: "Breath", target: "system.saves.breath.value" }, { key: "breath-attack" }, { key: "poison" }, { key: "" }],
    map: { dodge: "breath-attack", endure: "poison", mind: "nope" },
  });
  assert.deepEqual(p.saves.map((s) => s.key), ["breath-attack", "poison"]);
  assert.equal(p.saves[0].target, "system.saves.breath.value");
  assert.equal(p.map.dodge, "breath-attack");
  assert.equal(p.map.mind, "breath-attack", "нет такого — первый из списка");
  assert.equal(saveRow(p, "dodge").label, "Breath");
  assert.equal(saveRow(p, "poison").key, "poison");
  assert.equal(skillRow(p, "tools").key, "thievery", "категория «механизм» → навык мастера");
});

test("пути в лист и формулы: только безопасные", () => {
  assert.equal(cleanPath("system.abilities.dex.save"), "system.abilities.dex.save");
  assert.equal(cleanPath("system['x']"), "");
  assert.equal(cleanPath(" .system.hp. "), "system.hp");
  assert.ok(isRollFormula("1d20 + @bonus"));
  assert.ok(isRollFormula("1d100"));
  assert.ok(isRollFormula("2d6+@bonus-1"));
  assert.ok(!isRollFormula("1d20; alert(1)"));
  assert.equal(withBonus("1d20 + @bonus", -2), "1d20 - 2");
  assert.equal(withBonus("1d20 + @bonus", 4), "1d20 + 4");
  assert.equal(firstDieFaces("1d100"), 100);
  assert.equal(firstDieFaces("5"), 0);
});

test("исход: не меньше цели, не больше цели, естественные максимум и минимум, ±10", () => {
  const gte = { compare: "gte", crits: "none" };
  assert.equal(checkDegree({ total: 15 }, 15, gte), 2);
  assert.equal(checkDegree({ total: 14 }, 15, gte), 1);
  assert.equal(checkDegree({ total: 30, natural: 20, faces: 20 }, 15, gte), 2, "без критов — просто успех");
  const nat = { compare: "gte", crits: "natural" };
  assert.equal(checkDegree({ total: 14, natural: 20, faces: 20 }, 15, nat), 2, "естественная 20 — на ступень выше");
  assert.equal(checkDegree({ total: 16, natural: 1, faces: 20 }, 15, nat), 1);
  const lte = { compare: "lte", crits: "natural" };
  assert.equal(checkDegree({ total: 40, natural: 40, faces: 100 }, 45, lte), 2, "d100 ≤ навыка — успех");
  assert.equal(checkDegree({ total: 50, natural: 50, faces: 100 }, 45, lte), 1);
  assert.equal(checkDegree({ total: 100, natural: 100, faces: 100 }, 99, lte), 0, "при «не больше» максимум кубика — хуже");
  const tens = { compare: "gte", crits: "tens" };
  assert.deepEqual([28, 18, 17, 8].map((total) => checkDegree({ total }, 18, tens)), [3, 2, 1, 0]);
});

test("обезвреживание: провал на N и больше, крит. провал, «никогда»", () => {
  assert.equal(disarmOutcome({ total: 15 }, 15, { failBy: 5 }), "success");
  assert.equal(disarmOutcome({ total: 11 }, 15, { failBy: 5 }), "fail");
  assert.equal(disarmOutcome({ total: 10 }, 15, { failBy: 5 }), "triggered");
  assert.equal(disarmOutcome({ total: 1 }, 15, { failBy: 0 }), "fail", "0 — ловушка от провала не срабатывает");
  assert.equal(disarmOutcome({ total: 4 }, 15, { failBy: 0, crits: "tens" }), "triggered");
  assert.equal(disarmOutcome({ total: 60 }, 45, { failBy: 10, compare: "lte" }), "triggered", "d100: перебор на 10 и больше");
  assert.equal(disarmOutcome({ degree: 2 }, 15, { failBy: 5 }), "success", "ведущий отметил");
});

test("пресеты: «Только ведущий» не замечает сам и не спрашивает бонус", () => {
  const gm = presetProfile("gm");
  assert.equal(gm.preset, "gm");
  assert.equal(gm.detect, "off");
  assert.equal(gm.askBonus, false);
  assert.equal(presetProfile("nope").preset, "d20");
});

test("готовые правила систем: пути переживают нормализацию, категории указывают на свои строки", async () => {
  const { SYSTEM_PRESETS, systemPreset } = await import("../scripts/core/system-presets.mjs");
  const { SAVE_CATEGORIES, SKILL_CATEGORIES } = await import("../scripts/core/rules.mjs");
  assert.ok(Object.keys(SYSTEM_PRESETS).length >= 9);
  for (const [id, preset] of Object.entries(SYSTEM_PRESETS)) {
    const p = normalizeProfile(preset.rules);
    assert.equal(p.preset, "system", id);
    for (const r of preset.rules.saves) assert.deepEqual(p.saves.find((x) => x.key === r.key)?.target, r.target, `${id}.${r.key}: путь цели`);
    for (const r of preset.rules.skills) assert.deepEqual(p.skills.find((x) => x.key === r.key)?.bonus, r.bonus, `${id}.${r.key}: путь бонуса`);
    for (const c of SAVE_CATEGORIES) assert.equal(p.map[c], preset.rules.map[c], `${id}: категория ${c}`);
    for (const c of SKILL_CATEGORIES) assert.equal(p.map[c], preset.rules.map[c], `${id}: категория ${c}`);
    assert.ok(!p.saves.some((r) => [...SAVE_CATEGORIES, ...SKILL_CATEGORIES].includes(r.key)), `${id}: ключ строки совпал с категорией`);
  }
  assert.equal(systemPreset("dnd5e"), null);
  assert.equal(systemPreset("constructor"), null);
});

test("сумма и запасной путь: навык + характеристика, нет навыка — характеристика", async () => {
  const { readExpr } = await import("../scripts/core/rules.mjs");
  const sheet = { a: 2, b: 3, c: 7 };
  const get = (p) => (p in sheet ? sheet[p] : null);
  assert.equal(readExpr("a + b", get), 5);
  assert.equal(readExpr("x + b | c", get), 7, "нет x — запасной путь");
  assert.equal(readExpr("x | y", get), null);
  assert.equal(cleanPath("system.a.b + system.c | system.d"), "system.a.b + system.c | system.d");
  assert.equal(cleanPath("system.skills.i>>skill>>dodge.system.value"), "system.skills.i>>skill>>dodge.system.value");
});

test("своё сравнение у строки важнее общего (OSE: 1d6 ≤ навыка при общем «≥»)", () => {
  assert.equal(checkDegree({ total: 2, compare: "lte" }, 2, { compare: "gte" }), 2);
  assert.equal(checkDegree({ total: 3, compare: "lte" }, 2, { compare: "gte" }), 1);
  assert.equal(disarmOutcome({ total: 9, compare: "lte", target: 12 }, 15, { failBy: 5, compare: "gte" }), "success", "цель из листа важнее Сл ловушки");
});
