// Список подписок и боковая панель: карточка профиля, его состояние и
// действия над ним.
import { $, icon, escapeHtml, toast } from "./dom.js";
import { decode } from "./codec.js";
import { send, requestJson } from "./api.js";
import { formatBytes, formatInterval, formatUpdated } from "./format.js";
import { load, schedulePoll, onRender } from "./refresh.js";
import {
  store, ui, activeProfile, profileById, profileName, profileUrl,
  profileBusy, refreshStageLabel, profileDiagnostic, providerAccessState
} from "./store.js";

export function profileHealth(profile) {
  if (profile.id === ui.selectingProfileId) return { className: "warning busy", label: "Переключение..." };
  const active = profile.id === store.model.state.active_profile_id;
  const error = decode(profile.error_b64) || (active ? decode(store.runtime.error_b64) : "");
  const source = Boolean(profile.source_present || (active && store.runtime.source_present));
  const final = Boolean(profile.final_present || (active && store.runtime.final_present));
  const busy = refreshStageLabel(profile);
  if (busy) return { className: "warning busy", label: busy };
  const access = providerAccessState(profile);
  if (access) return { className: "error", label: access.label };
  if (profile.refresh_state === "error" && profile.refresh_stage === "download") {
    return { className: "error", label: profile.refresh_http_status ? `Ошибка · HTTP ${profile.refresh_http_status}` : "Ошибка загрузки" };
  }
  if (profile.refresh_state === "error" || profile.configuration_valid === "0") {
    return { className: "error", label: final ? "Обновление отклонено" : "Ошибка конфигурации" };
  }
  if (error) return { className: "error", label: "Ошибка конфигурации" };
  if (!profileUrl(profile)) return { className: "warning", label: "URL не настроен" };
  if (active && store.runtime.mihomo_running) return { className: "good", label: "Mihomo работает" };
  if (active && store.runtime.run_enabled) return { className: "warning", label: "Ожидание запуска" };
  if (final) return { className: "good", label: "Конфигурация проверена" };
  if (source) return { className: "good", label: "YAML получен" };
  return { className: "", label: "Не загружалась" };
}

export function renderSidebar() {
  const active = activeProfile();
  const switching = Boolean(ui.selectingProfileId);
  const running = Boolean(!switching && store.runtime.mihomo_running && store.runtime.run_enabled && store.runtime.configured && store.runtime.final_present);
  const waiting = Boolean(switching || (store.runtime.run_enabled && !running && active && profileUrl(active)));
  const fingerprint = JSON.stringify([store.model.profiles.length, store.model.state.active_profile_id, active && profileName(active), running, waiting, switching]);
  if (fingerprint === ui.sidebarFingerprint) return;
  ui.sidebarFingerprint = fingerprint;
  $("nav-profile-count").textContent = String(store.model.profiles.length);
  $("sidebar-active-profile").textContent = active ? profileName(active) : "Профиль не выбран";
  $("sidebar-core-title").textContent = switching ? "Mihomo переключается" : running ? "Mihomo работает" : waiting ? "Mihomo запускается" : "Mihomo остановлен";
  $("sidebar-core-dot").className = running ? "running" : waiting ? "waiting" : "";
}

export function renderSubscriptions() {
  const profiles = store.model.profiles;
  $("subscriptions-subtitle").textContent = `${profiles.length} ${profiles.length === 1 ? "профиль" : profiles.length > 1 && profiles.length < 5 ? "профиля" : "профилей"}`;
  const fingerprint = JSON.stringify({
    active: store.model.state.active_profile_id,
    selecting: ui.selectingProfileId,
    runtime: [store.runtime.mihomo_running, store.runtime.run_enabled, store.runtime.source_present, store.runtime.final_present, store.runtime.error_b64],
    profiles
  });
  if (fingerprint === ui.subscriptionsFingerprint) return;
  ui.subscriptionsFingerprint = fingerprint;
  $("subscription-list").innerHTML = profiles.map((profile) => {
    const active = profile.id === store.model.state.active_profile_id;
    const health = profileHealth(profile);
    const switching = Boolean(ui.selectingProfileId);
    const busy = profileBusy(profile) || switching;
    const hasUrl = Boolean(profileUrl(profile));
    const runEnabled = Boolean(store.model.state.run_enabled);
    const response = [profile.refresh_http_status ? `HTTP ${profile.refresh_http_status}` : "", profile.refresh_bytes ? formatBytes(profile.refresh_bytes) : ""].filter(Boolean).join(" · ");
    const diagnostic = profile.refresh_state === "error" || profile.configuration_valid === "0" ? profileDiagnostic(profile) : "";
    const access = providerAccessState(profile);
    const accessEntries = access ? access.entries.map((entry) => `<span>${escapeHtml(entry)}</span>`).join("") : "";
    const hiddenAccessEntries = access ? Math.max(0, access.zeroCount - access.entries.length) : 0;
    const accessWarning = access ? `<aside class="subscription-provider-warning">${icon("alert")}<div><strong>${escapeHtml(access.label)}</strong><p>${escapeHtml(access.note)}</p>${accessEntries ? `<div class="subscription-provider-messages">${accessEntries}${hiddenAccessEntries ? `<span>…ещё ${hiddenAccessEntries}</span>` : ""}</div>` : ""}</div></aside>` : "";
    return `<article class="subscription-card${active ? " active" : ""}" data-profile-row="${escapeHtml(profile.id)}" role="button" tabindex="0" aria-pressed="${active ? "true" : "false"}" title="${active ? "Выбранная подписка" : "Выбрать эту подписку"}">
        <div class="subscription-main">
          <span class="subscription-icon"><svg><use href="#i-bookmark"></use></svg></span>
          <div class="subscription-details">
            <div class="subscription-title"><strong>${escapeHtml(profileName(profile))}</strong>${active ? "<mark>выбрана</mark>" : ""}</div>
            <p>${escapeHtml(profileUrl(profile) || "URL не задан")}</p>
            <div class="subscription-meta"><span>${icon("clock")}<time data-updated-at="${Number(profile.updated_at || 0)}">${formatUpdated(profile.updated_at)}</time></span><span>${icon("refresh")}авто: ${formatInterval(profile.effective_refresh_seconds || profile.refresh_seconds)}</span>${profile.local_override_enabled ? `<span>${icon("settings")}локальные параметры</span>` : ""}</div>
          </div>
          <div class="subscription-actions">
            <span class="subscription-runtime-controls" aria-label="Управление Mihomo">
              <button class="icon-button runtime-start" type="button" data-profile-action="start" data-profile-id="${escapeHtml(profile.id)}" title="${active ? (runEnabled ? "Mihomo уже запущен" : "Запустить Mihomo с этой подпиской") : "Сначала выберите подписку"}"${active && hasUrl && !runEnabled && !busy ? "" : " disabled"}>${icon("play")}</button>
              <button class="icon-button runtime-stop" type="button" data-profile-action="stop" data-profile-id="${escapeHtml(profile.id)}" title="${active ? (runEnabled ? "Остановить Mihomo" : "Mihomo уже остановлен") : "Сначала выберите подписку"}"${active && runEnabled && !switching ? "" : " disabled"}>${icon("stop")}</button>
            </span>
            <button class="icon-button" type="button" data-profile-action="edit" data-profile-id="${escapeHtml(profile.id)}" title="Настройки">${icon("settings")}</button>
            <button class="icon-button${busy ? " loading" : ""}" type="button" data-profile-action="refresh" data-profile-id="${escapeHtml(profile.id)}" title="${hasUrl ? (busy ? "Обновление выполняется" : "Обновить сейчас") : "Сначала укажите URL"}"${hasUrl && !busy ? "" : " disabled"}>${icon("refresh")}</button>
            <button class="icon-button" type="button" data-profile-action="source" data-profile-id="${escapeHtml(profile.id)}" title="Полученный YAML">${icon("file")}</button>
            <button class="icon-button danger" type="button" data-profile-action="delete" data-profile-id="${escapeHtml(profile.id)}" title="${active ? "Активную подписку удалить нельзя" : "Удалить"}"${active ? " disabled" : ""}>${icon("trash")}</button>
          </div>
        </div>
        <footer class="subscription-footer"><span class="subscription-health ${health.className}"><i></i>${health.label}</span><span class="subscription-response">${escapeHtml(response || "Нет ответа")}</span><code>${escapeHtml(profile.id)}</code></footer>
        ${accessWarning}
        ${diagnostic ? `<details class="subscription-diagnostic" data-profile-diagnostics><summary>Подробности последней ошибки</summary><pre>${escapeHtml(diagnostic)}</pre></details>` : ""}
      </article>`;
  }).join("");
  $("subscription-list").classList.toggle("hidden", profiles.length === 0);
  $("subscription-empty").classList.toggle("hidden", profiles.length !== 0);
}

// Переключение показываем сразу, не дожидаясь ответа: запрос идёт к CGI,
// который ещё и перезапускает ядро, и без этого карточка "залипает".
export async function selectProfile(profileId) {
  if (!profileId || profileId === store.model.state.active_profile_id) return;
  const previousProfileId = store.model.state.active_profile_id;
  ui.selectingProfileId = profileId;
  store.model.state.active_profile_id = profileId;
  ui.subscriptionsFingerprint = "";
  ui.sidebarFingerprint = "";
  renderSubscriptions();
  renderSidebar();
  try {
    await send({ action: "select", profile_id: profileId });
    ui.selectingProfileId = "";
    await load({ quiet: true });
    toast("Активная подписка изменена");
  } catch (error) {
    ui.selectingProfileId = "";
    store.model.state.active_profile_id = previousProfileId;
    ui.subscriptionsFingerprint = "";
    ui.sidebarFingerprint = "";
    renderSubscriptions();
    renderSidebar();
    throw error;
  }
}

export async function setRuntime(action, profileId) {
  if (!profileId || profileId !== store.model.state.active_profile_id) throw new Error("Сначала выберите подписку");
  if (!["start", "stop"].includes(action)) return;
  await send({ action });
  await load();
  schedulePoll(250);
  toast(action === "stop" ? "Остановка Mihomo запрошена" : "Запуск Mihomo запрошен");
}

export async function refreshProfile(profileId) {
  await requestJson("/cgi-bin/remna-refresh", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ profile_id: profileId })
  });
  await load({ quiet: true });
  schedulePoll(250);
  toast("Подписка поставлена на обновление");
}

export function askDelete(profileId) {
  const profile = profileById(profileId);
  if (!profile || profile.id === store.model.state.active_profile_id) return;
  ui.deleteProfileId = profileId;
  $("delete-message").textContent = `Профиль «${profileName(profile)}» и его сохранённые файлы будут удалены.`;
  $("delete-modal").classList.remove("hidden");
}

export function closeDelete() {
  ui.deleteProfileId = "";
  $("delete-modal").classList.add("hidden");
}

export async function confirmDelete() {
  if (!ui.deleteProfileId) return;
  await send({ action: "delete", profile_id: ui.deleteProfileId });
  closeDelete();
  await load();
  toast("Подписка удалена");
}

onRender(renderSidebar);
onRender(renderSubscriptions);
