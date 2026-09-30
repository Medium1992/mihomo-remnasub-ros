// Список подписок и боковая панель: карточка профиля, его состояние и
// действия над ним.
import { $, icon, escapeHtml, toast, confirmDialog } from "./dom.js";
import { decode } from "./codec.js";
import { send, requestJson } from "./api.js";
import { formatBytes, formatInterval, formatUpdated } from "./format.js";
import { load, schedulePoll, onRender } from "./refresh.js";
import {
  store, ui, activeProfile, profileById, profileName, profileUrl,
  profileBusy, refreshStageLabel, profileDiagnostic, providerAccessState, subscriptionUsage
} from "./store.js";

function coreCrashLabel() {
  const runtime = store.runtime;
  if (runtime.core_state !== "crashed" || !runtime.run_enabled) return "";
  return runtime.core_retry_in ? `Mihomo падает · повтор через ${runtime.core_retry_in} с` : "Mihomo падает";
}

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
  if (active && coreCrashLabel() && !store.runtime.mihomo_process_running) return { className: "error", label: coreCrashLabel() };
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
  const crashing = Boolean(!switching && !running && coreCrashLabel());
  const waiting = Boolean(switching || (store.runtime.run_enabled && !running && active && profileUrl(active)));
  const fingerprint = JSON.stringify([store.model.profiles.length, store.model.state.active_profile_id, active && profileName(active), running, waiting, switching, crashing]);
  if (fingerprint === ui.sidebarFingerprint) return;
  ui.sidebarFingerprint = fingerprint;
  $("nav-profile-count").textContent = String(store.model.profiles.length);
  $("sidebar-active-profile").textContent = active ? profileName(active) : "Профиль не выбран";
  $("sidebar-core-title").textContent = switching ? "Mihomo переключается"
    : running ? "Mihomo работает"
      : crashing ? "Mihomo падает"
        : waiting ? "Mihomo запускается" : "Mihomo остановлен";
  $("sidebar-core-dot").className = running ? "running" : crashing ? "error" : waiting ? "waiting" : "";
}

function usageMarkup(profile) {
  const usage = subscriptionUsage(profile);
  if (!usage) return "";
  const parts = [];
  if (usage.used || usage.total) {
    parts.push(`<span class="usage-traffic ${usage.level}">${icon("layers")}${formatBytes(usage.used)}${usage.total > 0 ? ` / ${formatBytes(usage.total)}` : ""}${usage.total > 0 ? `<progress max="1000" value="${Math.min(1000, Math.round(usage.ratio * 1000))}"></progress>` : ""}</span>`);
  }
  if (usage.expire > 0) {
    const date = new Date(usage.expire * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    const left = usage.daysLeft < 0 ? "истекла" : usage.daysLeft === 0 ? "сегодня" : `${usage.daysLeft} дн.`;
    parts.push(`<span class="usage-expire ${usage.level}">${icon("clock")}до ${escapeHtml(date)} · ${left}</span>`);
  }
  return parts.join("");
}

export function renderSubscriptions() {
  const profiles = store.model.profiles;
  $("subscriptions-subtitle").textContent = `${profiles.length} ${profiles.length === 1 ? "профиль" : profiles.length > 1 && profiles.length < 5 ? "профиля" : "профилей"}`;
  const fingerprint = JSON.stringify({
    active: store.model.state.active_profile_id,
    selecting: ui.selectingProfileId,
    runtime: [store.runtime.mihomo_running, store.runtime.mihomo_process_running, store.runtime.run_enabled, store.runtime.source_present, store.runtime.final_present, store.runtime.error_b64, store.runtime.core_state, store.runtime.core_retry_in],
    profiles
  });
  if (fingerprint === ui.subscriptionsFingerprint) return;
  ui.subscriptionsFingerprint = fingerprint;
  const switching = Boolean(ui.selectingProfileId);
  const runEnabled = Boolean(store.model.state.run_enabled);
  $("subscription-list").innerHTML = profiles.map((profile) => {
    const id = escapeHtml(profile.id);
    const active = profile.id === store.model.state.active_profile_id;
    const health = profileHealth(profile);
    const busy = profileBusy(profile) || switching;
    const hasUrl = Boolean(profileUrl(profile));
    const response = [profile.refresh_http_status ? `HTTP ${profile.refresh_http_status}` : "", profile.refresh_bytes ? formatBytes(profile.refresh_bytes) : ""].filter(Boolean).join(" · ");
    const diagnostic = profile.refresh_state === "error" || profile.configuration_valid === "0" ? profileDiagnostic(profile) : "";
    const access = providerAccessState(profile);
    const accessEntries = access ? access.entries.map((entry) => `<span>${escapeHtml(entry)}</span>`).join("") : "";
    const hiddenAccessEntries = access ? Math.max(0, access.zeroCount - access.entries.length) : 0;
    const accessWarning = access ? `<aside class="subscription-provider-warning">${icon("alert")}<div><strong>${escapeHtml(access.label)}</strong><p>${escapeHtml(access.note)}</p>${accessEntries ? `<div class="subscription-provider-messages">${accessEntries}${hiddenAccessEntries ? `<span>…ещё ${hiddenAccessEntries}</span>` : ""}</div>` : ""}</div></aside>` : "";
    // ▶ на неактивной карточке выбирает её и сразу запускает ядро; если ядро
    // уже работает, это переключение, и оно спрашивает подтверждение.
    const canStart = hasUrl && !busy && (!active || !runEnabled);
    const startTitle = !hasUrl ? "Сначала укажите URL"
      : active ? (runEnabled ? "Mihomo уже запущен" : "Запустить Mihomo с этой подпиской")
        : runEnabled ? "Переключить Mihomo на эту подписку" : "Выбрать и запустить";
    const selectButton = active ? "" : `<button class="icon-button" type="button" data-profile-action="select" data-profile-id="${id}" title="Сделать активной"${switching ? " disabled" : ""}>${icon("check")}</button>`;
    return `<article class="subscription-card${active ? " active" : ""}" data-profile-row="${id}" title="${active ? "Выбранная подписка" : "Выбрать эту подписку"}">
        <div class="subscription-main">
          <span class="subscription-icon"><svg><use href="#i-bookmark"></use></svg></span>
          <div class="subscription-details">
            <div class="subscription-title"><strong>${escapeHtml(profileName(profile))}</strong>${active ? "<mark>выбрана</mark>" : ""}</div>
            <p>${escapeHtml(profileUrl(profile) || "URL не задан")}</p>
            <div class="subscription-meta"><span>${icon("clock")}<time data-updated-at="${Number(profile.updated_at || 0)}">${formatUpdated(profile.updated_at)}</time></span><span>${icon("refresh")}авто: ${formatInterval(profile.effective_refresh_seconds || profile.refresh_seconds)}</span>${usageMarkup(profile)}${profile.local_override_enabled ? `<span>${icon("settings")}локальные параметры</span>` : ""}</div>
          </div>
          <div class="subscription-actions">
            <span class="subscription-runtime-controls" aria-label="Управление Mihomo">
              <button class="icon-button runtime-start" type="button" data-profile-action="start" data-profile-id="${id}" title="${startTitle}"${canStart ? "" : " disabled"}>${icon("play")}</button>
              <button class="icon-button runtime-stop" type="button" data-profile-action="stop" data-profile-id="${id}" title="${active ? (runEnabled ? "Остановить Mihomo" : "Mihomo уже остановлен") : "Работает другая подписка"}"${active && runEnabled && !switching ? "" : " disabled"}>${icon("stop")}</button>
            </span>
            ${selectButton}
            <button class="icon-button" type="button" data-profile-action="edit" data-profile-id="${id}" title="Настройки">${icon("settings")}</button>
            <button class="icon-button${busy ? " loading" : ""}" type="button" data-profile-action="refresh" data-profile-id="${id}" title="${hasUrl ? (busy ? "Обновление выполняется" : "Обновить сейчас") : "Сначала укажите URL"}"${hasUrl && !busy ? "" : " disabled"}>${icon("refresh")}</button>
            <button class="icon-button" type="button" data-profile-action="source" data-profile-id="${id}" title="Полученный YAML">${icon("file")}</button>
            <button class="icon-button" type="button" data-profile-action="duplicate" data-profile-id="${id}" title="Клонировать">${icon("copy")}</button>
            <button class="icon-button danger" type="button" data-profile-action="delete" data-profile-id="${id}" title="${active ? "Активную подписку удалить нельзя" : busy ? "Дождитесь окончания обновления" : "Удалить"}"${active || busy ? " disabled" : ""}>${icon("trash")}</button>
          </div>
        </div>
        <footer class="subscription-footer"><span class="subscription-health ${health.className}"><i></i>${escapeHtml(health.label)}</span><span class="subscription-response">${escapeHtml(response || "Нет ответа")}</span><code>${id}</code></footer>
        ${accessWarning}
        ${diagnostic ? `<details class="subscription-diagnostic" data-profile-diagnostics><summary>Подробности последней ошибки</summary><pre>${escapeHtml(diagnostic)}</pre></details>` : ""}
      </article>`;
  }).join("");
  $("subscription-list").classList.toggle("hidden", profiles.length === 0);
  $("subscription-empty").classList.toggle("hidden", profiles.length !== 0);
}

// Смена активной подписки на работающем ядре перезапускает его и рвёт все
// соединения в сети — случайный клик по карточке не должен так делать.
async function confirmSwitch(profileId) {
  if (!store.model.state.run_enabled || profileId === store.model.state.active_profile_id) return true;
  const profile = profileById(profileId);
  return confirmDialog({
    title: "Переключить Mihomo?",
    message: `Ядро перезапустится с подпиской «${profileName(profile)}». Текущие соединения в сети оборвутся.`,
    accept: "Переключить"
  });
}

// Переключение показываем сразу, не дожидаясь ответа: запрос идёт к CGI,
// который ещё и перезапускает ядро, и без этого карточка "залипает".
async function switchProfile(profileId, fields, message) {
  const previousProfileId = store.model.state.active_profile_id;
  ui.selectingProfileId = profileId;
  store.model.state.active_profile_id = profileId;
  ui.subscriptionsFingerprint = "";
  ui.sidebarFingerprint = "";
  renderSubscriptions();
  renderSidebar();
  try {
    await send(fields);
    ui.selectingProfileId = "";
    await load({ quiet: true });
    schedulePoll(250);
    toast(message);
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

export async function selectProfile(profileId) {
  if (!profileId || profileId === store.model.state.active_profile_id || ui.selectingProfileId) return;
  if (!(await confirmSwitch(profileId))) return;
  await switchProfile(profileId, { action: "select", profile_id: profileId }, "Активная подписка изменена");
}

export async function setRuntime(action, profileId) {
  if (!["start", "stop"].includes(action) || !profileId) return;
  if (action === "start" && profileId !== store.model.state.active_profile_id) {
    if (!(await confirmSwitch(profileId))) return;
    await switchProfile(profileId, { action: "start", profile_id: profileId }, "Подписка выбрана · запуск Mihomo запрошен");
    return;
  }
  await send({ action, profile_id: profileId });
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

export async function duplicateProfile(profileId) {
  await send({ action: "duplicate", profile_id: profileId });
  await load({ quiet: true });
  schedulePoll(250);
  toast("Копия создана · загружается свой YAML");
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
