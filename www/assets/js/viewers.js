// Просмотр YAML (полученного и рабочего) и журнала событий контейнера.
import { $ } from "./dom.js";
import { decode } from "./codec.js";
import { request } from "./api.js";
import { formatBytes } from "./format.js";
import { renderYamlViewer } from "./yaml.js";
import { onRender } from "./refresh.js";
import { store, ui, activeProfile, profileById, profileName } from "./store.js";

export async function openSourceYaml(profileId) {
  const profile = profileById(profileId);
  if (!profile) return;
  ui.sourceYamlProfileId = profileId;
  $("source-yaml-title").textContent = `Полученный YAML · ${profileName(profile)}`;
  const sourceState = [
    profile.refresh_http_status ? `HTTP ${profile.refresh_http_status}` : "",
    profile.refresh_bytes ? formatBytes(profile.refresh_bytes) : "",
    profile.refresh_state === "error" && profile.configuration_valid !== "0" ? "сохранён предыдущий ответ"
      : profile.configuration_valid === "0" ? "рабочая конфигурация отклонена"
        : profile.configuration_valid === "1" ? "проверка пройдена" : ""
  ].filter(Boolean).join(" · ");
  $("source-yaml-subtitle").textContent = sourceState || "Последний HTTP-ответ источника без локальных изменений";
  renderYamlViewer("source-yaml-viewer", "Загрузка...");
  $("source-yaml-modal").classList.remove("hidden");
  const result = await request(`/cgi-bin/remna-config?kind=source&profile_id=${encodeURIComponent(profileId)}`);
  if (ui.sourceYamlProfileId !== profileId) return;
  renderYamlViewer("source-yaml-viewer", result.text || "Файл ещё не создан.");
  $("source-yaml-viewer").scrollTop = 0;
}

export function closeSourceYaml() {
  ui.sourceYamlProfileId = "";
  $("source-yaml-modal").classList.add("hidden");
}

async function loadActiveRuntimeYaml() {
  const profileId = store.model.state.active_profile_id;
  if (!profileId || !store.runtime.final_present) return;
  const version = `${profileId}:${store.runtime.final_version || 0}:${store.runtime.final_mtime || 0}`;
  renderYamlViewer("active-runtime-yaml", "Загрузка...");
  const result = await request(`/cgi-bin/remna-config?kind=final&profile_id=${encodeURIComponent(profileId)}`);
  if (profileId !== store.model.state.active_profile_id) return;
  ui.activeRuntimeYamlVersion = version;
  renderYamlViewer("active-runtime-yaml", result.text || "Файл ещё не создан.");
  $("active-runtime-yaml").scrollTop = 0;
}

export async function openRuntimeYaml() {
  const profile = activeProfile();
  if (!profile || !store.runtime.final_present) throw new Error("Рабочий YAML ещё не создан");
  $("runtime-yaml-title").textContent = `Рабочий YAML · ${profileName(profile)}`;
  $("runtime-yaml-subtitle").textContent = "Итоговая конфигурация активной подписки со всеми переопределениями";
  $("runtime-yaml-modal").classList.remove("hidden");
  await loadActiveRuntimeYaml();
}

export function closeRuntimeYaml() {
  $("runtime-yaml-modal").classList.add("hidden");
}

export function openRuntimeEvents() {
  const viewer = $("runtime-events");
  $("runtime-events-modal").classList.remove("hidden");
  viewer.scrollTop = viewer.scrollHeight;
}

export function closeRuntimeEvents() {
  $("runtime-events-modal").classList.add("hidden");
}

export function renderActiveRuntime() {
  const active = activeProfile();
  const fingerprint = JSON.stringify({
    active: store.model.state.active_profile_id,
    runtime: [store.runtime.final_present, store.runtime.final_mtime, store.runtime.final_version, store.runtime.event_log_b64]
  });
  if (fingerprint === ui.activeRuntimeFingerprint) return;
  ui.activeRuntimeFingerprint = fingerprint;
  const yamlButton = $("open-active-runtime-yaml");
  const canOpenYaml = Boolean(active && store.runtime.final_present);
  yamlButton.disabled = !canOpenYaml;
  yamlButton.title = canOpenYaml ? "Рабочий YAML активной подписки" : "Рабочий YAML ещё не создан";

  const events = decode(store.runtime.event_log_b64);
  const eventsViewer = $("runtime-events");
  // Дописываем журнал, не сбивая прокрутку, если пользователь ушёл вверх.
  const wasAtBottom = eventsViewer.scrollHeight - eventsViewer.scrollTop - eventsViewer.clientHeight < 24;
  if (eventsViewer.value !== (events || "Событий пока нет.")) eventsViewer.value = events || "Событий пока нет.";
  if (wasAtBottom) eventsViewer.scrollTop = eventsViewer.scrollHeight;
  $("runtime-events-state").textContent = events ? "Последние 200 событий" : "Событий пока нет";

  if (!active || !store.runtime.final_present) {
    renderYamlViewer("active-runtime-yaml", "Файл ещё не создан.");
    ui.activeRuntimeYamlVersion = "";
    if (!$("runtime-yaml-modal").classList.contains("hidden")) closeRuntimeYaml();
    return;
  }
  const version = `${store.model.state.active_profile_id}:${store.runtime.final_version || 0}:${store.runtime.final_mtime || 0}`;
  if (!$("runtime-yaml-modal").classList.contains("hidden") && ui.activeRuntimeYamlVersion !== version) {
    loadActiveRuntimeYaml().catch(() => {});
  }
}

onRender(renderActiveRuntime);
