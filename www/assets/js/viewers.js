// Просмотр YAML (полученного и рабочего) и журналов контейнера.
import { $, all, escapeHtml } from "./dom.js";
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

// ── Рабочий YAML ─────────────────────────────────────────────
let runtimeYamlText = "";
let runtimeView = "yaml";

// Верхнеуровневые секции YAML: ключ -> текст блока. Список в нулевой колонке
// ("- name: a") ключом не считается — так же, как в entrypoint.sh.
function topLevelSections(text) {
  const sections = new Map();
  let key = "";
  let lines = [];
  const flush = () => { if (key) sections.set(key, lines.join("\n").replace(/\s+$/, "")); };
  String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    const match = /^([^\s#-][^:]*):/.exec(line);
    if (match) {
      flush();
      key = match[1];
      lines = [line];
    } else if (key) {
      lines.push(line);
    }
  });
  flush();
  return sections;
}

// Что сделали с подпиской оверрайды и сам контейнер: по секциям, а не
// построчно — рабочий YAML бывает на мегабайты, а смысл виден и так.
async function renderRuntimeChanges() {
  const target = $("runtime-changes");
  const profileId = store.model.state.active_profile_id;
  target.innerHTML = "<p class=\"section-diff-empty\">Загрузка...</p>";
  const source = await request(`/cgi-bin/remna-config?kind=source&profile_id=${encodeURIComponent(profileId)}`);
  const before = topLevelSections(source.text);
  const after = topLevelSections(runtimeYamlText);
  const rows = [];
  after.forEach((text, key) => {
    if (!before.has(key)) rows.push(["added", key, "добавлена"]);
    else if (before.get(key) !== text) rows.push(["changed", key, "изменена"]);
  });
  before.forEach((_, key) => { if (!after.has(key)) rows.push(["removed", key, "удалена"]); });
  const unchanged = [...after.keys()].filter((key) => before.has(key) && before.get(key) === after.get(key)).length;
  target.innerHTML = rows.length
    ? `<ul class="section-diff">${rows.map(([kind, key, label]) => `<li class="${kind}"><code>${escapeHtml(key)}</code><span>${label}</span></li>`).join("")}</ul><p class="section-diff-empty">Без изменений: ${unchanged} ${unchanged === 1 ? "секция" : "секций"}. Сравнение с полученным YAML, секции целиком.</p>`
    : "<p class=\"section-diff-empty\">Рабочий YAML совпадает с полученным.</p>";
}

export async function setRuntimeView(view) {
  runtimeView = view;
  all("[data-runtime-view]").forEach((button) => button.classList.toggle("active", button.dataset.runtimeView === view));
  $("active-runtime-yaml").classList.toggle("hidden", view !== "yaml");
  $("runtime-changes").classList.toggle("hidden", view !== "changes");
  if (view === "changes") await renderRuntimeChanges();
}

export function toggleRuntimeWrap() {
  const wrapped = $("active-runtime-yaml").classList.toggle("wrap");
  $("runtime-yaml-wrap").setAttribute("aria-pressed", String(wrapped));
}

export function downloadRuntimeYaml() {
  if (!runtimeYamlText) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([runtimeYamlText], { type: "text/yaml" }));
  link.download = `${store.model.state.active_profile_id || "config"}.yaml`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function loadActiveRuntimeYaml() {
  const profileId = store.model.state.active_profile_id;
  if (!profileId || !store.runtime.final_present) return;
  const version = `${profileId}:${store.runtime.final_version || 0}:${store.runtime.final_mtime || 0}`;
  renderYamlViewer("active-runtime-yaml", "Загрузка...");
  const result = await request(`/cgi-bin/remna-config?kind=final&profile_id=${encodeURIComponent(profileId)}`);
  if (profileId !== store.model.state.active_profile_id) return;
  ui.activeRuntimeYamlVersion = version;
  runtimeYamlText = result.text || "";
  renderYamlViewer("active-runtime-yaml", runtimeYamlText || "Файл ещё не создан.");
  $("active-runtime-yaml").scrollTop = 0;
  if (runtimeView === "changes") await renderRuntimeChanges();
}

export async function openRuntimeYaml() {
  const profile = activeProfile();
  if (!profile || !store.runtime.final_present) throw new Error("Рабочий YAML ещё не создан");
  $("runtime-yaml-title").textContent = `Рабочий YAML · ${profileName(profile)}`;
  $("runtime-yaml-subtitle").textContent = "Итоговая конфигурация активной подписки со всеми переопределениями";
  $("runtime-yaml-modal").classList.remove("hidden");
  await setRuntimeView("yaml");
  await loadActiveRuntimeYaml();
}

export function closeRuntimeYaml() {
  $("runtime-yaml-modal").classList.add("hidden");
}

// ── Журналы ──────────────────────────────────────────────────
// Журналы грузятся отдельным запросом и только пока окно открыто: раньше
// 200 строк событий ехали в каждом опросе состояния.
let logKind = "events";
let logTimer = 0;
let logRequest = 0;

const LOG_EMPTY = {
  events: "Событий пока нет.",
  core: "Ядро ещё не запускалось в этом контейнере."
};

async function refreshLog() {
  window.clearTimeout(logTimer);
  if ($("runtime-events-modal").classList.contains("hidden")) return;
  const token = ++logRequest;
  const kind = logKind;
  try {
    const result = await request(`/cgi-bin/remna-config?kind=${kind}`);
    if (token !== logRequest) return;
    const viewer = $("runtime-events");
    const wasAtBottom = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 24;
    const text = result.text.replace(/\s+$/, "") || LOG_EMPTY[kind];
    if (viewer.value !== text) viewer.value = text;
    if (wasAtBottom) viewer.scrollTop = viewer.scrollHeight;
    $("runtime-events-state").textContent = kind === "events" ? "Последние 300 событий · обновляется" : "Вывод Mihomo · последние 400 строк · обновляется";
  } catch (error) {
    if (token === logRequest) $("runtime-events-state").textContent = `Не удалось загрузить: ${error.message}`;
  }
  if (!document.hidden) logTimer = window.setTimeout(refreshLog, 3000);
}

export function setLogKind(kind) {
  logKind = kind;
  all("[data-log-tab]").forEach((button) => button.classList.toggle("active", button.dataset.logTab === kind));
  $("runtime-events").value = "Загрузка...";
  $("runtime-events").scrollTop = 0;
  refreshLog().then(() => { $("runtime-events").scrollTop = $("runtime-events").scrollHeight; });
}

export function openRuntimeEvents() {
  $("runtime-events-modal").classList.remove("hidden");
  setLogKind(logKind);
}

export function closeRuntimeEvents() {
  window.clearTimeout(logTimer);
  logRequest += 1;
  $("runtime-events-modal").classList.add("hidden");
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("runtime-events-modal").classList.contains("hidden")) refreshLog();
});

export function renderActiveRuntime() {
  const active = activeProfile();
  const fingerprint = JSON.stringify({
    active: store.model.state.active_profile_id,
    runtime: [store.runtime.final_present, store.runtime.final_mtime, store.runtime.final_version]
  });
  if (fingerprint === ui.activeRuntimeFingerprint) return;
  ui.activeRuntimeFingerprint = fingerprint;
  const yamlButton = $("open-active-runtime-yaml");
  const canOpenYaml = Boolean(active && store.runtime.final_present);
  yamlButton.disabled = !canOpenYaml;
  yamlButton.title = canOpenYaml ? "Рабочий YAML активной подписки" : "Рабочий YAML ещё не создан";

  if (!active || !store.runtime.final_present) {
    renderYamlViewer("active-runtime-yaml", "Файл ещё не создан.");
    runtimeYamlText = "";
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
