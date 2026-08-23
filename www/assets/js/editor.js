// Модалка настроек одной подписки.
import { $, all, toast, showPage } from "./dom.js";
import { decode } from "./codec.js";
import { send, requestJson } from "./api.js";
import { formatBytes, formatInterval, parseSubscriptionUserinfo, safeHttpUrl } from "./format.js";
import { renderHeaders, serializedHeaders } from "./headers.js";
import { load, schedulePoll } from "./refresh.js";
import { ui, profileById, profileName, profileLocalName } from "./store.js";

// Блок с тем, что прислал сам провайдер подписки в заголовках ответа.
function renderProviderMetadata(profile) {
  const title = decode(profile.provider_title_b64);
  const interval = Number(profile.provider_refresh_seconds || 0);
  const userinfoRaw = decode(profile.subscription_userinfo_b64);
  const userinfo = parseSubscriptionUserinfo(userinfoRaw);
  const announce = decode(profile.announce_b64);
  const pageUrl = safeHttpUrl(decode(profile.profile_web_page_url_b64));
  const supportUrl = safeHttpUrl(decode(profile.support_url_b64));
  const refill = decode(profile.subscription_refill_date_b64);
  const hasMetadata = Boolean(title || interval || userinfoRaw || announce || pageUrl || supportUrl || refill);
  $("profile-provider-meta").classList.toggle("hidden", !hasMetadata);
  if (!hasMetadata) return;
  $("profile-provider-title").textContent = title || "Данные получены";
  $("profile-provider-interval").textContent = interval ? formatInterval(interval) : "Не задан";
  const upload = Number(userinfo.upload || 0);
  const download = Number(userinfo.download || 0);
  const total = Number(userinfo.total || 0);
  $("profile-provider-traffic").textContent = userinfoRaw
    ? `${formatBytes(upload + download)}${total > 0 ? ` / ${formatBytes(total)}` : ""}`
    : "Не задан";
  const expire = Number(userinfo.expire || 0);
  $("profile-provider-expire").textContent = expire > 0
    ? new Date(expire * 1000).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
    : (refill || "Не задано");
  $("profile-provider-announce").textContent = announce;
  $("profile-provider-announce").classList.toggle("hidden", !announce);
  [["profile-provider-page", pageUrl], ["profile-provider-support", supportUrl]].forEach(([id, url]) => {
    $(id).href = url || "#";
    $(id).classList.toggle("hidden", !url);
  });
  $("profile-provider-page").parentElement.classList.toggle("hidden", !pageUrl && !supportUrl);
}

export function updateLocalOverrideState(openOnEnable = false) {
  const enabled = $("profile-local-override-enabled").checked;
  const details = $("profile-local-details");
  $("profile-local-state").textContent = enabled ? "Включены" : "Выключены";
  $("profile-local-body").classList.toggle("disabled", !enabled);
  details.classList.toggle("disabled", !enabled);
  if (!enabled) details.open = false;
  all("input, select, textarea, button", $("profile-local-body")).forEach((control) => { control.disabled = !enabled; });
  if (enabled && openOnEnable) details.open = true;
}


// Публичный ключ показывается только сразу после генерации: он не хранится,
// потому что нужен один раз — вставить в правило ответов панели.
function setAgeKey(value) {
  $("profile-age-key").value = value || "";
  $("profile-age-key").type = "password";
  $("profile-age-public").value = "";
  $("profile-age-public-result").classList.add("hidden");
  $("profile-age-method").value = String(value || "").startsWith("AGE-SECRET-KEY-PQ-") ? "age1pq1" : "age1";
}

export async function generateAgeKeypair() {
  const button = $("profile-age-generate");
  button.disabled = true;
  try {
    const payload = await requestJson("/cgi-bin/remna-age-keygen", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ method: $("profile-age-method").value })
    });
    const secret = decode(payload.secret_b64);
    const publicKey = decode(payload.public_b64);
    if (!secret || !publicKey) throw new Error("Ядро не вернуло пару ключей");
    $("profile-age-key").value = secret;
    $("profile-age-public").value = publicKey;
    $("profile-age-public-result").classList.remove("hidden");
    toast("Пара ключей создана · публичный вставьте в правило панели");
  } finally {
    button.disabled = false;
  }
}

export function createProfile() {
  showPage("subscriptions");
  ui.editorRequestToken += 1;
  ui.editorProfileId = "";
  document.querySelector(".profile-modal").classList.remove("loading");
  $("profile-id").value = "";
  $("editor-title").textContent = "Новая подписка";
  $("profile-name").value = "Новая подписка";
  $("profile-url").value = "";
  $("profile-refresh").value = 60;
  $("profile-timeout").value = 30;
  $("profile-use-provider-title").checked = true;
  $("profile-use-provider-interval").checked = true;
  $("profile-insecure").checked = false;
  $("profile-provider-meta").classList.add("hidden");
  setAgeKey("");
  $("profile-local-override-enabled").checked = false;
  renderHeaders("profile-header-rows", "");
  $("profile-local-find-process").value = "inherit";
  $("profile-local-log-level").value = "inherit";
  $("profile-local-ipv6").value = "inherit";
  $("profile-local-store-selected").value = "inherit";
  $("profile-local-store-fake-ip").value = "inherit";
  $("profile-local-sniffer").value = "inherit";
  $("profile-local-mode").value = "inherit";
  $("profile-override").value = "";
  $("profile-local-details").open = false;
  updateLocalOverrideState();
  $("profile-modal-layer").classList.remove("hidden");
  $("profile-name").focus();
}

function populateEditor(profile) {
  $("profile-id").value = profile.id;
  $("editor-title").textContent = profileLocalName(profile);
  $("profile-name").value = profileLocalName(profile);
  $("profile-url").value = decode(profile.url_b64);
  $("profile-refresh").value = Math.max(1, Math.round(Number(profile.refresh_seconds || 3600) / 60));
  $("profile-timeout").value = profile.timeout_seconds || 30;
  $("profile-use-provider-title").checked = Boolean(profile.use_provider_title);
  $("profile-use-provider-interval").checked = Boolean(profile.use_provider_interval);
  $("profile-insecure").checked = Boolean(profile.insecure_tls);
  renderProviderMetadata(profile);
  setAgeKey(decode(profile.age_key_b64));
  $("profile-local-override-enabled").checked = Boolean(profile.local_override_enabled);
  renderHeaders("profile-header-rows", decode(profile.headers_b64));
  $("profile-local-find-process").value = profile.local_find_process_mode || "inherit";
  $("profile-local-log-level").value = profile.local_log_level || "inherit";
  $("profile-local-ipv6").value = String(profile.local_ipv6 ?? "inherit");
  $("profile-local-store-selected").value = String(profile.local_store_selected ?? "inherit");
  $("profile-local-store-fake-ip").value = String(profile.local_store_fake_ip ?? "inherit");
  $("profile-local-sniffer").value = profile.local_sniffer_mode || "inherit";
  $("profile-local-mode").value = profile.local_mode || "inherit";
  $("profile-override").value = decode(profile.local_override_b64);
  $("profile-local-details").open = false;
  updateLocalOverrideState();
}

// Токен запроса отсекает ответ по профилю, который пользователь уже закрыл
// или сменил, пока запрос был в пути.
export async function openEditor(profileId) {
  const requestToken = ++ui.editorRequestToken;
  const listedProfile = profileById(profileId);
  ui.editorProfileId = profileId;
  $("editor-title").textContent = listedProfile ? profileName(listedProfile) : "Настройки подписки";
  $("profile-modal-layer").classList.remove("hidden");
  document.querySelector(".profile-modal").classList.add("loading");
  try {
    const details = await requestJson(`/cgi-bin/remna-profile?profile_id=${encodeURIComponent(profileId)}&compact=1`);
    if (requestToken !== ui.editorRequestToken || ui.editorProfileId !== profileId) return;
    populateEditor(details.profile);
    document.querySelector(".profile-modal").classList.remove("loading");
    $("profile-name").focus();
  } catch (error) {
    if (requestToken === ui.editorRequestToken) closeEditor();
    throw error;
  }
}

export function closeEditor() {
  ui.editorRequestToken += 1;
  ui.editorProfileId = "";
  document.querySelector(".profile-modal").classList.remove("loading");
  $("profile-modal-layer").classList.add("hidden");
}

export async function saveProfile(event) {
  event.preventDefault();
  const fields = {
    profile_id: $("profile-id").value,
    name: $("profile-name").value.trim(),
    url: $("profile-url").value.trim(),
    headers: serializedHeaders("profile-header-rows"),
    local_override_enabled: $("profile-local-override-enabled").checked ? "1" : "0",
    local_override: $("profile-override").value,
    local_find_process_mode: $("profile-local-find-process").value,
    local_log_level: $("profile-local-log-level").value,
    local_ipv6: $("profile-local-ipv6").value,
    local_store_selected: $("profile-local-store-selected").value,
    local_store_fake_ip: $("profile-local-store-fake-ip").value,
    local_sniffer_mode: $("profile-local-sniffer").value,
    local_mode: $("profile-local-mode").value,
    use_provider_title: $("profile-use-provider-title").checked ? "1" : "0",
    use_provider_interval: $("profile-use-provider-interval").checked ? "1" : "0",
    refresh_minutes: $("profile-refresh").value,
    timeout_seconds: $("profile-timeout").value,
    insecure_tls: $("profile-insecure").checked ? "1" : "0",
    age_key: $("profile-age-key").value.trim()
  };
  let created = "";
  if (!fields.profile_id) {
    const result = await send({ action: "create", name: fields.name });
    created = result.created;
    fields.profile_id = created;
  }
  let saveResult;
  try {
    saveResult = await send(fields);
  } catch (error) {
    // Профиль создаётся отдельным запросом, поэтому неудачное сохранение
    // не должно оставлять пустую заготовку в списке.
    if (created) await send({ action: "delete", profile_id: created }).catch(() => {});
    throw error;
  }
  closeEditor();
  await load();
  schedulePoll(250);
  toast(saveResult && saveResult.queued_action === "fetch"
    ? "Подписка сохранена · загрузка началась"
    : saveResult && saveResult.queued_action === "rebuild"
      ? "Подписка сохранена · конфигурация проверяется"
      : "Подписка сохранена");
}
