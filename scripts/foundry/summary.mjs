/* Короткие сводки ловушки для окон: строки характеристик карточки и подсказки под параметрами
   устройства («3d6 дробящий · Сл 15»). */

import { trapMode } from "../core/trap.mjs";
import { abilityAbbr, conditionLabel, damageLabel, skillLabel } from "./universal.mjs";
import { t } from "./i18n.mjs";

const damagePart = (formula, type) => `${formula} ${damageLabel(type).toLowerCase()}`;

/**
 * Как срабатывает ловушка — подпись в подвале карточки; "" — от самой области (обычный случай).
 * count — сколько триггеров стоит на сцене (у ловушки на сцене); null — карточка из библиотеки,
 * тогда сколько их поставится вместе с ловушкой.
 */
export function activationLabel(trap, count = null) {
  if (trap.manual) return t("Activation.manual");
  const n = count ?? trap.activators ?? 0;
  return n ? t("Activation.count", { n }) : "";
}

/** На кого действует: с триггером — на всех в области, иначе как настроено. */
export const affectsLabel = (trap, hasActivator = (trap.activators ?? 0) > 0) => t(`Affects.${hasActivator ? "area" : trap.affects}`);

/** Строки характеристик: заметить, обезвредить, проверка, урон, состояние, выбраться. */
export function stats(trap) {
  const mode = trapMode(trap);
  const check =
    mode === "attack"
      ? `+${trap.attackBonus} ${t("Stat.attack").toLowerCase()}`
      : mode === "save"
        ? `${abilityAbbr(trap.saveAbility)} ${t("Stat.dc", { dc: trap.saveDC })}`
        : t("Stat.auto");
  const parts = [[trap.damage, trap.damageType], [trap.damage2, trap.damage2Type || trap.damageType]]
    .filter(([f]) => f)
    .map(([f, type]) => damagePart(f, type));
  return [
    {
      key: "detect",
      icon: "fa-eye",
      label: t("Stat.detect"),
      // Обычный навык обнаружения — без подписи; другой (Анализ, Поиск…) — пишем явно.
      value: `${t("Stat.dc", { dc: trap.detectDC })}${trap.detectSkill && trap.detectSkill !== "notice" ? ` · ${skillLabel(trap.detectSkill)}` : ""} · ${t("Stat.within", { n: trap.detectRange ?? 10 })}`,
    },
    { key: "disarm", icon: "fa-screwdriver-wrench", label: t("Stat.disarm"), value: `${t("Stat.dc", { dc: trap.disarmDC })} · ${skillLabel(trap.disarmSkill)}` },
    { key: "check", icon: mode === "attack" ? "fa-crosshairs" : "fa-dice-d20", label: t(mode === "attack" ? "Stat.attack" : "Stat.save"), value: check },
    { key: "damage", icon: "fa-heart-crack", label: t("Stat.damage"), value: parts.join(" + ") || t("Stat.noDamage") },
    ...(trap.condition ? [{ key: "condition", icon: "fa-person-falling", label: t("Stat.condition"), value: conditionLabel(trap.condition) }] : []),
    ...(trap.escapeDC
      ? [{ key: "escape", icon: "fa-person-arrow-up-from-line", label: t("Stat.escape"), value: `${t("Stat.dc", { dc: trap.escapeDC })} · ${skillLabel(trap.escapeSkill)}` }]
      : []),
  ];
}

/** Что сейчас задаёт параметр устройства: значения его полей коротко. → [строки] */
export function fieldChips(trap, fields) {
  const out = [];
  for (const field of fields) {
    switch (field) {
      case "damage":
        out.push(trap.damage ? damagePart(trap.damage, trap.damageType) : t("Stat.noDamageShort"));
        break;
      case "damage2":
        if (trap.damage2) out.push(`+ ${damagePart(trap.damage2, trap.damage2Type || trap.damageType)}`);
        break;
      case "condition":
        if (trap.condition) out.push(conditionLabel(trap.condition));
        break;
      case "escapeDC":
        if (trap.escapeDC) out.push(t("Device.chip.escape", { dc: trap.escapeDC }));
        break;
      case "attackBonus":
        if (trap.attackBonus !== null) out.push(t("Device.chip.attack", { bonus: trap.attackBonus }));
        break;
      case "saveDC":
        out.push(t("Device.chip.save", { dc: trap.saveDC }));
        break;
      case "onSave":
        if (trap.saveAbility) out.push(t("Device.chip.onSave", { result: t(`OnSave.${trap.onSave}`).toLowerCase() }));
        break;
      case "affects":
        out.push(t(`Affects.${trap.affects}`));
        break;
      case "sound":
        if (trap.sound) out.push(t(`Sound.${trap.sound}`));
        break;
      default:
        break;
    }
  }
  return out;
}
