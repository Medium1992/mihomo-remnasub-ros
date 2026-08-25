// Страница настроек контейнера и переход в панель самого Mihomo.
import { $, all, toast } from "./dom.js";
import { decode } from "./codec.js";
import { send, requestJson } from "./api.js";
import { renderHeaders, serializedHeaders } from "./headers.js";
import { load, schedulePoll, onRender } from "./refresh.js";
import { store, ui } from "./store.js";
import { THEMES, ACCENT_PRESETS, applyTheme, isTheme, isAccent } from "./theme.js";
import { OVERRIDE_PRESETS, overrideProblem, insertPreset } from "./presets.js";

export const externalUIPresets = {
  "zashboard": "https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip",
  "zashboard-cdn": "https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip",
  "metacubexd": "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
  "yacd-meta": "https://github.com/MetaCubeX/Yacd-meta/archive/refs/heads/gh-pages.zip"
};

export const networkTimeoutDefaults = {
  "network-ct-established": 86400,
  "network-ct-syn-sent": 5,
  "network-ct-syn-recv": 5,
  "network-ct-fin-wait": 10,
  "network-ct-close-wait": 10,
  "network-ct-last-ack": 10,
  "network-ct-time-wait": 10,
  "network-ct-close": 10,
  "network-ct-unacknowledged": 300,
  "network-ct-udp-stream": 180
};


// Выбор применяется к странице сразу (превью), а уезжает в state.conf только
// по кнопке "Сохранить" вместе с остальными настройками.
let pendingTheme = "auto";
let pendingAccent = "";

export function currentTheme() { return pendingTheme; }
export function currentAccent() { return pendingAccent; }

// Превью рисуется теми же токенами, что и сама тема: временный элемент с
// нужным data-theme отдаёт свои вычисленные значения.
function themeSwatch(themeId) {
  const probe = document.createElement("div");
  probe.dataset.theme = themeId === "auto"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : themeId;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const pick = (name) => cs.getPropertyValue(name).trim();
  const swatch = {
    sidebar: pick("--base-100"),
    canvas: pick("--base-200"),
    accent: isAccent(pendingAccent) ? pendingAccent : `rgb(${pick("--primary-rgb")})`,
    text: pick("--muted")
  };
  probe.remove();
  return swatch;
}

// Разметка строится узлами, а цвета выставляются через CSSOM: CSP этого
// проекта содержит style-src 'self' без 'unsafe-inline', поэтому атрибут
// style= в innerHTML браузер молча игнорирует.
function buildThemeCard(theme) {
  const swatch = themeSwatch(theme.id);
  const card = document.createElement("button");
  card.className = "theme-card";
  card.type = "button";
  card.setAttribute("role", "radio");
  card.dataset.themeOption = theme.id;
  card.setAttribute("aria-checked", String(theme.id === pendingTheme));

  const preview = document.createElement("span");
  preview.className = "theme-preview";
  preview.style.backgroundColor = swatch.canvas;

  const rail = document.createElement("i");
  rail.style.backgroundColor = swatch.sidebar;

  const lines = document.createElement("span");
  const accentBar = document.createElement("em");
  accentBar.style.backgroundColor = swatch.accent;
  accentBar.style.width = "70%";
  const textBar = document.createElement("em");
  textBar.style.backgroundColor = swatch.text;
  textBar.style.width = "45%";
  lines.append(accentBar, textBar);
  preview.append(rail, lines);

  const label = document.createElement("strong");
  label.textContent = theme.label;
  card.append(preview, label);
  return card;
}

function buildAccentSwatch(color) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.accentPreset = color;
  button.title = color;
  button.setAttribute("aria-label", `Акцент ${color}`);
  button.setAttribute("aria-pressed", String(color.toLowerCase() === pendingAccent.toLowerCase()));
  button.style.backgroundColor = color;
  return button;
}

function renderThemeGrid() {
  const grid = $("theme-grid");
  grid.replaceChildren(...THEMES.map(buildThemeCard));
  $("accent-presets").replaceChildren(...ACCENT_PRESETS.map(buildAccentSwatch));
  $("accent-color").value = isAccent(pendingAccent) ? pendingAccent : "#4773b7";
}

export function setTheme(themeId) {
  if (!isTheme(themeId)) return;
  pendingTheme = themeId;
  applyTheme(pendingTheme, pendingAccent);
  renderThemeGrid();
  ui.settingsDirty = true;
}

export function setAccent(color) {
  pendingAccent = isAccent(color) ? color : "";
  applyTheme(pendingTheme, pendingAccent);
  renderThemeGrid();
  ui.settingsDirty = true;
}


// Кнопки пресетов строятся узлами: CSP запрещает style-атрибуты из innerHTML,
// а заодно так проще навесить обработчик без делегирования по data-атрибуту.
export function renderPresetButtons(containerId, textareaId) {
  const container = $(containerId);
  const textarea = $(textareaId);
  container.replaceChildren(...OVERRIDE_PRESETS.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "override-preset";
    button.textContent = preset.label;
    button.title = preset.hint;
    button.addEventListener("click", () => insertPreset(textarea, preset.yaml));
    return button;
  }));
}

// Проверка идёт по мере ввода: те же правила потом применяет CGI, но узнать
// о них до нажатия «Сохранить» полезнее.
export function watchOverrideProblems(textareaId, noticeId) {
  const textarea = $(textareaId);
  const notice = $(noticeId);
  const check = () => {
    const problem = overrideProblem(textarea.value);
    notice.textContent = problem;
    notice.classList.toggle("hidden", !problem);
  };
  textarea.addEventListener("input", check);
  check();
}

export function updateSnifferOverrideState(openOnEnable = false) {
  const enabled = $("mihomo-sniffer-override").checked;
  const details = $("mihomo-sniffer-details");
  details.classList.toggle("disabled", !enabled);
  if (!enabled) details.open = false;
  if (enabled && openOnEnable) details.open = true;
  all("input, textarea", $("mihomo-sniffer-body")).forEach((control) => { control.disabled = !enabled; });
  $("mihomo-sniffer-summary").textContent = !enabled
    ? "Переопределение выключено"
    : $("mihomo-sniffer-enable").checked ? "Sniffer включён" : "Sniffer принудительно выключен";
}


// Параметры своего входа не прячем, а гасим: так видно, что порт и логин
// сохранены, даже когда сам вход выключен.
export function updateLocalInboundState() {
  [["local-socks-enabled", "local-socks-body"], ["local-http-enabled", "local-http-body"]].forEach(([toggleId, bodyId]) => {
    const enabled = $(toggleId).checked;
    $(bodyId).classList.toggle("disabled", !enabled);
    all("input, button", $(bodyId)).forEach((control) => { control.disabled = !enabled; });
  });
}

export function updateListenerPortFields() {
  const selected = document.querySelector('input[name="listener-mode"]:checked');
  const mode = selected ? selected.value : "auto";
  const nft = Boolean(store.runtime.nft_available);
  const usesRedir = mode === "redir-tun" || mode === "redir-tproxy" || mode === "auto";
  const usesTproxy = mode === "tproxy" || mode === "redir-tproxy" || (mode === "auto" && nft);
  all("[data-port-field]").forEach((label) => {
    const used = label.dataset.portField === "redir" ? usesRedir : usesTproxy;
    label.classList.toggle("unused", !used);
    label.querySelector("input").disabled = !used;
  });
}

export function updateExternalUIPreset() {
  const select = $("external-ui-preset");
  const input = $("external-ui-url");
  if (input.dataset.activePreset === "custom") input.dataset.customUrl = input.value.trim();
  const preset = select.value;
  const custom = preset === "custom";
  input.readOnly = !custom;
  input.required = custom;
  input.value = custom ? (input.dataset.customUrl || "") : externalUIPresets[preset];
  input.placeholder = custom ? "https://example.com/panel.zip" : "";
  input.dataset.activePreset = preset;
}

// Порт 9090 — это RESTful API ядра, и он слушает все интерфейсы, чтобы
// панель открывалась с другого компьютера. Пустой secret означает, что
// управлять ядром может любой в этой сети, поэтому предупреждаем явно.
function updateSecretWarning() {
  const empty = !decode(store.model.state.external_ui_secret_b64);
  $("external-ui-secret-warning").classList.toggle("hidden", !empty);
}

export function openMihomo() {
  const panel = new URL(location.href);
  // Контроллер на 9090 отвечает только по обычному HTTP, поэтому схему
  // задаём явно: панель может быть открыта через HTTPS-реверс-прокси.
  panel.protocol = "http:";
  panel.port = "9090";
  panel.pathname = "/ui/";
  panel.search = "";
  panel.hash = "";
  const preset = store.model.state.external_ui_preset || "zashboard-cdn";
  const secret = decode(store.model.state.external_ui_secret_b64);
  const connection = new URLSearchParams({
    hostname: location.hostname,
    port: "9090",
    http: "1",
    _r: String(store.runtime.external_ui_mtime || 0)
  });
  if (secret) connection.set("secret", secret);

  // Каждая панель читает параметры подключения по-своему: zashboard и
  // yacd-meta — из query string, metacubexd — из фрагмента. Секрет при этом
  // попадает в историю браузера, но иначе панель не подключится сама.
  if (preset === "zashboard" || preset === "zashboard-cdn") {
    connection.set("label", "RemnaSub RoS");
    panel.search = `?${connection.toString()}`;
  } else if (preset === "metacubexd") {
    panel.hash = `/?${connection.toString()}`;
  } else if (preset === "yacd-meta") {
    connection.delete("http");
    connection.set("hostname", `http://${location.hostname}`);
    connection.set("theme", "auto");
    connection.set("title", "RemnaSub RoS");
    panel.search = `?${connection.toString()}`;
  }

  window.open(panel.toString(), "_blank", "noopener");
}

export function renderSettings(force = false) {
  const state = store.model.state;
  const runtime = store.runtime;
  const fingerprint = JSON.stringify({
    state,
    nft: runtime.nft_available,
    ui: [runtime.external_ui_present, runtime.external_ui_state, runtime.external_ui_message_b64, runtime.external_ui_mtime],
    iface: runtime.active_network_interface_b64,
    cidr: runtime.active_network_cidr_b64
  });
  // Пока в форме есть несохранённые правки, опрос её не перетирает.
  if (ui.settingsReady && !force && (ui.settingsDirty || fingerprint === ui.settingsFingerprint)) return;
  renderHeaders("global-header-rows", decode(state.global_headers_b64), true);
  $("mihomo-find-process-mode").value = state.mihomo_find_process_mode || "off";
  $("mihomo-log-level").value = state.mihomo_log_level || "warning";
  $("mihomo-mode").value = state.mihomo_mode || "source";
  $("global-override").value = decode(state.global_override_b64);
  $("mihomo-ipv6").checked = Number(state.mihomo_ipv6 ?? 0) !== 0;
  $("mihomo-store-selected").checked = Number(state.mihomo_store_selected ?? 1) !== 0;
  $("mihomo-store-fake-ip").checked = Number(state.mihomo_store_fake_ip ?? 0) !== 0;
  $("mihomo-sniffer-override").checked = Number(state.mihomo_sniffer_override ?? 0) !== 0;
  $("mihomo-sniffer-enable").checked = Number(state.mihomo_sniffer_enable ?? 0) !== 0;
  $("mihomo-sniffer-force-dns-mapping").checked = Number(state.mihomo_sniffer_force_dns_mapping ?? 0) !== 0;
  $("mihomo-sniffer-parse-pure-ip").checked = Number(state.mihomo_sniffer_parse_pure_ip ?? 0) !== 0;
  $("mihomo-sniffer-override-destination").checked = Number(state.mihomo_sniffer_override_destination ?? 0) !== 0;
  $("mihomo-sniffer-quic-ports").value = decode(state.mihomo_sniffer_quic_ports_b64).replace(/\r?\n/g, ", ");
  $("mihomo-sniffer-tls-ports").value = decode(state.mihomo_sniffer_tls_ports_b64).replace(/\r?\n/g, ", ");
  $("mihomo-sniffer-http-ports").value = (decode(state.mihomo_sniffer_http_ports_b64) || "80\n8080-8880").replace(/\r?\n/g, ", ");
  $("mihomo-sniffer-http-override-destination").checked = Number(state.mihomo_sniffer_http_override_destination ?? 1) !== 0;
  $("mihomo-sniffer-force-domain").value = decode(state.mihomo_sniffer_force_domain_b64);
  $("mihomo-sniffer-skip-domain").value = decode(state.mihomo_sniffer_skip_domain_b64);
  $("mihomo-sniffer-skip-src-address").value = decode(state.mihomo_sniffer_skip_src_address_b64);
  $("mihomo-sniffer-skip-dst-address").value = decode(state.mihomo_sniffer_skip_dst_address_b64);
  updateSnifferOverrideState();
  const nft = Boolean(runtime.nft_available);
  let mode = state.listener_mode || "auto";
  if (!nft && ["redir-tproxy", "tproxy"].includes(mode)) mode = "redir-tun";
  all('input[name="listener-mode"]').forEach((input) => { input.checked = input.value === mode; });
  $("redir-port").value = state.redir_port || 12345;
  $("inbound-strip-socks").checked = Number(state.inbound_strip_socks ?? 1) !== 0;
  $("inbound-strip-http").checked = Number(state.inbound_strip_http ?? 1) !== 0;
  $("inbound-strip-mixed").checked = Number(state.inbound_strip_mixed ?? 1) !== 0;
  $("local-socks-enabled").checked = Number(state.local_socks_enabled ?? 0) !== 0;
  $("local-socks-port").value = state.local_socks_port || 1080;
  $("local-socks-user").value = decode(state.local_socks_user_b64);
  $("local-socks-pass").value = decode(state.local_socks_pass_b64);
  $("local-http-enabled").checked = Number(state.local_http_enabled ?? 0) !== 0;
  $("local-http-port").value = state.local_http_port || 1081;
  $("local-http-user").value = decode(state.local_http_user_b64);
  $("local-http-pass").value = decode(state.local_http_pass_b64);
  updateLocalInboundState();
  $("tproxy-port").value = state.tproxy_port || 12346;
  all('input[name="listener-mode"]').forEach((input) => { input.disabled = !nft && ["redir-tproxy", "tproxy"].includes(input.value); });
  updateListenerPortFields();
  $("auto-mode-description").textContent = nft
    ? "На этой платформе: REDIR для TCP + TPROXY для UDP"
    : "На этой платформе: REDIR для TCP + TUN для UDP";
  $("listener-mode-note").textContent = nft
    ? "Автоматический режим использует REDIR TCP + TPROXY UDP; порты REDIR и TPROXY должны отличаться."
    : "Автоматический режим использует REDIR TCP + TUN UDP; режимы TPROXY недоступны без nftables.";
  const activeNetworkInterface = decode(runtime.active_network_interface_b64);
  const activeNetworkCidr = decode(runtime.active_network_cidr_b64);
  $("network-active-interface").textContent = activeNetworkInterface
    ? `${activeNetworkInterface}${activeNetworkCidr ? ` · ${activeNetworkCidr}` : ""}`
    : "Не найден";
  $("network-firewall-backend").textContent = runtime.firewall_backend || (nft ? "nftables" : "iptables-legacy");
  $("network-qdisc").value = state.network_qdisc || "fq_codel";
  $("network-ipv6").checked = Number(state.network_disable_ipv6 ?? 1) === 0;
  $("network-multicast").checked = Number(state.network_disable_multicast ?? 1) === 0;
  $("network-ct-established").value = state.network_ct_established || 86400;
  $("network-ct-syn-sent").value = state.network_ct_syn_sent || 5;
  $("network-ct-syn-recv").value = state.network_ct_syn_recv || 5;
  $("network-ct-fin-wait").value = state.network_ct_fin_wait || 10;
  $("network-ct-close-wait").value = state.network_ct_close_wait || 10;
  $("network-ct-last-ack").value = state.network_ct_last_ack || 10;
  $("network-ct-time-wait").value = state.network_ct_time_wait || 10;
  $("network-ct-close").value = state.network_ct_close || 10;
  $("network-ct-unacknowledged").value = state.network_ct_unacknowledged || 300;
  $("network-ct-udp-stream").value = state.network_ct_udp_stream || 180;
  const uiPreset = state.external_ui_preset || "zashboard-cdn";
  $("external-ui-preset").value = externalUIPresets[uiPreset] || uiPreset === "custom" ? uiPreset : "zashboard-cdn";
  $("external-ui-url").dataset.customUrl = decode(state.external_ui_url_b64);
  $("external-ui-url").dataset.activePreset = "";
  updateExternalUIPreset();
  $("external-ui-secret").value = decode(state.external_ui_secret_b64);
  updateSecretWarning();
  pendingTheme = isTheme(state.web_theme) ? state.web_theme : "auto";
  pendingAccent = isAccent(state.web_accent) ? state.web_accent : "";
  applyTheme(pendingTheme, pendingAccent);
  renderThemeGrid();
  const uiState = $("external-ui-state");
  const uiMessage = decode(runtime.external_ui_message_b64);
  if (runtime.external_ui_state === "downloading") {
    uiState.textContent = "Скачивается · Mihomo продолжает работать";
    uiState.className = "pending";
  } else if (runtime.external_ui_state === "error") {
    uiState.textContent = `Ошибка загрузки${uiMessage ? ` · ${uiMessage}` : ""}`;
    uiState.className = "error";
  } else {
    uiState.textContent = runtime.external_ui_present ? "Готова · /etc/mihomo/ui" : "Ожидает загрузки · /etc/mihomo/ui";
    uiState.className = runtime.external_ui_present ? "ready" : "pending";
  }
  ui.settingsReady = true;
  ui.settingsDirty = false;
  ui.settingsFingerprint = fingerprint;
}

export async function saveSettings() {
  const selectedMode = document.querySelector('input[name="listener-mode"]:checked');
  const mode = selectedMode ? selectedMode.value : "auto";
  const redirPort = $("redir-port").value;
  const tproxyPort = $("tproxy-port").value;
  if ((mode === "redir-tproxy" || (mode === "auto" && store.runtime.nft_available)) && redirPort === tproxyPort) {
    throw new Error("Для REDIR и TPROXY нужны разные порты");
  }
  const result = await send({
    action: "save-settings",
    web_theme: pendingTheme,
    web_accent: pendingAccent,
    global_headers: serializedHeaders("global-header-rows", true),
    listener_mode: mode,
    redir_port: redirPort,
    tproxy_port: tproxyPort,
    inbound_strip_socks: $("inbound-strip-socks").checked ? "1" : "0",
    inbound_strip_http: $("inbound-strip-http").checked ? "1" : "0",
    inbound_strip_mixed: $("inbound-strip-mixed").checked ? "1" : "0",
    local_socks_enabled: $("local-socks-enabled").checked ? "1" : "0",
    local_socks_port: $("local-socks-port").value,
    local_socks_user: $("local-socks-user").value.trim(),
    local_socks_pass: $("local-socks-pass").value,
    local_http_enabled: $("local-http-enabled").checked ? "1" : "0",
    local_http_port: $("local-http-port").value,
    local_http_user: $("local-http-user").value.trim(),
    local_http_pass: $("local-http-pass").value,
    external_ui_preset: $("external-ui-preset").value,
    external_ui_url: $("external-ui-url").dataset.customUrl || "",
    external_ui_secret: $("external-ui-secret").value,
    mihomo_find_process_mode: $("mihomo-find-process-mode").value,
    mihomo_log_level: $("mihomo-log-level").value,
    mihomo_mode: $("mihomo-mode").value,
    global_override: $("global-override").value,
    mihomo_ipv6: $("mihomo-ipv6").checked ? "1" : "0",
    mihomo_store_selected: $("mihomo-store-selected").checked ? "1" : "0",
    mihomo_store_fake_ip: $("mihomo-store-fake-ip").checked ? "1" : "0",
    mihomo_sniffer_override: $("mihomo-sniffer-override").checked ? "1" : "0",
    mihomo_sniffer_enable: $("mihomo-sniffer-enable").checked ? "1" : "0",
    mihomo_sniffer_force_dns_mapping: $("mihomo-sniffer-force-dns-mapping").checked ? "1" : "0",
    mihomo_sniffer_parse_pure_ip: $("mihomo-sniffer-parse-pure-ip").checked ? "1" : "0",
    mihomo_sniffer_override_destination: $("mihomo-sniffer-override-destination").checked ? "1" : "0",
    mihomo_sniffer_quic_ports: $("mihomo-sniffer-quic-ports").value,
    mihomo_sniffer_tls_ports: $("mihomo-sniffer-tls-ports").value,
    mihomo_sniffer_http_ports: $("mihomo-sniffer-http-ports").value,
    mihomo_sniffer_http_override_destination: $("mihomo-sniffer-http-override-destination").checked ? "1" : "0",
    mihomo_sniffer_force_domain: $("mihomo-sniffer-force-domain").value,
    mihomo_sniffer_skip_domain: $("mihomo-sniffer-skip-domain").value,
    mihomo_sniffer_skip_src_address: $("mihomo-sniffer-skip-src-address").value,
    mihomo_sniffer_skip_dst_address: $("mihomo-sniffer-skip-dst-address").value,
    network_disable_ipv6: $("network-ipv6").checked ? "0" : "1",
    network_qdisc: $("network-qdisc").value,
    network_disable_multicast: $("network-multicast").checked ? "0" : "1",
    network_ct_established: $("network-ct-established").value,
    network_ct_syn_sent: $("network-ct-syn-sent").value,
    network_ct_syn_recv: $("network-ct-syn-recv").value,
    network_ct_fin_wait: $("network-ct-fin-wait").value,
    network_ct_close_wait: $("network-ct-close-wait").value,
    network_ct_last_ack: $("network-ct-last-ack").value,
    network_ct_time_wait: $("network-ct-time-wait").value,
    network_ct_close: $("network-ct-close").value,
    network_ct_unacknowledged: $("network-ct-unacknowledged").value,
    network_ct_udp_stream: $("network-ct-udp-stream").value
  });
  ui.settingsDirty = false;
  await load();
  renderSettings(true);
  schedulePoll(250);
  if (result.panel_update && !result.core_rebuild && !result.source_refresh) {
    toast("Настройки сохранены · новая панель скачивается без перезапуска Mihomo");
  } else if (result.source_refresh) {
    toast("Настройки сохранены · подписка загружается и проверяется");
  } else if (result.core_rebuild) {
    toast("Настройки сохранены · Mihomo переключится после успешной проверки");
  } else {
    toast("Настройки сохранены");
  }
}

export async function generateBasicAuthHash() {
  const password = $("basic-auth-password").value;
  const confirmation = $("basic-auth-password-confirm").value;
  if (!password) throw new Error("Введите новый пароль");
  if (password !== confirmation) throw new Error("Пароли не совпадают");
  const button = $("generate-basic-auth-hash");
  button.disabled = true;
  try {
    const payload = await requestJson("/cgi-bin/gen-hash", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: password
    });
    if (!payload.hash) throw new Error("Сервер не вернул хеш");
    $("basic-auth-hash").value = payload.hash;
    $("basic-auth-hash-result").classList.remove("hidden");
    toast("Хеш создан");
  } finally {
    button.disabled = false;
  }
}

onRender(() => renderSettings());
