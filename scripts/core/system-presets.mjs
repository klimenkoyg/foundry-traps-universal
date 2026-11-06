/* Готовые правила под известные системы: модуль узнаёт систему мира (game.system.id) и сразу
   подставляет пути к числам, формулу и сравнение — мастеру остаётся проверить и сохранить.
   Пути сверены с исходниками систем на GitHub (ноябрь 2026; версии — у каждой системы).
   Пути можно складывать через «+» и давать запасной через «|» (core/rules.mjs, readExpr).
   Подписи строк — в lang/*.json: TRAPS.RuleKey.<ключ>. Ключи строк не совпадают с категориями
   каталога (dodge, endure, mind, notice, tools, force, magic). */

const row = (key, extra = {}) => ({ key, label: "", bonus: "", target: "", formula: "", compare: "", ...extra });
const D20 = { formula: "1d20 + @bonus", compare: "gte", target: "trap", crits: "none", critDouble: false, askBonus: true, hp: "bar", hpPath: "", types: [], conditions: {}, disarmFailBy: 5 };

/** @type {Record<string, { title: string, saveRolls: string, rules: object }>} */
export const SYSTEM_PRESETS = {
  // foundryvtt-shadowdark 4.0.6 (v13–v14): спасбросков нет — проверки d20 + модификатор ≥ Сл.
  shadowdark: {
    title: "Shadowdark",
    saveRolls: "players",
    rules: {
      ...D20,
      saves: [row("dex", { bonus: "system.abilities.dex.mod" }), row("con", { bonus: "system.abilities.con.mod" }), row("wis", { bonus: "system.abilities.wis.mod" })],
      skills: [
        row("perception", { bonus: "system.abilities.wis.mod" }),
        row("thievery", { bonus: "system.abilities.dex.mod" }),
        row("athletics", { bonus: "system.abilities.str.mod" }),
        row("arcana", { bonus: "system.abilities.int.mod" }),
      ],
      map: { dodge: "dex", endure: "con", mind: "wis", notice: "perception", tools: "thievery", force: "athletics", magic: "arcana" },
      acPath: "system.attributes.ac.value",
      detect: "roll",
      passivePath: "",
    },
  },

  // ose-foundry-core 3.2.0 (v13–v14): спасброски — d20 ≥ цели из листа; поиск ловушки — 1d6 ≤
  // навыка; проверки характеристик — d20 ≤ значения. КД бывает нисходящим — попадание отмечает ведущий.
  ose: {
    title: "Old-School Essentials",
    saveRolls: "players",
    rules: {
      ...D20,
      formula: "1d20",
      target: "sheet",
      askBonus: false,
      saves: ["death", "wand", "paralysis", "breath", "spell"].map((k) => row(k, { target: `system.saves.${k}.value` })),
      skills: [
        row("find-traps", { formula: "1d6", compare: "lte", target: "system.exploration.ft" }),
        row("dex-check", { formula: "1d20", compare: "lte", target: "system.scores.dex.value" }),
        row("str-check", { formula: "1d20", compare: "lte", target: "system.scores.str.value" }),
        row("int-check", { formula: "1d20", compare: "lte", target: "system.scores.int.value" }),
      ],
      map: { dodge: "breath", endure: "death", mind: "spell", notice: "find-traps", tools: "dex-check", force: "str-check", magic: "int-check" },
      acPath: "",
      hp: "path",
      hpPath: "system.hp",
      detect: "roll",
      passivePath: "",
      disarmFailBy: 0,
    },
  },

  // foundryvtt-dcc 0.70 (v14; 0.66 — v13): спасброски Рефлекс, Стойкость, Воля; навыки вора
  // хранятся без модификатора характеристики — складываем.
  dcc: {
    title: "Dungeon Crawl Classics",
    saveRolls: "players",
    rules: {
      ...D20,
      crits: "natural",
      saves: [row("ref", { bonus: "system.saves.ref.value" }), row("frt", { bonus: "system.saves.frt.value" }), row("wil", { bonus: "system.saves.wil.value" })],
      skills: [
        row("find-traps", { bonus: "system.skills.findTrap.value + system.abilities.int.mod | system.abilities.int.mod" }),
        row("disable-traps", { bonus: "system.skills.disableTrap.value + system.abilities.agl.mod | system.abilities.agl.mod" }),
        row("str-check", { bonus: "system.abilities.str.mod" }),
        row("int-check", { bonus: "system.abilities.int.mod" }),
      ],
      map: { dodge: "ref", endure: "frt", mind: "wil", notice: "find-traps", tools: "disable-traps", force: "str-check", magic: "int-check" },
      acPath: "system.attributes.ac.value",
      detect: "roll",
      passivePath: "",
    },
  },

  // dragonbane 4.1 (v14; 3.2 — v13): d20 ≤ характеристики, 1 — дракон, 20 — демон. Навыки —
  // предметы, по пути их не прочесть: бросаем по характеристике. Брони как КД нет.
  dragonbane: {
    title: "Dragonbane",
    saveRolls: "players",
    rules: {
      ...D20,
      formula: "1d20",
      compare: "lte",
      target: "sheet",
      crits: "natural",
      askBonus: false,
      saves: [row("agl", { target: "system.attributes.agl.value" }), row("con", { target: "system.attributes.con.value" }), row("wil", { target: "system.attributes.wil.value" })],
      skills: [row("int", { target: "system.attributes.int.value" }), row("agl", { target: "system.attributes.agl.value" }), row("str", { target: "system.attributes.str.value" })],
      map: { dodge: "agl", endure: "con", mind: "wil", notice: "int", tools: "agl", force: "str", magic: "int" },
      acPath: "",
      detect: "roll",
      passivePath: "",
      disarmFailBy: 0,
    },
  },

  // black-flag 3.0 (v14; 2.0 — v13): как 5e, характеристики полными словами; у NPC навыков нет —
  // запасной путь на проверку характеристики.
  "black-flag": {
    title: "Black Flag / Tales of the Valiant",
    saveRolls: "players",
    rules: {
      ...D20,
      saves: ["dexterity", "constitution", "wisdom"].map((k) => row(k, { bonus: `system.abilities.${k}.save.mod` })),
      skills: [
        row("perception", { bonus: "system.proficiencies.skills.perception.mod | system.abilities.wisdom.check.mod" }),
        row("thievery", { bonus: "system.proficiencies.tools.thieves.mod | system.proficiencies.skills.sleightOfHand.mod | system.abilities.dexterity.check.mod" }),
        row("athletics", { bonus: "system.proficiencies.skills.athletics.mod | system.abilities.strength.check.mod" }),
        row("arcana", { bonus: "system.proficiencies.skills.arcana.mod | system.abilities.intelligence.check.mod" }),
      ],
      map: { dodge: "dexterity", endure: "constitution", mind: "wisdom", notice: "perception", tools: "thievery", force: "athletics", magic: "arcana" },
      acPath: "system.attributes.ac.value",
      detect: "passive",
      passivePath: "system.proficiencies.skills.perception.passive | system.attributes.perception",
    },
  },

  // a5e 1.5 (v14; 1.1 — v13): бонус навыка хранится без характеристики — складываем.
  a5e: {
    title: "Level Up Advanced 5e",
    saveRolls: "players",
    rules: {
      ...D20,
      saves: ["dex", "con", "wis"].map((k) => row(k, { bonus: `system.abilities.${k}.save.deterministicBonus` })),
      skills: [
        row("perception", { bonus: "system.abilities.wis.check.deterministicBonus + system.skills.prc.deterministicBonus | system.abilities.wis.check.deterministicBonus" }),
        row("thievery", { bonus: "system.abilities.dex.check.deterministicBonus + system.skills.slt.deterministicBonus | system.abilities.dex.check.deterministicBonus" }),
        row("athletics", { bonus: "system.abilities.str.check.deterministicBonus + system.skills.ath.deterministicBonus | system.abilities.str.check.deterministicBonus" }),
        row("arcana", { bonus: "system.abilities.int.check.deterministicBonus + system.skills.arc.deterministicBonus | system.abilities.int.check.deterministicBonus" }),
      ],
      map: { dodge: "dex", endure: "con", mind: "wis", notice: "perception", tools: "thievery", force: "athletics", magic: "arcana" },
      acPath: "system.attributes.ac.value",
      detect: "passive",
      passivePath: "system.skills.prc.passive",
    },
  },

  // CoC7 8.16 (v12–v14): d100 ≤ навыка; навыки сыщиков — по id («i>>skill>>dodge»), у NPC их нет —
  // запасной путь на характеристику. Трудность ловушки здесь не учитывается.
  CoC7: {
    title: "Call of Cthulhu 7e",
    saveRolls: "players",
    rules: {
      ...D20,
      formula: "1d100",
      compare: "lte",
      target: "sheet",
      crits: "natural",
      askBonus: false,
      saves: [
        row("dodge-skill", { target: "system.skills.i>>skill>>dodge.system.value | system.characteristics.dex.value" }),
        row("con", { target: "system.characteristics.con.value" }),
        row("pow", { target: "system.characteristics.pow.value" }),
      ],
      skills: [
        row("spot-hidden", { target: "system.skills.i>>skill>>spot-hidden.system.value | system.characteristics.int.value" }),
        row("locksmith", { target: "system.skills.i>>skill>>locksmith.system.value | system.skills.i>>skill>>mechanical-repair.system.value | system.characteristics.dex.value" }),
        row("climb", { target: "system.skills.i>>skill>>climb.system.value | system.characteristics.str.value" }),
        row("occult", { target: "system.skills.i>>skill>>occult.system.value | system.characteristics.int.value" }),
      ],
      map: { dodge: "dodge-skill", endure: "con", mind: "pow", notice: "spot-hidden", tools: "locksmith", force: "climb", magic: "occult" },
      acPath: "",
      detect: "roll",
      passivePath: "",
      disarmFailBy: 0,
    },
  },

  // Daggerheart (Foundryborne 2.12 — v14, 1.9 — v13): 2d12 + черта ≥ сложности. Хиты там
  // отмечаются вверх по порогам урона — урон наносит ведущий.
  daggerheart: {
    title: "Daggerheart",
    saveRolls: "players",
    rules: {
      ...D20,
      formula: "2d12 + @bonus",
      saves: ["agility", "strength", "presence"].map((k) => row(k, { bonus: `system.traits.${k}.value` })),
      skills: ["instinct", "finesse", "strength", "knowledge"].map((k) => row(k, { bonus: `system.traits.${k}.value` })),
      map: { dodge: "agility", endure: "strength", mind: "presence", notice: "instinct", tools: "finesse", force: "strength", magic: "knowledge" },
      acPath: "system.evasion",
      hp: "none",
      detect: "roll",
      passivePath: "",
    },
  },

  // Starfinder 2e (sf2e 1.7 — v14, 0.0.11 — v13; движок pf2e): d20 + модификатор ≥ Сл, четыре
  // степени успеха (±10), крит — вдвое. Спасброски, навыки, Внимательность и КД — данные pf2e
  // («value» — итоговый модификатор, и у персонажей, и у NPC). Пассивной Внимательности нет —
  // тайная проверка, как в правилах.
  sf2e: {
    title: "Starfinder Second Edition",
    saveRolls: "players",
    rules: {
      ...D20,
      crits: "tens",
      critDouble: true,
      saves: ["fortitude", "reflex", "will"].map((k) => row(k, { bonus: `system.saves.${k}.value` })),
      skills: [
        row("perception", { bonus: "system.perception.value" }),
        row("thievery", { bonus: "system.skills.thievery.value" }),
        row("athletics", { bonus: "system.skills.athletics.value" }),
        row("arcana", { bonus: "system.skills.arcana.value" }),
        row("computers", { bonus: "system.skills.computers.value" }),
      ],
      map: { dodge: "reflex", endure: "fortitude", mind: "will", notice: "perception", tools: "thievery", force: "athletics", magic: "arcana" },
      acPath: "system.attributes.ac.value",
      detect: "roll",
      passivePath: "",
      disarmFailBy: 0,
    },
  },

  // SWADE 5.2 (v13) / 6.0 (v14): кубики черт вместо чисел и раны вместо хитов — исход и урон
  // отмечает ведущий; состояния системы («entangled», «incapacitated») модуль узнаёт сам.
  swade: {
    title: "Savage Worlds (SWADE)",
    saveRolls: "gm",
    rules: {
      ...D20,
      askBonus: false,
      saves: [row("dex"), row("con"), row("wis")],
      skills: [row("perception"), row("thievery"), row("athletics"), row("arcana")],
      map: { dodge: "dex", endure: "con", mind: "wis", notice: "perception", tools: "thievery", force: "athletics", magic: "arcana" },
      acPath: "",
      hp: "none",
      detect: "off",
      passivePath: "",
    },
  },
};

// Своих типов урона у пресетов нет — берутся по умолчанию.
for (const [id, preset] of Object.entries(SYSTEM_PRESETS)) {
  delete preset.rules.types;
  preset.rules.preset = "system";
  preset.rules.system = id;
}

/** Готовые правила для системы или null. */
export const systemPreset = (id) => (id && Object.hasOwn(SYSTEM_PRESETS, id) ? SYSTEM_PRESETS[id] : null);
