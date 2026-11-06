import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProfile } from "../scripts/core/rules.mjs";
import { applySuggestion, bestPath, scanSheet, suggestPaths, WORDS } from "../scripts/core/sheet-scan.mjs";

/** Лист в духе dnd5e: характеристики со значением, модификатором и спасброском. */
const DND = {
  abilities: {
    str: { value: 12, mod: 1, save: { value: 1 } },
    dex: { value: 16, mod: 3, save: { value: 5 } },
    con: { value: 14, mod: 2, save: { value: 2 } },
    wis: { value: 10, mod: 0, save: { value: 0 } },
  },
  attributes: { ac: { value: 15 }, hp: { value: 22, max: 30, temp: 0 } },
  skills: { prc: { total: 4, passive: 14 }, slt: { total: 5, passive: 15 }, ath: { total: 1 }, arc: { total: 0 } },
};

/** Лист в духе OSE: цели спасбросков числом. */
const OSE = {
  saves: { death: { value: 12 }, wand: { value: 13 }, paralysis: { value: 14 }, breath: { value: 15 }, spell: { value: 16 } },
  hp: { value: 7, max: 9 },
  ac: { value: 6 },
};

test("обход листа: числа и объекты с value, ссылки назад и описания пропускаем", () => {
  const data = { ...DND, parent: { boom: 1 }, description: { value: 3 }, list: [1, 2] };
  const paths = scanSheet(data).map((c) => c.path);
  assert.ok(paths.includes("system.abilities.dex.save"));
  assert.ok(paths.includes("system.abilities.dex.mod"));
  assert.ok(paths.includes("system.attributes.hp"));
  assert.ok(!paths.some((p) => p.includes("parent") || p.includes("description") || p.includes("list")));
  const loop = { a: { b: 1 } };
  loop.a.self = loop;
  assert.doesNotThrow(() => scanSheet(loop));
});

test("лист D&D: спасброски, навыки, КД, хиты и пассивная Внимательность находятся сами", () => {
  const s = suggestPaths(normalizeProfile({}), scanSheet(DND));
  assert.equal(s.saves.dex.bonus, "system.abilities.dex.save");
  assert.equal(s.saves.con.bonus, "system.abilities.con.save");
  assert.equal(s.saves.wis.bonus, "system.abilities.wis.save");
  assert.equal(s.skills.perception.bonus, "system.skills.prc", "объект с total — модуль возьмёт total сам");
  assert.equal(s.skills.thievery.bonus, "system.skills.slt");
  assert.equal(s.skills.athletics.bonus, "system.skills.ath");
  assert.equal(s.acPath, "system.attributes.ac");
  assert.equal(s.hpPath, "system.attributes.hp");
  assert.equal(s.passivePath, "system.skills.prc.passive");
});

test("лист OSR в режиме «цель из листа»: спасбросок по названию — его цель", () => {
  const profile = normalizeProfile({
    target: "sheet",
    compare: "gte",
    saves: [{ key: "breath" }, { key: "poison", label: "Death / Poison" }, { key: "spells" }],
    map: { dodge: "breath", endure: "poison", mind: "spells" },
  });
  const s = suggestPaths(profile, scanSheet(OSE));
  assert.equal(s.saves.breath.target, "system.saves.breath");
  assert.equal(s.saves.poison.target, "system.saves.death");
  assert.equal(s.saves.spells.target, "system.saves.spell");
  assert.equal(s.hpPath, "system.hp");
  assert.equal(s.acPath, "system.ac");
});

test("свои пути мастера не трогаем; применяется только к пустым", () => {
  const profile = normalizeProfile({ saves: [{ key: "dex", bonus: "system.my.path" }, { key: "con" }, { key: "wis" }] });
  const s = suggestPaths(profile, scanSheet(DND));
  assert.equal(s.saves.dex, undefined, "уже задан — не предлагаем");
  const next = applySuggestion(profile, s);
  assert.equal(next.saves[0].bonus, "system.my.path");
  assert.equal(next.saves[1].bonus, "system.abilities.con.save");
});

test("ничего похожего — ничего не предлагаем", () => {
  assert.equal(bestPath(scanSheet({ foo: { bar: 1 } }), WORDS.dodge, "save"), null);
  const s = suggestPaths(normalizeProfile({}), scanSheet({ foo: 1 }));
  assert.deepEqual(s.found, []);
});

test("пассивное значение не годится как бонус к броску навыка", () => {
  const s = suggestPaths(normalizeProfile({}), scanSheet({ skills: { prc: { passive: 15 } } }));
  assert.equal(s.skills.perception, undefined);
  assert.equal(s.passivePath, "system.skills.prc.passive");
});
