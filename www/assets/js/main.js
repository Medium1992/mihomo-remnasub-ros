import { $, all, showPage, selectSettingsTab, protectedAction, toast, settleConfirm } from "./dom.js";
import { refreshRelativeTimes } from "./format.js";
import { copyViewer, selectViewerContents } from "./yaml.js";
import { headerRow } from "./headers.js";
import { load, schedulePoll } from "./refresh.js";
import { ui } from "./store.js";
import { applyMirroredTheme, watchSystemTheme } from "./theme.js";
import * as subscriptions from "./subscriptions.js";
import * as editor from "./editor.js";
import * as viewers from "./viewers.js";
import * as settings from "./settings.js";
import * as checks from "./checks.js";

// Frame-buster. X-Frame-Options busybox httpd к статике не добавляет, а
// frame-ancestors внутри <meta> CSP браузер игнорирует по спецификации. Без
// этой проверки чужая страница может открыть панель в невидимом фрейме:
// Basic-авторизация кешируется по origin'у и подставляется сама, так что
// клик по приманке уходит в наши кнопки. CSRF-guard от этого не спасает --
// запрос идёт изнутри нашей же страницы.
// Тема применяется из зеркала в localStorage до первого запроса, иначе
// светлая панель успевает мигнуть тёмной, пока не ответит CGI.
applyMirroredTheme();

if (window.top !== window.self) {
  document.documentElement.textContent = "RemnaSub RoS: страница не может быть открыта во фрейме";
  try { window.top.location = window.self.location; } catch (_) {}
} else {
  bootstrap();
}

// Как закрывается каждое окно. Порядок — от верхнего к нижнему: Esc и клик
// мимо окна закрывают только самое верхнее из открытых.
const MODAL_CLOSERS = [
  ["confirm-modal", () => settleConfirm(false)],
  ["check-modal", () => checks.closeCheck()],
  ["delete-modal", () => subscriptions.closeDelete()],
  ["runtime-events-modal", () => viewers.closeRuntimeEvents()],
  ["runtime-yaml-modal", () => viewers.closeRuntimeYaml()],
  ["source-yaml-modal", () => viewers.closeSourceYaml()],
  ["profile-modal-layer", () => protectedAction(editor.requestCloseEditor)()]
];

function closeTopModal() {
  const open = MODAL_CLOSERS.find(([id]) => !$(id).classList.contains("hidden"));
  if (open) open[1]();
}

function bootstrap() {

  all("[data-page-link]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.pageLink)));
  all("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => selectSettingsTab(button.dataset.settingsTab)));
  all('input[name="listener-mode"]').forEach((input) => input.addEventListener("change", settings.updateListenerPortFields));
  ["local-socks-enabled", "local-http-enabled"].forEach((id) => $(id).addEventListener("change", () => {
    settings.updateLocalInboundState();
    ui.settingsDirty = true;
  }));

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

  $("theme-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-theme-option]");
    if (card) settings.setTheme(card.dataset.themeOption);
  });
  $("accent-presets").addEventListener("click", (event) => {
    const swatch = event.target.closest("[data-accent-preset]");
    if (swatch) settings.setAccent(swatch.dataset.accentPreset);
  });
  $("accent-color").addEventListener("input", (event) => settings.setAccent(event.target.value));
  $("accent-reset").addEventListener("click", () => settings.setAccent(""));
  watchSystemTheme(settings.currentTheme, settings.currentAccent);

  $("add-profile").addEventListener("click", protectedAction(editor.createProfile));
  $("empty-add-profile").addEventListener("click", protectedAction(editor.createProfile));

  $("subscription-list").addEventListener("click", protectedAction(async (event) => {
    const button = event.target.closest("[data-profile-action]");
    if (button) {
      if (button.disabled) return;
      const profileId = button.dataset.profileId;
      const action = button.dataset.profileAction;
      if (action === "edit") await editor.openEditor(profileId);
      if (action === "refresh") await subscriptions.refreshProfile(profileId);
      if (action === "source") await viewers.openSourceYaml(profileId);
      if (action === "duplicate") await subscriptions.duplicateProfile(profileId);
      if (action === "delete") subscriptions.askDelete(profileId);
      if (action === "select") await subscriptions.selectProfile(profileId);
      if (action === "start") await subscriptions.setRuntime("start", profileId);
      if (action === "stop") await subscriptions.setRuntime("stop", profileId);
      return;
    }
    if (event.target.closest("[data-profile-diagnostics], a")) return;
    const card = event.target.closest("[data-profile-row]");
    if (card) await subscriptions.selectProfile(card.dataset.profileRow);
  }));

  // Правки на вкладках «Доступ» и «Резервная копия» в state.conf не пишутся.
  const tracksSettings = (event) => !event.target.closest('[data-settings-panel="access"], [data-settings-panel="backup"]');
  $("settings-form").addEventListener("input", (event) => { if (tracksSettings(event)) ui.settingsDirty = true; });
  $("settings-form").addEventListener("change", (event) => { if (tracksSettings(event)) ui.settingsDirty = true; });
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
  $("profile-use-provider-interval").addEventListener("change", editor.updateRefreshField);
  $("mihomo-sniffer-override").addEventListener("change", () => {
    settings.updateSnifferOverrideState(true);
    ui.settingsDirty = true;
  });
  $("mihomo-sniffer-enable").addEventListener("change", () => settings.updateSnifferOverrideState());
  settings.renderPresetButtons("global-override-presets", "global-override");
  settings.renderPresetButtons("profile-override-presets", "profile-override");
  // Предупреждение о ключах, которые перекроет контейнер, зависит от
  // переключателей рядом, поэтому пересчитывается и на их изменение.
  const checkGlobalProblems = settings.watchOverrideProblems("global-override", "global-override-problem", settings.globalOverrideContext);
  const checkProfileProblems = settings.watchOverrideProblems("profile-override", "profile-override-problem", editor.profileOverrideContext);
  $("settings-form").addEventListener("change", checkGlobalProblems);
  $("profile-form").addEventListener("change", checkProfileProblems);
  $("check-global-override").addEventListener("click", protectedAction(settings.checkGlobalOverride));
  $("check-profile-override").addEventListener("click", protectedAction(editor.checkProfileOverride));
  $("check-toggle-yaml").addEventListener("click", protectedAction(checks.toggleCheckYaml));
  $("close-check").addEventListener("click", checks.closeCheck);
  $("done-check").addEventListener("click", checks.closeCheck);
  $("copy-check").addEventListener("click", protectedAction(() => copyViewer("check-viewer", "Скопировано")));

  $("save-settings").addEventListener("click", protectedAction(settings.saveSettings));
  $("reset-network-timeouts").addEventListener("click", () => {
    Object.entries(settings.networkTimeoutDefaults).forEach(([id, value]) => { $(id).value = value; });
    ui.settingsDirty = true;
    toast("Таймауты возвращены к значениям RouterOS");
  });
  $("reset-tcp-tuning").addEventListener("click", () => {
    Object.entries(settings.tcpTuningDefaults).forEach(([id, value]) => { $(id).value = value; });
    ui.settingsDirty = true;
    toast("TCP-тюнинг возвращён к рекомендуемым значениям");
  });

  $("backup-download").addEventListener("click", protectedAction(settings.downloadBackup));
  $("backup-restore").addEventListener("click", () => $("backup-file").click());
  $("backup-file").addEventListener("change", protectedAction(async () => {
    const file = $("backup-file").files[0];
    $("backup-file").value = "";
    await settings.restoreBackup(file);
  }));

  $("profile-age-generate").addEventListener("click", protectedAction(editor.generateAgeKeypair));
  $("copy-profile-age-public").addEventListener("click", protectedAction(() => copyViewer("profile-age-public", "Публичный ключ скопирован")));
  $("profile-form").addEventListener("submit", protectedAction(editor.saveProfile));
  $("close-editor").addEventListener("click", protectedAction(editor.requestCloseEditor));
  $("cancel-editor").addEventListener("click", protectedAction(editor.requestCloseEditor));

  $("open-active-runtime-yaml").addEventListener("click", protectedAction(viewers.openRuntimeYaml));
  $("open-runtime-events").addEventListener("click", viewers.openRuntimeEvents);
  all("[data-log-tab]").forEach((button) => button.addEventListener("click", () => viewers.setLogKind(button.dataset.logTab)));
  all("[data-runtime-view]").forEach((button) => button.addEventListener("click", protectedAction(() => viewers.setRuntimeView(button.dataset.runtimeView))));
  $("runtime-yaml-wrap").addEventListener("click", viewers.toggleRuntimeWrap);
  $("download-active-runtime-yaml").addEventListener("click", viewers.downloadRuntimeYaml);
  $("close-runtime-yaml").addEventListener("click", viewers.closeRuntimeYaml);
  $("done-runtime-yaml").addEventListener("click", viewers.closeRuntimeYaml);
  $("close-runtime-events").addEventListener("click", viewers.closeRuntimeEvents);
  $("done-runtime-events").addEventListener("click", viewers.closeRuntimeEvents);
  $("close-source-yaml").addEventListener("click", viewers.closeSourceYaml);
  $("done-source-yaml").addEventListener("click", viewers.closeSourceYaml);

  $("copy-active-runtime-yaml").addEventListener("click", protectedAction(() => copyViewer("active-runtime-yaml", "Рабочий YAML скопирован")));
  $("copy-runtime-events").addEventListener("click", protectedAction(() => copyViewer("runtime-events", "Журнал скопирован")));
  $("copy-source-yaml").addEventListener("click", protectedAction(() => copyViewer("source-yaml-viewer", "Полученный YAML скопирован")));
  $("copy-basic-auth-hash").addEventListener("click", protectedAction(() => copyViewer("basic-auth-hash", "Хеш скопирован")));

  $("generate-basic-auth-hash").addEventListener("click", protectedAction(settings.generateBasicAuthHash));
  ["basic-auth-password", "basic-auth-password-confirm"].forEach((id) => $(id).addEventListener("input", () => {
    $("basic-auth-hash-result").classList.add("hidden");
    $("basic-auth-hash").value = "";
  }));

  $("delete-cancel").addEventListener("click", subscriptions.closeDelete);
  $("delete-confirm").addEventListener("click", protectedAction(subscriptions.confirmDelete));
  $("confirm-cancel").addEventListener("click", () => settleConfirm(false));
  $("confirm-accept").addEventListener("click", () => settleConfirm(true));

  // Клик мимо окна закрывает его. mousedown, а не click: иначе выделение
  // текста, отпущенное за краем окна, закрывало бы редактор.
  all(".modal-layer").forEach((layer) => layer.addEventListener("mousedown", (event) => {
    if (event.target !== layer) return;
    const closer = MODAL_CLOSERS.find(([id]) => id === layer.id);
    if (closer) closer[1]();
  }));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && event.target.classList.contains("yaml-viewer")) {
      event.preventDefault();
      selectViewerContents(event.target);
      return;
    }
    if (event.key === "Escape") closeTopModal();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!ui.settingsDirty && !editor.editorDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const initialPage = location.hash.slice(1);
  showPage(initialPage === "settings" ? "settings" : "subscriptions");
  window.setInterval(() => { if (!document.hidden) refreshRelativeTimes(); }, 15000);
  window.addEventListener("focus", refreshRelativeTimes);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshRelativeTimes();
  });
  load().catch(() => {}).finally(() => schedulePoll());
}
