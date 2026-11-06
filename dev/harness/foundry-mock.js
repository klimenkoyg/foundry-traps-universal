/* Имитация API Foundry VTT (v14) и dnd5e для стенда «Западни»: ровно то, чем пользуется модуль.
   Это НЕ Foundry — только чтобы прогнать настоящий код модуля в браузере без установки. */
(() => {
  "use strict";
  const MODULE = "ssl_traps_universal";
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  const rid = () => Math.random().toString(36).slice(2, 12);
  const params = new URLSearchParams(location.search);
  const changed = () => window.__harness?.onWorldChange?.();
  // Версия и адрес модуля — как у Foundry, из module.json (для «Вышла новая версия»).
  const manifest = (() => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/module.json", false);
      xhr.send();
      return JSON.parse(xhr.responseText);
    } catch {
      return {};
    }
  })();

  /* ---------- Hooks ---------- */
  const Hooks = {
    _h: {},
    on(name, fn) { (this._h[name] ??= []).push(fn); return fn; },
    once(name, fn) { const w = (...a) => { this.off(name, w); return fn(...a); }; return this.on(name, w); },
    off(name, fn) { this._h[name] = (this._h[name] ?? []).filter((f) => f !== fn); },
    callAll(name, ...args) { for (const fn of [...(this._h[name] ?? [])]) fn(...args); return true; },
    call(name, ...args) { for (const fn of [...(this._h[name] ?? [])]) if (fn(...args) === false) return false; return true; },
  };

  const collection = (list) => ({
    get: (id) => list.find((x) => x.id === id) ?? null,
    has: (id) => list.some((x) => x.id === id),
    filter: (fn) => list.filter(fn),
    find: (fn) => list.find(fn),
    map: (fn) => list.map(fn),
    get size() { return list.length; },
    get contents() { return list; },
    [Symbol.iterator]: () => list[Symbol.iterator](),
  });

  /** Обновление вида { "system.detected": true, disabled: false } по месту. */
  function applyUpdate(target, data) {
    for (const [key, value] of Object.entries(data)) {
      const path = key.split(".");
      let obj = target;
      while (path.length > 1) obj = obj[path.shift()] ??= {};
      obj[path[0]] = clone(value);
    }
  }

  /* ---------- кубики ---------- */
  class Roll {
    constructor(formula, data = {}) {
      this.formula = String(formula).replace(/@(\w+)/g, (m, k) => String(data[k] ?? 0));
      this.dice = [];
      this.total = 0;
    }
    async evaluate() {
      let total = 0;
      const terms = this.formula.replace(/\s+/g, "").match(/[+-]?[^+-]+/g) ?? [];
      for (const raw of terms) {
        const sign = raw.startsWith("-") ? -1 : 1;
        const term = raw.replace(/^[+-]/, "");
        const m = term.match(/^(\d*)d(\d+)$/i);
        if (m) {
          const count = Number(m[1] || 1);
          const faces = Number(m[2]);
          const results = Array.from({ length: count }, () => ({ result: 1 + Math.floor(Math.random() * faces), active: true }));
          const sum = results.reduce((s, r) => s + r.result, 0);
          this.dice.push({ faces, results, total: sum });
          total += sign * sum;
        } else total += sign * Number(term || 0);
      }
      this.total = total;
      return this;
    }
    async toMessage(data = {}) {
      return ChatMessage.create({ ...data, content: `<p>🎲 ${data.flavor ?? ""} <b>${this.total}</b> <small>${this.formula}</small></p>` });
    }
  }

  /* ---------- dnd5e: актёры ---------- */
  const portrait = (color, letter) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${color}"/><text x="32" y="42" font-family="sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;

  function makeActor(id, name, { color, owners = [], hp = 24, ac = 14, prc = 12, dex = 2, con = 1, slt = 4, thief = 5, ath = 3, arc = 0 }) {
    const statuses = new Set();
    const roll = async (bonus, label) => {
      const r = await new Roll("1d20 + @b", { b: bonus }).evaluate();
      return r;
    };
    const skillBonus = { prc: prc - 10, slt, ath, arc, inv: 1, acr: dex, sur: 0 };
    const actor = {
      id,
      uuid: `Actor.${id}`,
      name,
      img: portrait(color, name[0]),
      statuses,
      get hasPlayerOwner() { return owners.length > 0; },
      system: {
        // Пассивный Анализ — на 2 ниже Внимательности: так видно, каким навыком заметили.
        skills: { prc: { passive: prc }, inv: { passive: prc - 2 } },
        attributes: { ac: { value: ac }, hp: { value: hp, max: hp, temp: 0 } },
        abilities: { str: { mod: 1 }, dex: { mod: dex, save: { value: dex } }, con: { mod: con, save: { value: con } }, int: { mod: 0 }, wis: { mod: 1 }, cha: { mod: 0 } },
      },
      // «Глазами игрока» стенд смотрит за конкретного игрока (gm.playerAs) — он и владелец.
      testUserPermission: (user) => user.isGM || owners.includes(user.playerAs ?? user.id),
      async rollSavingThrow({ ability }, dialog, message) {
        const r = await roll(actor.system.abilities[ability]?.save?.value ?? actor.system.abilities[ability]?.mod ?? 0);
        if (message?.create) await r.toMessage({ flavor: EN ? `${name}: ${CONFIG.DND5E.abilities[ability]?.label ?? ability} save` : `${name}: спасбросок ${ability}` });
        return [r];
      },
      async rollSkill({ skill }, dialog, message) {
        const r = await roll(skillBonus[skill] ?? 0);
        if (message?.create) await r.toMessage({ flavor: `${name}: ${CONFIG.DND5E.skills[skill]?.label ?? skill}` });
        return [r];
      },
      async rollToolCheck({ tool }, dialog, message) {
        const r = await roll(thief);
        if (message?.create) await r.toMessage({ flavor: EN ? `${name}: thieves’ tools` : `${name}: воровские инструменты` });
        return [r];
      },
      async applyDamage(list, { multiplier = 1 } = {}) {
        const total = Math.floor(list.reduce((s, p) => s + p.value, 0) * multiplier);
        const hpData = actor.system.attributes.hp;
        hpData.value = Math.max(0, hpData.value - total);
        changed();
        return actor;
      },
      // Как в Foundry: правка полоски токена (attribute — путь внутри system), isDelta — прибавить.
      async modifyTokenAttribute(attribute, value, isDelta = false) {
        const data = attribute.split(".").reduce((o, k) => o?.[k], actor.system);
        if (!data || typeof data !== "object") return actor;
        data.value = Math.max(0, isDelta ? data.value + value : value);
        changed();
        return actor;
      },
      async update(changes) {
        for (const [path, v] of Object.entries(changes)) {
          const keys = path.split(".");
          const last = keys.pop();
          const obj = keys.reduce((o, k) => (o[k] ??= {}), actor);
          obj[last] = v;
        }
        changed();
        return actor;
      },
      async toggleStatusEffect(sid, { active } = {}) {
        if (active === false) statuses.delete(sid);
        else statuses.add(sid);
        changed();
      },
    };
    return actor;
  }

  /* ---------- пользователи ---------- */
  const users = [];
  function makeUser(id, name, { isGM = false } = {}) {
    // isGM можно выключить («глазами игрока» на стенде), а ведущим этот клиент остаётся: ловушки работают.
    const user = { id, name, isGM, active: true, viewedScene: "dungeon", get isSelf() { return game.user === user; }, get isActiveGM() { return isGM && game.user === user; } };
    users.push(user);
    return user;
  }
  const gm = makeUser("u-gm", "Ведущий", { isGM: true });
  makeUser("u-yura", "Юра");
  makeUser("u-katya", "Катя");

  const A = {
    mira: makeActor("mira", "Мира", { color: "#4f7cc4", owners: ["u-yura"], prc: 15, dex: 4, hp: 22, ac: 15 }),
    brom: makeActor("brom", "Бром", { color: "#a0603a", owners: ["u-katya"], prc: 11, dex: 0, con: 3, hp: 34, ac: 17, ath: 6 }),
    goblin: makeActor("goblin", "Гоблин", { color: "#4f8a3a", prc: 9, hp: 7, ac: 13 }),
  };

  /* ---------- сцена: токены и области ---------- */
  const GRID = 100;
  const scene = {
    id: "dungeon",
    uuid: "Scene.dungeon",
    name: "Подземелье под часовней",
    // Линейка как в Foundry с правилом 5e «каждая диагональ — 5 фт»: расстояние в единицах сцены.
    grid: { size: GRID, distance: 5, measurePath: ([a, b]) => ({ distance: (Math.round(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / GRID)) * 5 }) },
    _regions: [],
    _tokens: [],
    // Стена между комнатами с дверью посередине (c — отрезок в px; door — дверь, ds — 1 открыта).
    walls: [
      { id: "w1", c: [8 * GRID, 0, 8 * GRID, 4 * GRID] },
      { id: "door", c: [8 * GRID, 4 * GRID, 8 * GRID, 5 * GRID], door: 1, ds: 0 },
      { id: "w2", c: [8 * GRID, 5 * GRID, 8 * GRID, 9 * GRID] },
    ],
    get regions() { return collection(this._regions); },
    get tokens() { return collection(this._tokens); },
    async createEmbeddedDocuments(type, list) {
      if (type !== "Region") throw new Error(`стенд: ${type} не поддерживается`);
      const made = list.map((data) => makeRegion(data)).filter((r, i) => Hooks.call("preCreateRegion", r, list[i], {}, game.user.id) !== false);
      scene._regions.push(...made);
      for (const r of made) Hooks.callAll("createRegion", r);
      changed();
      return made;
    },
    async updateEmbeddedDocuments(type, updates) {
      if (type !== "Region") throw new Error(`стенд: ${type} не поддерживается`);
      const done = [];
      for (const { _id, ...change } of updates) {
        const r = scene._regions.find((x) => x.id === _id);
        if (r) done.push(await r.update(change));
      }
      return done;
    },
    async deleteEmbeddedDocuments(type, ids) {
      if (type !== "Region") throw new Error(`стенд: ${type} не поддерживается`);
      const gone = scene._regions.filter((r) => ids.includes(r.id));
      for (const r of gone) await r.delete();
      return gone;
    },
  };

  function makeToken(id, actor, col, row) {
    const token = {
      id,
      uuid: `Scene.dungeon.Token.${id}`,
      name: actor.name,
      actor,
      x: col * GRID,
      y: row * GRID,
      width: 1,
      height: 1,
      parent: scene,
      texture: { src: actor.img },
      get regions() { return new Set(scene._regions.filter((r) => r.tokens.has(token))); },
      stopMovement() { token._stopped = true; },
      getBarAttribute: (bar) => (bar === "bar1" ? { type: "bar", attribute: "attributes.hp", value: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max } : null),
      pauseMovement() { token._paused = true; },
      async resumeMovement() { token._paused = false; },
    };
    return token;
  }
  scene._tokens.push(makeToken("t-mira", A.mira, 2, 3), makeToken("t-brom", A.brom, 2, 5), makeToken("t-goblin", A.goblin, 10, 2));

  function boundsOf(shapes) {
    const s = shapes[0];
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  }

  function makeRegion(data) {
    const region = {
      id: rid(),
      name: data.name,
      color: data.color,
      shapes: clone(data.shapes),
      visibility: data.visibility ?? 1,
      flags: clone(data.flags ?? {}),
      parent: scene,
      get uuid() { return `Scene.dungeon.Region.${region.id}`; },
      get bounds() { return boundsOf(region.shapes); },
      get tokens() {
        const b = region.bounds;
        return new Set(scene._tokens.filter((tk) => {
          const cx = tk.x + GRID / 2;
          const cy = tk.y + GRID / 2;
          return cx > b.x && cx < b.x + b.width && cy > b.y && cy < b.y + b.height;
        }));
      },
      getFlag: (ns, key) => region.flags?.[ns]?.[key],
      _behaviors: [],
      get behaviors() { return collection(region._behaviors); },
      // Как в Foundry: перед изменением модули могут его поправить или отменить.
      updateSource(change) { applyUpdate(region, change); },
      async update(change) {
        if (Hooks.call("preUpdateRegion", region, change, {}, game.user.id) === false) return region;
        applyUpdate(region, change);
        Hooks.callAll("updateRegion", region, change);
        changed();
        return region;
      },
      async delete() {
        scene._regions = scene._regions.filter((r) => r !== region);
        Hooks.callAll("deleteRegion", region);
        changed();
      },
    };
    region._behaviors = (data.behaviors ?? []).map((b) => makeBehavior(region, b));
    return region;
  }

  function makeBehavior(region, data) {
    const Model = CONFIG.RegionBehavior.dataModels[data.type];
    const initial = Object.fromEntries(Object.entries(Model?.defineSchema?.() ?? {}).map(([k, f]) => [k, clone(f.initial)]));
    const behavior = {
      id: rid(),
      type: data.type,
      name: data.name,
      disabled: Boolean(data.disabled),
      region,
      parent: region,
      get uuid() { return `${region.uuid}.RegionBehavior.${behavior.id}`; },
      sheet: { render: () => window.__harness?.toast?.("info", "Здесь в Foundry откроется окно настройки поведения области.") },
      async update(change) {
        applyUpdate(behavior, change);
        Hooks.callAll("updateRegionBehavior", behavior, change);
        changed();
        return behavior;
      },
    };
    const values = { ...initial, ...clone(data.system ?? {}) };
    const system = Object.create(Model?.prototype ?? Object.prototype);
    Object.assign(system, values);
    Object.defineProperty(system, "parent", { value: behavior, enumerable: false });
    Object.defineProperty(system, "toObject", { value: () => clone(Object.fromEntries(Object.keys(values).map((k) => [k, system[k]]))), enumerable: false });
    behavior.system = system;
    return behavior;
  }

  /* ---------- настройки ---------- */
  const STORE_KEY = "ssl-traps-harness-settings";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"); } catch { return {}; } })();
  const settings = {
    _reg: new Map(),
    register(ns, key, data) { this._reg.set(`${ns}.${key}`, data); },
    registerMenu(ns, key, data) { (this._menus ??= new Map()).set(`${ns}.${key}`, data); },
    get(ns, key) {
      const k = `${ns}.${key}`;
      return k in saved ? clone(saved[k]) : clone(this._reg.get(k)?.default);
    },
    async set(ns, key, value) {
      const k = `${ns}.${key}`;
      saved[k] = clone(value);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* приватный режим */ }
      this._reg.get(k)?.onChange?.(clone(value));
      return value;
    },
  };

  /* ---------- PIXI и холст: столько, сколько нужно анимациям ---------- */
  const sprites = new Set();
  const tickers = new Set();
  window.PIXI = {
    Texture: { from: (el) => ({ el, baseTexture: { update() {} } }) },
    Sprite: class {
      constructor(texture) {
        this.texture = texture;
        this.destroyed = false;
        const pos = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
        const scale = { x: 1, y: 1, set(x, y = x) { this.x = x; this.y = y; } };
        this.position = pos;
        this.scale = scale;
        this.zIndex = 0;
        this.alpha = 1;
      }
      destroy() { this.destroyed = true; this._set?.delete(this); }
    },
  };
  /** Первичная группа: «уровень карты» — её закрывают туман и темнота, токены сортируются внутри. */
  const primary = new Set();
  class PrimaryCanvasGroup {
    static SORT_LAYERS = { SCENE: 0, TILES: 500, DRAWINGS: 600, TOKENS: 700, WEATHER: 1000 };
    addChild(s) { s._set = primary; primary.add(s); return s; }
  }
  class PrimarySpriteMesh extends PIXI.Sprite {
    constructor(texture) { super(texture); this.elevation = 0; this.sortLayer = 0; this.sort = 0; }
  }

  /** Пересекает ли отрезок ab стену cd (касание концом не считается). */
  function crosses(a, b, [x1, y1, x2, y2]) {
    const d = (b.x - a.x) * (y2 - y1) - (b.y - a.y) * (x2 - x1);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((x1 - a.x) * (y2 - y1) - (y1 - a.y) * (x2 - x1)) / d;
    const u = ((x1 - a.x) * (b.y - a.y) - (y1 - a.y) * (b.x - a.x)) / d;
    return t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1;
  }
  /** Как ClockwiseSweepPolygon.testCollision: стены и закрытые двери перекрывают взгляд и проход. */
  const testCollision = (origin, destination) => scene.walls.some((w) => !(w.door && w.ds === 1) && crosses(origin, destination, w.c));
  const tick = () => { for (const fn of [...tickers]) fn(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  const controlled = new Set(["t-mira"]);
  window.canvas = {
    ready: true,
    scene,
    grid: { size: GRID },
    stage: { scale: { x: 1 }, pivot: { x: 7.5 * GRID, y: 4.5 * GRID } },
    interface: { addChild: (s) => { s._set = sprites; sprites.add(s); return s; } },
    primary: new PrimaryCanvasGroup(),
    // Зрение токенов считает стенд (harness.js): глазами игрока видно только то, что видят его токены.
    visibility: { tokenVision: true, testVisibility: (point) => window.__harness?.isVisiblePoint?.(point) ?? true },
    app: { ticker: { add: (fn) => tickers.add(fn), remove: (fn) => tickers.delete(fn) } },
    // Слои: как в v13–v14, их включает обработчик группы панели (layer.activate()), а не поле layer.
    // И как там же: включённый слой переключает панель на «свою» группу (InteractionLayer#activate).
    tokens: { active: true, activate() { canvas.regions.active = false; canvas.tokens.active = true; window.__harness?.toLayerGroup?.("tokens"); }, get controlled() { return scene._tokens.filter((tk) => controlled.has(tk.id)).map((document) => ({ document })); } },
    regions: { active: false, activate() { canvas.tokens.active = false; canvas.regions.active = true; window.__harness?.toLayerGroup?.("regions"); }, setAllRenderFlags() {}, releaseAll() {} },
    animatePan: () => window.__harness?.toast?.("info", "Камера перелетает к ловушке."),
  };

  /* ---------- game, CONFIG, ui ---------- */
  window.Hooks = Hooks;
  window.Roll = Roll;
  window.CONST = { REGION_EVENTS: { TOKEN_MOVE_IN: "tokenMoveIn" }, REGION_VISIBILITY: { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 } };
  const EN = (params.get("lang") ?? "ru") === "en";
  const lab = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? { label: v } : v]));
  window.CONFIG = {
    Canvas: { polygonBackends: { sight: { testCollision }, move: { testCollision } } },
    RegionBehavior: { dataModels: {}, typeIcons: {}, typeLabels: {} },
    // Названия dnd5e на языке стенда (?lang=en) — в Foundry их даёт сама система.
    statusEffects: (EN ? [
      ["blinded", "Blinded"], ["deafened", "Deafened"], ["frightened", "Frightened"], ["grappled", "Grappled"],
      ["incapacitated", "Incapacitated"], ["paralyzed", "Paralyzed"], ["poisoned", "Poisoned"], ["prone", "Prone"],
      ["restrained", "Restrained"], ["stunned", "Stunned"], ["unconscious", "Unconscious"],
    ] : [
      ["blinded", "Ослеплённый"], ["deafened", "Оглохший"], ["frightened", "Испуганный"], ["grappled", "Схваченный"],
      ["incapacitated", "Недееспособный"], ["paralyzed", "Парализованный"], ["poisoned", "Отравленный"], ["prone", "Лежащий"],
      ["restrained", "Опутанный"], ["stunned", "Ошеломлённый"], ["unconscious", "Бессознательный"],
    ]).map(([id, name]) => ({ id, name })),
    DND5E: EN ? {
      abilities: {
        str: { label: "Strength", abbreviation: "STR" }, dex: { label: "Dexterity", abbreviation: "DEX" }, con: { label: "Constitution", abbreviation: "CON" },
        int: { label: "Intelligence", abbreviation: "INT" }, wis: { label: "Wisdom", abbreviation: "WIS" }, cha: { label: "Charisma", abbreviation: "CHA" },
      },
      damageTypes: lab({
        acid: "Acid", bludgeoning: "Bludgeoning", cold: "Cold", fire: "Fire", force: "Force", lightning: "Lightning",
        necrotic: "Necrotic", piercing: "Piercing", poison: "Poison", psychic: "Psychic", radiant: "Radiant",
        slashing: "Slashing", thunder: "Thunder",
      }),
      skills: lab({ acr: "Acrobatics", arc: "Arcana", ath: "Athletics", inv: "Investigation", prc: "Perception", slt: "Sleight of Hand", sur: "Survival" }),
    } : {
      abilities: {
        str: { label: "Сила", abbreviation: "СИЛ" }, dex: { label: "Ловкость", abbreviation: "ЛВК" }, con: { label: "Телосложение", abbreviation: "ТЕЛ" },
        int: { label: "Интеллект", abbreviation: "ИНТ" }, wis: { label: "Мудрость", abbreviation: "МДР" }, cha: { label: "Харизма", abbreviation: "ХАР" },
      },
      damageTypes: lab({
        acid: "Кислота", bludgeoning: "Дробящий", cold: "Холод", fire: "Огонь", force: "Силовое поле", lightning: "Электричество",
        necrotic: "Некротическая энергия", piercing: "Колющий", poison: "Яд", psychic: "Психическая энергия", radiant: "Излучение",
        slashing: "Рубящий", thunder: "Звук",
      }),
      skills: lab({ acr: "Акробатика", arc: "Магия", ath: "Атлетика", inv: "Анализ", prc: "Внимательность", slt: "Ловкость рук", sur: "Выживание" }),
    },
  };
  window.game = {
    user: gm,
    users: Object.assign(collection(users), { get activeGM() { return gm; } }),
    settings,
    // Стенд изображает систему, о которой модуль ничего не знает: числа — по путям из «Правил».
    system: { id: "worldbuilding", primaryTokenAttribute: "attributes.hp" },
    release: { generation: 14 },
    keybindings: { register() {} },
    // В Foundry отправитель своё сообщение не получает. На стенде ведущий и игрок — один браузер:
    // глазами игрока отправленное доходит до «ведущего» (до этого же окна), глазами ведущего — нет.
    socket: {
      _on: new Map(),
      on(name, fn) { (this._on.get(name) ?? this._on.set(name, []).get(name)).push(fn); },
      emit(name, data) {
        if (gm.isGM) return;
        for (const fn of this._on.get(name) ?? []) setTimeout(() => fn(clone(data)), 30);
      },
    },
    messages: { get: (id) => messages.get(id) ?? null },
    // Одна сцена — как game.scenes в Foundry.
    scenes: { get: (id) => (id === scene.id ? scene : null), get active() { return scene; } },
    modules: { get: (id) => (id === MODULE ? (game._module ??= { id, active: true, version: manifest.version, url: manifest.url }) : null) },
    i18n: {
      lang: params.get("lang") ?? "ru",
      translations: {},
      _find(key) { return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), this.translations); },
      localize(key) { const v = this._find(key); return typeof v === "string" ? v : key; },
      has(key) { return typeof this._find(key) === "string"; },
    },
  };
  window.ui = {
    notifications: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (msg) => window.__harness?.toast?.(level, msg)])),
  };
  /** Сообщения чата: как в Foundry — с флагами и update(), после которого сообщение перерисовывается. */
  const messages = new Map();
  window.ChatMessage = {
    create: async (data) => {
      const message = {
        id: rid(),
        ...clone({ ...data, rolls: undefined }),
        flags: clone(data.flags ?? {}),
        getFlag(ns, key) { return message.flags?.[ns]?.[key]; },
        async update(change) {
          applyUpdate(message, change);
          window.__harness?.rerender?.(message);
          return message;
        },
      };
      messages.set(message.id, message);
      window.__harness?.chat?.(message);
      return message;
    },
    getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }),
  };

  /* ---------- Handlebars ---------- */
  Handlebars.registerHelper("localize", (key) => game.i18n.localize(key));
  const templateCache = new Map();
  const templateUrl = (path) => `/${path.replace(`modules/${MODULE}/`, "")}`;
  /** Как в Foundry: загруженные шаблоны — ещё и партиалы с именем-путём. */
  async function loadPartials(paths) {
    await Promise.all(paths.map(async (path) => {
      if (Handlebars.partials[path]) return;
      Handlebars.registerPartial(path, await getTemplate(path));
    }));
  }
  async function getTemplate(path) {
    if (!templateCache.has(path)) {
      const res = await fetch(templateUrl(path), { cache: "no-store" });
      if (!res.ok) throw new Error(`шаблон не найден: ${path}`);
      templateCache.set(path, Handlebars.compile(await res.text()));
    }
    return templateCache.get(path);
  }

  /* ---------- ApplicationV2 ---------- */
  function merge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b ?? {})) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof a?.[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], v) : v;
    }
    return out;
  }
  const instances = new Map();
  let z = 100;

  class ApplicationV2 {
    static DEFAULT_OPTIONS = {};
    constructor(options = {}) {
      const chain = [];
      for (let c = this.constructor; c && c !== Object; c = Object.getPrototypeOf(c)) {
        if (Object.hasOwn(c, "DEFAULT_OPTIONS")) chain.unshift(c.DEFAULT_OPTIONS);
      }
      this.options = [...chain, options].reduce(merge, {});
      this.position = { ...(this.options.position ?? {}) };
      this.element = null;
      this.rendered = false;
    }
    get id() { return this.options.id ?? (this._autoId ??= `app-${rid()}`); }
    get title() { return this.options.window?.title ?? ""; }
    async render(options = {}) {
      if (typeof options === "boolean") options = { force: options };
      this._queue = (this._queue ?? Promise.resolve()).then(() => this.#render(options)).catch((err) => {
        console.error(err);
        window.__harness?.toast?.("error", `Ошибка отрисовки: ${err.message}`);
      });
      return this._queue;
    }
    async #render(options) {
      const first = !this.element;
      if (first && !options.force) return this;
      if (first) {
        this.element = await this._renderFrame(options);
        document.querySelector("#windows").append(this.element);
        instances.set(this.id, this);
      }
      const context = await this._prepareContext(options);
      if (!this.element) return this;
      await this._renderHTML(context, options);
      this.element.querySelector(".window-title").textContent = this.title;
      this.rendered = true;
      if (first) await this._onFirstRender?.(context, options);
      await this._onRender(context, options);
      return this;
    }
    async _renderFrame() {
      const el = document.createElement("div");
      el.id = this.id;
      el.className = ["application", ...(this.options.classes ?? [])].join(" ");
      const { width, height } = this.position;
      // Стенд: первое окно — справа, следующие — слева, чтобы не закрывать друг друга.
      const side = instances.size ? "left:12px;right:auto" : "";
      el.style.cssText = `width:${width}px;height:${height}px;z-index:${++z};${side}`;
      el.innerHTML = `
        <header class="window-header">
          <i class="window-icon ${this.options.window?.icon ?? ""}"></i>
          <h1 class="window-title"></h1>
          <button type="button" class="header-control fa-solid fa-xmark" data-action="close" aria-label="Закрыть"></button>
        </header>
        <section class="window-content"></section>`;
      el.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target || !el.contains(target)) return;
        const action = target.dataset.action;
        // Как в ApplicationV2: «close», «tab» и «toggleControls» — встроенные действия, до своих
        // обработчиков модуля они не доходят. «tab» без data-group Foundry переключить не может.
        if (action === "close") return this.close();
        if (action === "tab") {
          const msg = `ApplicationV2: встроенное действие «tab» требует data-group — обработчик модуля «tab» не вызывается`;
          console.error(msg);
          window.__harness?.toast?.("error", msg);
          return;
        }
        if (action === "toggleControls") return;
        const handler = this.options.actions?.[action];
        if (!handler) return console.warn(`нет действия «${action}»`);
        Promise.resolve(handler.call(this, event, target)).catch((err) => {
          console.error(err);
          window.__harness?.toast?.("error", `Ошибка действия «${action}»: ${err.message}`);
        });
      });
      return el;
    }
    async _prepareContext() { return {}; }
    async _renderHTML() {}
    _onRender() {}
    bringToFront() { if (this.element) this.element.style.zIndex = ++z; }
    async close() {
      this.element?.remove();
      this.element = null;
      this.rendered = false;
      instances.delete(this.id);
      return this;
    }
  }

  const HandlebarsApplicationMixin = (Base) =>
    class extends Base {
      async _renderHTML(context, options = {}) {
        const content = this.element.querySelector(".window-content");
        for (const [id, part] of Object.entries(this.constructor.PARTS)) {
          if (options.parts && !options.parts.includes(id) && content.querySelector(`:scope > [data-application-part="${id}"]`)) continue;
          await loadPartials(part.templates ?? []);
          const template = await getTemplate(part.template);
          const holder = document.createElement("template");
          holder.innerHTML = template(context, { allowProtoPropertiesByDefault: true }).trim();
          if (holder.content.children.length !== 1) throw new Error(`Часть «${id}» должна давать ровно один корневой элемент`);
          const el = holder.content.firstElementChild;
          el.dataset.applicationPart = id;
          const prev = content.querySelector(`:scope > [data-application-part="${id}"]`);
          const scroll = prev?.querySelector(".st-scroll")?.scrollTop;
          if (prev) prev.replaceWith(el);
          else content.append(el);
          if (scroll) el.querySelector(".st-scroll")?.scrollTo(0, scroll);
        }
      }
    };

  const DialogV2 = {
    /** Как DialogV2.wait: кнопки с callback(event, button) — button.form есть; закрыли — null. */
    async wait({ window: win, content, buttons = [] }) {
      return new Promise((resolve) => {
        const back = document.createElement("div");
        back.className = "mock-dialog";
        back.innerHTML = `<form><h3>${win?.title ?? ""}</h3><div>${content ?? ""}</div><footer>${buttons.map((b, i) => `<button type="button" data-i="${i}"${b.default ? " data-default" : ""}><i class="${b.icon ?? ""}"></i> ${b.label}</button>`).join("")}</footer></form>`;
        const form = back.querySelector("form");
        const finish = (i, event) => {
          const b = buttons[i];
          const el = form.querySelector(`[data-i="${i}"]`);
          back.remove();
          resolve(b?.callback ? b.callback(event, el) : b?.action ?? null);
        };
        back.addEventListener("click", (e) => {
          const el = e.target.closest("button[data-i]");
          if (el) finish(Number(el.dataset.i), e);
          else if (e.target === back) { back.remove(); resolve(null); }
        });
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          finish(Math.max(0, buttons.findIndex((b) => b.default)), e);
        });
        form.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); finish(Math.max(0, buttons.findIndex((b) => b.default)), e); }
          if (e.key === "Escape") { back.remove(); resolve(null); }
        });
        document.body.append(back);
        form.querySelector("[autofocus]")?.focus();
      });
    },
    /** Как DialogV2.prompt: одна кнопка ok с callback; закрыли — null. */
    async prompt({ window: win, content, ok = {} }) {
      return DialogV2.wait({ window: win, content, buttons: [{ action: "ok", label: ok.label ?? "OK", default: true, callback: ok.callback }] });
    },
    async confirm({ window: win, content }) {
      return new Promise((resolve) => {
        const back = document.createElement("div");
        back.className = "mock-dialog";
        back.innerHTML = `<form><h3>${win?.title ?? ""}</h3><div>${content ?? ""}</div><footer><button type="button" data-v="1">Да</button><button type="button" data-v="0">Нет</button></footer></form>`;
        back.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          back.remove();
          resolve(b.dataset.v === "1");
        });
        document.body.append(back);
      });
    },
  };

  class Field { constructor(options = {}) { this.options = options; this.initial = options.initial; } }
  class BooleanField extends Field { constructor(options = {}) { super({ initial: false, ...options }); } }

  window.foundry = {
    canvas: { primary: { PrimarySpriteMesh } },
    utils: {
      deepClone: clone,
      getProperty: (obj, path) => String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj),
      /** Как foundry.utils.expandObject: «a.b.c» → вложенные объекты. */
      expandObject(flat) {
        const out = {};
        for (const [path, v] of Object.entries(flat)) {
          const keys = path.split(".");
          const last = keys.pop();
          keys.reduce((o, k) => (o[k] ??= {}), out)[last] = v;
        }
        return out;
      },
      saveDataToFile(data, type, filename) {
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([data], { type })), download: filename });
        a.click();
      },
      escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]),
    },
    data: {
      fields: { StringField: Field, NumberField: Field, BooleanField, ObjectField: Field },
      regionBehaviors: { RegionBehaviorType: class RegionBehaviorType {} },
    },
    audio: {
      AudioHelper: {
        play({ src, volume }) {
          if (params.get("mute")) return;
          const audio = new Audio(`/${src.replace(`modules/${MODULE}/`, "")}`);
          audio.volume = volume ?? 0.7;
          audio.play().catch(() => {});
        },
      },
    },
    applications: {
      instances,
      api: { ApplicationV2, HandlebarsApplicationMixin, DialogV2 },
      // Как FormDataExtended: поля формы → { name: значение } (флажок — да/нет, число — число).
      ux: {
        FormDataExtended: class {
          constructor(el) {
            this.object = {};
            for (const input of el.querySelectorAll("input[name], select[name], textarea[name]")) {
              if (input.type === "checkbox") this.object[input.name] = input.checked;
              else if (input.type === "number") this.object[input.name] = input.value === "" ? null : Number(input.value);
              else this.object[input.name] = input.value;
            }
          }
        },
      },
      handlebars: { loadTemplates: (paths) => (window.__mock.partials = loadPartials(Array.isArray(paths) ? paths : Object.values(paths))) },
    },
  };

  window.__mock = {
    scene, users, actors: A, controlled, sprites, primary, GRID, testCollision,
    reset() { localStorage.removeItem(STORE_KEY); location.reload(); },
    get playerView() { return !gm.isGM; },
    /** Смотреть на карту как игрок: метки рисуются для игрока, заливка областей пропадает. */
    setPlayerView(on) {
      gm.isGM = !on;
      gm.playerAs = on ? "u-yura" : undefined;
      Hooks.callAll("canvasTearDown", canvas);
      Hooks.callAll("canvasReady", canvas);
    },
  };
})();
