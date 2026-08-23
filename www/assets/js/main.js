import { $, all, showPage, selectSettingsTab, protectedAction, toast } from "./dom.js";
import { refreshRelativeTimes } from "./format.js";
import { copyViewer, selectViewerContents } from "./yaml.js";
import { headerRow } from "./headers.js";
import { load, schedulePoll, pollDelay } from "./refresh.js";
import { ui } from "./store.js";
import * as subscriptions from "./subscriptions.js";
import * as editor from "./editor.js";
import * as viewers from "./viewers.js";
import * as settings from "./settings.js";

// Frame-buster. X-Frame-Options busybox httpd к статике не добавляет, а
// frame-ancestors внутри <meta> CSP браузер игнорирует по спецификации. Без
// этой проверки чужая страница может открыть панель в невидимом фрейме:
// Basic-авторизация кешируется по origin'у и подставляется сама, так что
// клик по приманке уходит в наши кнопки. CSRF-guard от этого не спасает --
// запрос идёт изнутри нашей же страницы.
if (window.top !== window.self) {
  document.documentElement.textContent = "RemnaSub RoS: страница не может быть открыта во фрейме";
  try { window.top.location = window.self.location; } catch (_) {}
} else {
  bootstrap();
}

function bootstrap() {

  all("[data-page-link]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.pageLink)));
  all("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => selectSettingsTab(button.dataset.settingsTab)));
  all('input[name="listener-mode"]').forEach((input) => input.addEventListener("change", settings.updateListenerPortFields));

  $("external-ui-preset").addEventListener("change", () => {
    settings.updateExternalUIPreset();
    ui.settingsDirty = true;
  });
  $("external-ui-url").addEventListener("input", () => {
    if ($("external-ui-preset").value === "custom") $("external-ui-url").dataset.customUrl = $("external-ui-url").value;
  });
  $("toggle-external-ui-secret").addEventListener("click", () => {
    const input = $("external-ui-secret");
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    $("toggle-external-ui-secret").title = reveal ? "Скрыть пароль" : "Показать пароль";
  });
  all("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
    const input = $(button.dataset.togglePassword);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.title = reveal ? "Скрыть пароль" : "Показать пароль";
  }));
  all("[data-open-mihomo]").forEach((button) => button.addEventListener("click", settings.openMihomo));

  $("add-profile").addEventListener("click", protectedAction(editor.createProfile));
  $("empty-add-profile").addEventListener("click", protectedAction(editor.createProfile));

  $("subscription-list").addEventListener("click", protectedAction(async (event) => {
    const button = event.target.closest("[data-profile-action]");
    if (button) {
      if (button.disabled) return;
      const profileId = button.dataset.profileId;
      if (button.dataset.profileAction === "edit") await editor.openEditor(profileId);
      if (button.dataset.profileAction === "refresh") await subscriptions.refreshProfile(profileId);
      if (button.dataset.profileAction === "source") await viewers.openSourceYaml(profileId);
      if (button.dataset.profileAction === "delete") subscriptions.askDelete(profileId);
      if (button.dataset.profileAction === "start") await subscriptions.setRuntime("start", profileId);
      if (button.dataset.profileAction === "stop") await subscriptions.setRuntime("stop", profileId);
      return;
    }
    if (event.target.closest("[data-profile-diagnostics]")) return;
    const card = event.target.closest("[data-profile-row]");
    if (card) await subscriptions.selectProfile(card.dataset.profileRow);
  }));
  $("subscription-list").addEventListener("keydown", protectedAction(async (event) => {
    if (!["Enter", " "].includes(event.key) || event.target.closest("button, details")) return;
    const card = event.target.closest("[data-profile-row]");
    if (!card) return;
    event.preventDefault();
    await subscriptions.selectProfile(card.dataset.profileRow);
  }));

  $("settings-form").addEventListener("input", (event) => {
    if (!event.target.closest('[data-settings-panel="access"]')) ui.settingsDirty = true;
  });
  $("settings-form").addEventListener("change", (event) => {
    if (!event.target.closest('[data-settings-panel="access"]')) ui.settingsDirty = true;
  });
  $("add-global-header").addEventListener("click", () => {
    $("global-header-rows").insertAdjacentHTML("beforeend", headerRow({ key: "", value: "", required: false }));
    ui.settingsDirty = true;
    const rows = all("[data-header-row]", $("global-header-rows"));
    rows[rows.length - 1].querySelector("[data-header-key]").focus();
  });
  $("global-header-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-header]");
    if (!button) return;
    button.closest("[data-header-row]").remove();
    ui.settingsDirty = true;
  });
  $("add-profile-header").addEventListener("click", () => {
    $("profile-header-rows").insertAdjacentHTML("beforeend", headerRow({ key: "", value: "", required: false }));
    const rows = all("[data-header-row]", $("profile-header-rows"));
    rows[rows.length - 1].querySelector("[data-header-key]").focus();
  });
  $("profile-header-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-header]");
    if (button) button.closest("[data-header-row]").remove();
  });

  $("profile-local-override-enabled").addEventListener("change", () => editor.updateLocalOverrideState(true));
  $("mihomo-sniffer-override").addEventListener("change", () => {
    settings.updateSnifferOverrideState(true);
    ui.settingsDirty = true;
  });
  $("mihomo-sniffer-enable").addEventListener("change", () => settings.updateSnifferOverrideState());
  $("save-settings").addEventListener("click", protectedAction(settings.saveSettings));
  $("reset-network-timeouts").addEventListener("click", () => {
    Object.entries(settings.networkTimeoutDefaults).forEach(([id, value]) => { $(id).value = value; });
    ui.settingsDirty = true;
    toast("Таймауты возвращены к значениям RouterOS");
  });

  $("profile-form").addEventListener("submit", protectedAction(editor.saveProfile));
  $("close-editor").addEventListener("click", editor.closeEditor);
  $("cancel-editor").addEventListener("click", editor.closeEditor);

  $("open-active-runtime-yaml").addEventListener("click", protectedAction(viewers.openRuntimeYaml));
  $("open-runtime-events").addEventListener("click", viewers.openRuntimeEvents);
  $("close-runtime-yaml").addEventListener("click", viewers.closeRuntimeYaml);
  $("done-runtime-yaml").addEventListener("click", viewers.closeRuntimeYaml);
  $("close-runtime-events").addEventListener("click", viewers.closeRuntimeEvents);
  $("done-runtime-events").addEventListener("click", viewers.closeRuntimeEvents);
  $("close-source-yaml").addEventListener("click", viewers.closeSourceYaml);
  $("done-source-yaml").addEventListener("click", viewers.closeSourceYaml);

  $("copy-active-runtime-yaml").addEventListener("click", protectedAction(() => copyViewer("active-runtime-yaml", "Рабочий YAML скопирован")));
  $("copy-runtime-events").addEventListener("click", protectedAction(() => copyViewer("runtime-events", "События скопированы")));
  $("copy-source-yaml").addEventListener("click", protectedAction(() => copyViewer("source-yaml-viewer", "Полученный YAML скопирован")));
  $("copy-basic-auth-hash").addEventListener("click", protectedAction(() => copyViewer("basic-auth-hash", "Хеш скопирован")));

  $("generate-basic-auth-hash").addEventListener("click", protectedAction(settings.generateBasicAuthHash));
  ["basic-auth-password", "basic-auth-password-confirm"].forEach((id) => $(id).addEventListener("input", () => {
    $("basic-auth-hash-result").classList.add("hidden");
    $("basic-auth-hash").value = "";
  }));

  $("delete-cancel").addEventListener("click", subscriptions.closeDelete);
  $("delete-confirm").addEventListener("click", protectedAction(subscriptions.confirmDelete));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && event.target.classList.contains("yaml-viewer")) {
      event.preventDefault();
      selectViewerContents(event.target);
      return;
    }
    if (event.key !== "Escape") return;
    if (!$("delete-modal").classList.contains("hidden")) subscriptions.closeDelete();
    else if (!$("runtime-events-modal").classList.contains("hidden")) viewers.closeRuntimeEvents();
    else if (!$("runtime-yaml-modal").classList.contains("hidden")) viewers.closeRuntimeYaml();
    else if (!$("source-yaml-modal").classList.contains("hidden")) viewers.closeSourceYaml();
    else if (!$("profile-modal-layer").classList.contains("hidden")) editor.closeEditor();
  });

  const initialPage = location.hash.slice(1);
  showPage(initialPage === "settings" ? "settings" : "subscriptions");
  window.setInterval(refreshRelativeTimes, 15000);
  window.addEventListener("focus", refreshRelativeTimes);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshRelativeTimes();
  });
  load().catch(() => {}).finally(() => schedulePoll(pollDelay()));
}
