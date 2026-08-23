// Единственное место, где живёт изменяемое состояние UI. Модули импортируют
// сам объект и меняют его поля: переприсваивать импортированные привязки ES-
// модули не позволяют, а разделяемое состояние здесь нужно.
import { decode } from "./codec.js";
import { parseSubscriptionUserinfo } from "./format.js";

export const store = {
  model: { state: {}, profiles: [], profile: null },
  runtime: {}
};

// Флаги и отпечатки рендера. Отпечаток нужен, чтобы опрос раз в пять секунд
// не перерисовывал разметку, в которой пользователь стоит курсором.
export const ui = {
  editorProfileId: "",
  editorRequestToken: 0,
  selectingProfileId: "",
  sourceYamlProfileId: "",
  deleteProfileId: "",
  settingsReady: false,
  settingsDirty: false,
  settingsFingerprint: "",
  subscriptionsFingerprint: "",
  sidebarFingerprint: "",
  activeRuntimeFingerprint: "",
  activeRuntimeYamlVersion: ""
};

export function requiredHeaders() {
  return [
    ["x-hwid", "RouterOS-Solomon"],
    ["x-device-os", "RouterOS"],
    ["x-ver-os", "7.23.3"],
    ["x-device-model", "MikroTik RB5009UG+S+IN"],
    ["user-agent", decode(store.model.state.default_user_agent_b64) || "clash.meta/1.19.29"]
  ];
}

export function activeProfile() {
  return store.model.profiles.find((profile) => profile.id === store.model.state.active_profile_id)
    || store.model.profile
    || null;
}

export function profileById(profileId) {
  return store.model.profiles.find((profile) => profile.id === profileId) || null;
}

export function profileName(profile) {
  return profile
    ? (decode(profile.display_name_b64) || decode(profile.name_b64) || profile.id || "Без названия")
    : "Подписка не выбрана";
}

export function profileLocalName(profile) {
  return profile ? (decode(profile.name_b64) || profile.id || "Без названия") : "";
}

export function profileUrl(profile) {
  return profile ? decode(profile.url_b64) : "";
}

export function profileBusy(profile) {
  return ["queued", "running"].includes(profile && profile.refresh_state);
}

export function refreshStageLabel(profile) {
  if (!profile) return "";
  if (profile.refresh_state === "queued") return "В очереди";
  if (profile.refresh_state !== "running") return "";
  return ({
    downloading: "Загрузка YAML",
    validating: "Проверка конфигурации",
    building: "Сборка конфигурации"
  })[profile.refresh_stage] || "Обновление";
}

export function profileDiagnostic(profile) {
  return decode(profile.refresh_validation_b64) || decode(profile.error_b64) || decode(profile.refresh_message_b64);
}

export function anyBackgroundWork() {
  return store.model.profiles.some(profileBusy) || store.runtime.external_ui_state === "downloading";
}

// Remnawave помечает истёкшую или отключённую подписку служебными VLESS-
// прокси с нулевым UUID — их считает бэкенд, здесь только формулировка.
export function providerAccessState(profile) {
  if (!profile) return null;
  const userinfo = parseSubscriptionUserinfo(decode(profile.subscription_userinfo_b64));
  const expire = Number(userinfo.expire || 0);
  const expired = Number.isFinite(expire) && expire > 0 && expire <= Math.floor(Date.now() / 1000);
  const entries = decode(profile.zero_vless_entries_b64).split(/\r?\n/).filter(Boolean).map((line, index) => {
    const name = line.split("\t", 1)[0].trim();
    return name || `VLESS #${index + 1}`;
  });
  const zeroCount = Math.max(Number(profile.zero_vless_count || 0), entries.length);
  if (!expired && zeroCount === 0) return null;
  return {
    expired,
    expire,
    zeroCount,
    entries,
    label: expired ? "Срок подписки истёк" : "Подписка отключена или ограничена",
    note: zeroCount
      ? `Провайдер вернул ${zeroCount} служебн${zeroCount === 1 ? "ый" : "ых"} VLESS-прокси с нулевым UUID. Обычно так Remnawave обозначает истёкшую, отключённую или ограниченную подписку.`
      : "Срок действия из заголовка subscription-userinfo уже истёк."
  };
}
