/* Окно «Правила»: мастер настраивает модуль под свою систему — пресет, кто бросает, формула и
   сравнение, списки спасбросков и навыков с путями к числам в листе, урон и хиты, состояния,
   обнаружение, обезвреживание. Проверка путей на выделенном токене, экспорт и импорт в JSON.
   Правила — настройка мира (core/rules.mjs), «кто бросает» — отдельная настройка (её же
   переключают на вкладке сцены). */

import { CONDITIONS } from "../../core/trap.mjs";
import {
  COMPARES,
  CRITS,
  DETECT_MODES_RULES,
  HP_MODES,
  normalizeProfile,
  PRESET_NAMES,
  PRESET_SAVE_ROLLS,
  presetProfile,
  SAVE_CATEGORIES,
  SAVE_ROLLS,
  SKILL_CATEGORIES,
  TARGETS,
} from "../../core/rules.mjs";
import { SETTINGS, THEME, tpl } from "../constants.mjs";
import { esc, t } from "../i18n.mjs";
import { setSetting, setting } from "../settings.mjs";
import { applySuggestion, scanSheet, suggestPaths } from "../../core/sheet-scan.mjs";
import { SYSTEM_PRESETS, systemPreset } from "../../core/system-presets.mjs";
import { conditionLabel, probe, systemStatuses } from "../universal.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const APP_ID = "ssl-traps-rules";

const opts = (list, prefix, current) => list.map((v) => ({ value: v, label: t(`${prefix}.${v}`), selected: v === current }));
/** Подпись строки по умолчанию (для ключей пресета есть перевод), чтобы мастер видел, что будет. */
const defaultLabel = (key) => (game.i18n.has(`TRAPS.RuleKey.${key}`) ? t(`RuleKey.${key}`) : key);

export class RulesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    tag: "form",
    classes: ["ssl-traps", "st-app", "st-rules"],
    window: { icon: "fa-solid fa-scale-balanced", resizable: true, title: "TRAPS.Rules.title" },
    position: { width: 920, height: 780 },
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      preset: RulesApp.#onPreset,
      addRow: RulesApp.#onAddRow,
      removeRow: RulesApp.#onRemoveRow,
      probe: RulesApp.#onProbe,
      findPaths: RulesApp.#onFindPaths,
      exportRules: RulesApp.#onExport,
      importRules: RulesApp.#onImport,
      save: RulesApp.#onSave,
    },
  };

  static PARTS = { body: { template: tpl("rules.hbs"), scrollable: [".st-scroll"] } };

  static open() {
    if (!game.user.isGM) {
      ui.notifications.warn(t("Notify.gmOnly"));
      return null;
    }
    const app = foundry.applications.instances.get(APP_ID) ?? new RulesApp();
    const wasOpen = app.rendered;
    app.render({ force: true });
    if (wasOpen) app.bringToFront?.();
    return app;
  }

  constructor(options = {}) {
    super(options);
    // Мастер ещё не сохранял правила, а систему мы знаем — сразу подставляем её правила.
    const saved = setting(SETTINGS.rules);
    const known = systemPreset(game.system?.id);
    const fresh = !saved || !Object.keys(saved).length;
    this.draft = normalizeProfile(fresh && known ? known.rules : saved);
    this.saveRolls = fresh && known ? known.saveRolls : setting(SETTINGS.saveRolls);
    this.probeLines = null;
    // Что раскрыто: «Расширенные настройки» и группы внутри (переживает перерисовку окна).
    this.open = new Set();
  }

  get title() {
    return t("Rules.title");
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.dataset.stTheme = THEME;
    return frame;
  }

  async _prepareContext() {
    const d = this.draft;
    const rowOf = (list) => (r, i) => ({
      ...r,
      index: i,
      list,
      placeholder: defaultLabel(r.key),
      canRemove: d[list].length > 1,
      // Своё сравнение строки: пусто — как в общих правилах.
      compareOptions: [
        { value: "", label: t("Rules.compareDefault"), selected: !r.compare },
        { value: "gte", label: "≥", selected: r.compare === "gte" },
        { value: "lte", label: "≤", selected: r.compare === "lte" },
      ],
    });
    const mapOf = (cats, list) =>
      cats.map((c) => ({
        cat: c,
        label: t(`RuleCatName.${c}`),
        options: d[list].map((r) => ({ value: r.key, label: r.label || defaultLabel(r.key), selected: d.map[c] === r.key })),
      }));
    const statuses = systemStatuses();
    const known = systemPreset(game.system?.id);
    return {
      // Правила системы уже стоят — так и скажем; стоят другие — подскажем её кнопку.
      system: known ? t(d.preset === "system" && d.system === game.system.id ? "Rules.systemKnown" : "Rules.systemAvailable", { system: known.title }) : "",
      // Все системы, под которые есть готовые правила; своя — первой.
      systems: Object.entries(SYSTEM_PRESETS)
        .map(([id, p]) => ({ id, label: p.title, mine: id === game.system?.id, active: d.preset === "system" && d.system === id }))
        .sort((a, b) => Number(b.mine) - Number(a.mine)),
      advancedOpen: this.open.has("advanced"),
      open: Object.fromEntries([...this.open].map((k) => [k, true])),
      presets: PRESET_NAMES.map((p) => ({ value: p, label: t(`Rules.preset.${p}`), active: d.preset === p })),
      // Выбран ли сейчас какой-то пресет (или правила уже свои) и что он делает — под списком.
      presetCurrent: d.preset === "system" ? Boolean(SYSTEM_PRESETS[d.system]) : PRESET_NAMES.includes(d.preset),
      presetHint:
        d.preset === "system" && SYSTEM_PRESETS[d.system]
          ? t("Rules.preset.systemHint", { system: SYSTEM_PRESETS[d.system].title })
          : PRESET_NAMES.includes(d.preset)
            ? t(`Rules.preset.${d.preset}Hint`)
            : t("Rules.presetHint"),
      saveRolls: opts(SAVE_ROLLS, "Settings.saveRolls", this.saveRolls),
      // Что значит выбранный режим — простыми словами, под списком.
      saveRollsMode: t(`Rules.saveRollsMode.${this.saveRolls}`),
      formula: d.formula,
      compare: opts(COMPARES, "Rules.compare", d.compare),
      target: opts(TARGETS, "Rules.targetMode", d.target),
      sheetTarget: d.target === "sheet",
      crits: opts(CRITS, "Rules.crits", d.crits),
      critDouble: d.critDouble,
      askBonus: d.askBonus,
      saves: d.saves.map(rowOf("saves")),
      skills: d.skills.map(rowOf("skills")),
      saveMap: mapOf(SAVE_CATEGORIES, "saves"),
      skillMap: mapOf(SKILL_CATEGORIES, "skills"),
      acPath: d.acPath,
      hp: opts(HP_MODES, "Rules.hp", d.hp),
      hpPath: d.hpPath,
      hpIsPath: d.hp === "path",
      types: d.types.join(", "),
      conditions: CONDITIONS.map((c) => {
        const current = d.conditions[c] ?? "";
        const same = statuses.some((s) => s.id === c);
        return {
          key: c,
          label: t(`Condition.${c}`),
          options: [
            { value: "", label: same ? t("Rules.conditionSame", { name: conditionLabel(c) }) : t("Rules.conditionNone"), selected: !current },
            ...statuses.map((s) => ({ value: s.id, label: s.label, selected: current === s.id })),
          ],
        };
      }),
      detect: opts(DETECT_MODES_RULES, "Rules.detect", d.detect),
      passivePath: d.passivePath,
      detectPassive: d.detect === "passive",
      disarmFailBy: d.disarmFailBy,
      probe: this.probeLines,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Любое изменение поля — в черновик (и перерисовать, если от него зависит вид окна). Окно
    // перерисовывается в том же элементе — слушатель вешаем один раз.
    if (this._bound) return;
    this._bound = true;
    // Раскрыли или свернули группу — запомнить.
    this.element.addEventListener(
      "toggle",
      (event) => {
        const el = event.target;
        const key = el?.dataset?.advanced !== undefined ? "advanced" : el?.dataset?.group;
        if (!key) return;
        if (el.open) this.open.add(key);
        else this.open.delete(key);
      },
      true,
    );
    this.element.addEventListener("change", (event) => {
      // Выбрали пресет в списке — подставить его сразу.
      if (event.target?.matches?.("[data-preset-pick]")) {
        if (event.target.value) RulesApp.#applyPreset.call(this, event.target.value);
        return;
      }
      const name = event.target?.name;
      if (!name) return;
      this.#readForm();
      if (["target", "hp", "detect", "saveRolls"].includes(name)) this.render();
    });
  }

  /** Форма → черновик (без сохранения). */
  #readForm() {
    const form = this.element?.tagName === "FORM" ? this.element : (this.element?.querySelector("form") ?? this.element);
    if (!form) return;
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    const list = (v) => (v && typeof v === "object" ? Object.values(v) : []);
    this.saveRolls = SAVE_ROLLS.includes(data.saveRolls) ? data.saveRolls : this.saveRolls;
    this.draft = normalizeProfile({
      ...this.draft,
      formula: data.formula,
      compare: data.compare,
      target: data.target,
      crits: data.crits,
      critDouble: data.critDouble,
      askBonus: data.askBonus,
      saves: list(data.saves),
      skills: list(data.skills),
      map: { ...this.draft.map, ...(data.map ?? {}) },
      acPath: data.acPath,
      hp: data.hp,
      hpPath: data.hpPath,
      types: String(data.types ?? "").split(/[,;\s]+/),
      conditions: Object.fromEntries(Object.entries(data.conditions ?? {}).filter(([, v]) => v)),
      detect: data.detect,
      passivePath: data.passivePath,
      disarmFailBy: data.disarmFailBy,
    });
  }

  static #onPreset(event, target) {
    RulesApp.#applyPreset.call(this, target.dataset.preset);
  }

  /** Подставить пресет: общий («d20», «gm») или готовые правила системы («system:ose»). */
  static #applyPreset(name) {
    if (name.startsWith("system:")) {
      const known = systemPreset(name.slice(7));
      if (!known) return;
      this.draft = normalizeProfile(known.rules);
      this.saveRolls = known.saveRolls;
    } else {
      this.draft = presetProfile(name);
      this.saveRolls = PRESET_SAVE_ROLLS[name] ?? this.saveRolls;
    }
    this.probeLines = null;
    this.render();
  }

  /** Выделенный токен → его персонаж (или null с подсказкой). */
  #selectedActor() {
    const token = canvas.tokens?.controlled?.[0];
    const actor = token?.actor ?? token?.document?.actor;
    if (!actor) ui.notifications.warn(t("Notify.selectToken"));
    return actor ?? null;
  }

  /** «Найти в листе»: модуль сам ищет пути к числам у выделенного персонажа и подставляет пустые. */
  static #onFindPaths() {
    this.#readForm();
    const actor = this.#selectedActor();
    if (!actor) return;
    const suggestion = suggestPaths(this.draft, scanSheet(actor.system));
    this.draft = normalizeProfile(applySuggestion(this.draft, suggestion));
    const what = (w) => (w === "ac" ? t("Rules.fields.acPath") : w === "passive" ? t("Rules.fields.passivePath") : w === "hp" ? t("Rules.fields.hpPath") : defaultLabel(w));
    this.probeLines = {
      title: t("Rules.foundTitle", { name: actor.name, n: suggestion.found.length }),
      empty: suggestion.found.length ? "" : t("Rules.foundNone"),
      lines: suggestion.found.map((f) => ({ label: what(f.what), path: f.path, value: f.value, ok: true })),
    };
    this.render();
  }

  static #onAddRow(event, target) {
    this.#readForm();
    const list = target.dataset.list;
    const n = this.draft[list].length + 1;
    this.draft = normalizeProfile({ ...this.draft, [list]: [...this.draft[list], { key: `${list === "saves" ? "save" : "skill"}-${n}`, label: "" }] });
    this.render();
  }

  static #onRemoveRow(event, target) {
    this.#readForm();
    const { list, index } = target.dataset;
    const rows = this.draft[list].filter((_, i) => i !== Number(index));
    this.draft = normalizeProfile({ ...this.draft, [list]: rows });
    this.render();
  }

  /** Что нашлось по путям у выделенного токена. */
  static #onProbe() {
    this.#readForm();
    const actor = this.#selectedActor();
    if (!actor) return;
    const lines = probe(actor, this.draft);
    this.probeLines = {
      title: actor.name,
      lines: lines.map((l) => ({ ...l, ok: l.value !== null, value: l.value ?? t("Rules.probeMissing") })),
      empty: lines.length ? "" : t("Rules.probeEmpty"),
    };
    this.render();
  }

  static #onExport() {
    this.#readForm();
    const json = JSON.stringify({ ...this.draft, saveRolls: this.saveRolls }, null, 2);
    foundry.utils.saveDataToFile(json, "application/json", "trap-rules.json");
  }

  static async #onImport() {
    const DialogV2 = foundry.applications.api.DialogV2;
    const text = await DialogV2.prompt({
      window: { title: t("Rules.importTitle") },
      content: `<p>${esc(t("Rules.importHint"))}</p><textarea name="json" rows="12" style="width:100%;font-family:monospace"></textarea>`,
      ok: { label: t("Rules.import"), callback: (e, button) => button.form.elements.json.value },
      rejectClose: false,
    });
    if (!text) return;
    try {
      const data = JSON.parse(text);
      this.draft = normalizeProfile(data);
      if (SAVE_ROLLS.includes(data.saveRolls)) this.saveRolls = data.saveRolls;
      this.render();
      ui.notifications.info(t("Rules.imported"));
    } catch {
      ui.notifications.error(t("Rules.importBad"));
    }
  }

  static async #onSave() {
    this.#readForm();
    await setSetting(SETTINGS.rules, this.draft);
    if (this.saveRolls !== setting(SETTINGS.saveRolls)) await setSetting(SETTINGS.saveRolls, this.saveRolls);
    ui.notifications.info(t("Rules.saved"));
    this.close();
  }
}
