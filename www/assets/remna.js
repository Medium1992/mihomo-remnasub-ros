(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  let model = { state: {}, profiles: [], profile: null };
  let runtime = {};
  let editorProfileId = "";
  let sourceYamlProfileId = "";
  let deleteProfileId = "";
  let settingsReady = false;
  let settingsDirty = false;
  let settingsFingerprint = "";
  let subscriptionsFingerprint = "";
  let sidebarFingerprint = "";
  let dashboardFingerprint = "";
  let dashboardYamlProfileId = "";
  let toastTimer = 0;
  const externalUIPresets = {
    "zashboard": "https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip",
    "zashboard-cdn": "https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip",
    "metacubexd": "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
    "yacd-meta": "https://github.com/MetaCubeX/Yacd-meta/archive/refs/heads/gh-pages.zip"
  };
  const networkTimeoutDefaults = {
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
  function requiredHeaders() {
    return [
      ["x-hwid", "RouterOS-Solomon"],
      ["x-device-os", "RouterOS"],
      ["x-ver-os", "7.23.3"],
      ["x-device-model", "MikroTik RB5009UG+S+IN"],
      ["user-agent", decode(model.state.default_user_agent_b64) || "clash.meta/1.19.29"]
    ];
  }

  function decode(value) {
    if (!value) return "";
    try {
      const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (_) {
      return "";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  function profileName(profile) {
    return profile ? (decode(profile.display_name_b64) || decode(profile.name_b64) || profile.id || "Без названия") : "Подписка не выбрана";
  }

  function profileLocalName(profile) {
    return profile ? (decode(profile.name_b64) || profile.id || "Без названия") : "";
  }

  function profileUrl(profile) {
    return profile ? decode(profile.url_b64) : "";
  }

  function parseHeaders(raw, includeRequired = false) {
    const entries = String(raw || "").split(/\r?\n/).map((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) return null;
      return { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim(), required: false };
    }).filter(Boolean);
    if (!includeRequired) return entries;
    const rows = requiredHeaders().map(([key, fallback]) => {
      const index = entries.findIndex((entry) => entry.key.toLowerCase() === key);
      if (index < 0) return { key, value: fallback, required: true };
      const [entry] = entries.splice(index, 1);
      if (key === "user-agent" && entry.value === "Mihomo-RemnaSub-RoS/1") entry.value = fallback;
      return { key, value: entry.value || fallback, required: true };
    });
    return rows.concat(entries);
  }

  function headerRow(row) {
    const action = row.required
      ? `<span class="header-lock" title="Обязательный заголовок">${icon("lock")}</span>`
      : `<button class="icon-button danger" type="button" data-remove-header title="Удалить заголовок">${icon("trash")}</button>`;
    return `<div class="header-row" data-header-row>
      <input type="text" data-header-key value="${escapeHtml(row.key)}" placeholder="x-custom-header"${row.required ? " readonly" : ""} aria-label="Ключ заголовка">
      <input type="text" data-header-value value="${escapeHtml(row.value)}" placeholder="Значение" aria-label="Значение заголовка">
      ${action}
    </div>`;
  }

  function renderHeaders(containerId, raw, includeRequired = false) {
    $(containerId).innerHTML = parseHeaders(raw, includeRequired).map(headerRow).join("");
  }

  function serializedHeaders(containerId, requireDefaults = false) {
    const seen = new Set();
    const lines = [];
    all("[data-header-row]", $(containerId)).forEach((row) => {
      const key = row.querySelector("[data-header-key]").value.trim();
      const value = row.querySelector("[data-header-value]").value.trim();
      if (!key && !value) return;
      if (!/^[A-Za-z0-9-]+$/.test(key)) throw new Error(`Недопустимое имя HTTP-заголовка: ${key || "пустое"}`);
      const normalized = key.toLowerCase();
      if (seen.has(normalized)) throw new Error(`HTTP-заголовок ${key} указан дважды`);
      if (!value && requireDefaults && requiredHeaders().some(([required]) => required === normalized)) throw new Error(`Заполните значение ${key}`);
      seen.add(normalized);
      lines.push(`${key}: ${value}`);
    });
    return lines.join("\n");
  }

  function activeProfile() {
    return model.profiles.find((profile) => profile.id === model.state.active_profile_id) || model.profile || null;
  }

  function profileById(profileId) {
    return model.profiles.find((profile) => profile.id === profileId) || null;
  }

  function formatInterval(seconds) {
    const value = Number(seconds || 3600);
    if (value % 86400 === 0) return `${value / 86400} дн.`;
    if (value % 3600 === 0) return `${value / 3600} ч`;
    if (value % 60 === 0) return `${value / 60} мин.`;
    return `${value} сек.`;
  }

  function formatUpdated(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return "Ещё не обновлялась";
    const delta = Math.max(0, Math.floor(Date.now() / 1000) - value);
    if (delta < 60) return "только что";
    if (delta < 3600) return `${Math.floor(delta / 60)} мин. назад`;
    if (delta < 86400) return `${Math.floor(delta / 3600)} ч назад`;
    return `${Math.floor(delta / 86400)} дн. назад`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value < 0) return "0 Б";
    const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    const digits = unit > 0 && size < 10 ? 1 : 0;
    return `${size.toFixed(digits)} ${units[unit]}`;
  }

  function parseSubscriptionUserinfo(raw) {
    const values = {};
    String(raw || "").split(";").forEach((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return;
      values[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim();
    });
    return values;
  }

  function safeHttpUrl(raw) {
    try {
      const url = new URL(raw);
      return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
    } catch (_) { return ""; }
  }

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

  function updateLocalOverrideState(openOnEnable = false) {
    const enabled = $("profile-local-override-enabled").checked;
    const details = $("profile-local-details");
    $("profile-local-state").textContent = enabled ? "Включены" : "Выключены";
    $("profile-local-body").classList.toggle("disabled", !enabled);
    details.classList.toggle("disabled", !enabled);
    if (!enabled) details.open = false;
    all("input, select, textarea, button", $("profile-local-body")).forEach((control) => { control.disabled = !enabled; });
    if (enabled && openOnEnable) details.open = true;
  }

  async function copyViewer(viewerId) {
    const viewer = $(viewerId);
    const text = viewer.value;
    if (!text) return;
    viewer.focus();
    viewer.select();
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch (_) {
      if (!document.execCommand("copy")) throw new Error("Не удалось скопировать текст");
    }
    toast("YAML скопирован");
  }

  function updateSnifferOverrideState(openOnEnable = false) {
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

  function listenerModeLabel(mode) {
    if (mode === "auto") return `Автоматически · ${runtime.nft_available ? "REDIR + TPROXY" : "REDIR + TUN"}`;
    return ({ "redir-tun": "REDIR + TUN", "redir-tproxy": "REDIR + TPROXY", tproxy: "TPROXY" })[mode] || "Автоматически";
  }

  function updateListenerPortFields() {
    const selected = document.querySelector('input[name="listener-mode"]:checked');
    const mode = selected ? selected.value : "auto";
    const nft = Boolean(runtime.nft_available);
    const usesRedir = mode === "redir-tun" || mode === "redir-tproxy" || mode === "auto";
    const usesTproxy = mode === "tproxy" || mode === "redir-tproxy" || (mode === "auto" && nft);
    all("[data-port-field]").forEach((label) => {
      const used = label.dataset.portField === "redir" ? usesRedir : usesTproxy;
      label.classList.toggle("unused", !used);
      label.querySelector("input").disabled = !used;
    });
  }

  function updateExternalUIPreset() {
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

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { response, text };
  }

  async function requestJson(url, options = {}) {
    const result = await request(url, options);
    let payload;
    try { payload = JSON.parse(result.text); }
    catch (_) { throw new Error("Сервер вернул повреждённый JSON"); }
    if (payload.ok === false) throw new Error(payload.error || "Операция отклонена");
    return payload;
  }

  async function send(fields) {
    return requestJson("/cgi-bin/remna-profile", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields)
    });
  }

  function toast(message, error = false) {
    const node = $("toast");
    window.clearTimeout(toastTimer);
    node.textContent = message;
    node.className = `toast show${error ? " error" : ""}`;
    toastTimer = window.setTimeout(() => { node.className = "toast"; }, 3000);
  }

  function showPage(pageName) {
    all("[data-page-link]").forEach((button) => button.classList.toggle("active", button.dataset.pageLink === pageName));
    all("[data-page]").forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
    history.replaceState(null, "", `#${pageName}`);
  }

  function renderSidebar() {
    const active = activeProfile();
    const running = Boolean(runtime.mihomo_running && runtime.run_enabled && runtime.configured && runtime.final_present);
    const waiting = Boolean(runtime.run_enabled && !running && active && profileUrl(active));
    const fingerprint = JSON.stringify([model.profiles.length, model.state.active_profile_id, active && profileName(active), running, waiting]);
    if (fingerprint === sidebarFingerprint) return;
    sidebarFingerprint = fingerprint;
    $("nav-profile-count").textContent = String(model.profiles.length);
    $("sidebar-active-profile").textContent = active ? profileName(active) : "Профиль не выбран";
    $("sidebar-core-title").textContent = running ? "Mihomo работает" : waiting ? "Mihomo запускается" : "Mihomo остановлен";
    $("sidebar-core-dot").className = running ? "running" : waiting ? "waiting" : "";
  }

  function renderDashboard() {
    const active = activeProfile();
    const configured = Boolean(active && profileUrl(active));
    const running = Boolean(runtime.mihomo_running && runtime.run_enabled && configured && runtime.final_present);
    const enabled = Boolean(runtime.run_enabled);
    const fingerprint = JSON.stringify({
      active: model.state.active_profile_id,
      profiles: model.profiles.map((profile) => [profile.id, profile.display_name_b64, profile.name_b64, profile.url_b64]),
      listener: model.state.listener_mode,
      runtime: [configured, running, enabled, runtime.source_present, runtime.final_present, runtime.error_b64, runtime.nft_available]
    });
    if (fingerprint === dashboardFingerprint) return;
    dashboardFingerprint = fingerprint;
    const select = $("dashboard-profile-select");
    select.innerHTML = model.profiles.length
      ? model.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}"${profile.id === model.state.active_profile_id ? " selected" : ""}>${escapeHtml(profileName(profile))}</option>`).join("")
      : '<option value="">Нет подписок</option>';
    select.disabled = model.profiles.length === 0;

    $("dashboard-profile-name").textContent = active ? profileName(active) : "Подписка не выбрана";
    $("dashboard-profile-url").textContent = configured ? profileUrl(active) : "Добавьте подписку, чтобы запустить Mihomo.";
    const chip = $("dashboard-runtime-chip");
    chip.className = `state-pill ${running ? "running" : enabled && configured ? "waiting" : "idle"}`;
    chip.innerHTML = `<i></i>${running ? "Работает" : enabled && configured ? "Запускается" : "Остановлено"}`;
    $("dashboard-power").disabled = !configured;
    $("dashboard-power").classList.toggle("running", enabled);
    $("dashboard-power").querySelector("span").textContent = enabled ? "Остановить" : "Запустить";
    $("dashboard-power-note").textContent = running ? "Ядро работает" : enabled && configured ? "Ожидание запуска" : "Ядро остановлено";
    $("dashboard-source-state").textContent = runtime.source_present ? "Получен" : "Нет данных";
    $("dashboard-config-state").textContent = runtime.final_present ? "Проверена" : "Не собрана";
    $("dashboard-route-mode").textContent = listenerModeLabel(model.state.listener_mode);
    const yamlDetails = $("dashboard-yaml-details");
    yamlDetails.classList.toggle("hidden", !runtime.final_present);
    if (!runtime.final_present) {
      yamlDetails.open = false;
      $("dashboard-yaml").value = "Файл ещё не создан.";
      dashboardYamlProfileId = "";
    } else if (yamlDetails.open && dashboardYamlProfileId !== model.state.active_profile_id) {
      loadDashboardYaml().catch(() => {});
    }
    const error = decode(runtime.error_b64);
    $("dashboard-error").textContent = error;
    $("dashboard-error").classList.toggle("hidden", !error);
  }

  function profileHealth(profile) {
    const active = profile.id === model.state.active_profile_id;
    const error = decode(profile.error_b64) || (active ? decode(runtime.error_b64) : "");
    const source = Boolean(profile.source_present || (active && runtime.source_present));
    const final = Boolean(profile.final_present || (active && runtime.final_present));
    if (error) return { className: "error", label: "Ошибка конфигурации" };
    if (!profileUrl(profile)) return { className: "warning", label: "URL не настроен" };
    if (active && runtime.mihomo_running) return { className: "good", label: "Mihomo работает" };
    if (active && runtime.run_enabled) return { className: "warning", label: "Ожидание запуска" };
    if (final) return { className: "good", label: "Конфигурация проверена" };
    if (source) return { className: "good", label: "YAML получен" };
    return { className: "", label: "Не загружалась" };
  }

  function renderSubscriptions() {
    const profiles = model.profiles;
    $("subscriptions-subtitle").textContent = `${profiles.length} ${profiles.length === 1 ? "профиль" : profiles.length > 1 && profiles.length < 5 ? "профиля" : "профилей"}`;
    const fingerprint = JSON.stringify({
      active: model.state.active_profile_id,
      runtime: [runtime.mihomo_running, runtime.run_enabled, runtime.source_present, runtime.final_present, runtime.error_b64],
      minute: Math.floor(Date.now() / 60000),
      profiles
    });
    if (fingerprint === subscriptionsFingerprint) return;
    subscriptionsFingerprint = fingerprint;
    $("subscription-list").innerHTML = profiles.map((profile) => {
      const active = profile.id === model.state.active_profile_id;
      const health = profileHealth(profile);
      return `<article class="subscription-card${active ? " active" : ""}" data-profile-row="${escapeHtml(profile.id)}">
        <div class="subscription-main">
          <span class="subscription-icon"><svg><use href="#i-bookmark"></use></svg></span>
          <div class="subscription-details">
            <div class="subscription-title"><strong>${escapeHtml(profileName(profile))}</strong>${active ? "<mark>активна</mark>" : ""}</div>
            <p>${escapeHtml(profileUrl(profile) || "URL не задан")}</p>
            <div class="subscription-meta"><span>${icon("clock")}${formatUpdated(profile.updated_at)}</span><span>${icon("refresh")}авто: ${formatInterval(profile.effective_refresh_seconds || profile.refresh_seconds)}</span>${profile.local_override_enabled ? `<span>${icon("settings")}локальные параметры</span>` : ""}</div>
          </div>
          <div class="subscription-actions">
            <button class="icon-button" type="button" data-profile-action="edit" data-profile-id="${escapeHtml(profile.id)}" title="Настройки">${icon("settings")}</button>
            <button class="icon-button" type="button" data-profile-action="refresh" data-profile-id="${escapeHtml(profile.id)}" title="${active ? "Обновить" : "Сначала выберите профиль"}"${active ? "" : " disabled"}>${icon("refresh")}</button>
            <button class="icon-button" type="button" data-profile-action="source" data-profile-id="${escapeHtml(profile.id)}" title="Полученный YAML">${icon("file")}</button>
            <button class="icon-button danger" type="button" data-profile-action="delete" data-profile-id="${escapeHtml(profile.id)}" title="${active ? "Активную подписку удалить нельзя" : "Удалить"}"${active ? " disabled" : ""}>${icon("trash")}</button>
          </div>
        </div>
        <footer class="subscription-footer"><span class="subscription-health ${health.className}"><i></i>${health.label}</span><code>${escapeHtml(profile.id)}</code></footer>
      </article>`;
    }).join("");
    $("subscription-list").classList.toggle("hidden", profiles.length === 0);
    $("subscription-empty").classList.toggle("hidden", profiles.length !== 0);
  }

  function renderSettings(force = false) {
    const state = model.state;
    const fingerprint = JSON.stringify({ state, nft: runtime.nft_available, ui: runtime.external_ui_present, iface: runtime.active_network_interface_b64, cidr: runtime.active_network_cidr_b64 });
    if (settingsReady && !force && (settingsDirty || fingerprint === settingsFingerprint)) return;
    renderHeaders("global-header-rows", decode(state.global_headers_b64), true);
    $("mihomo-find-process-mode").value = state.mihomo_find_process_mode || "off";
    $("mihomo-log-level").value = state.mihomo_log_level || "warning";
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
    const uiState = $("external-ui-state");
    uiState.textContent = runtime.external_ui_present ? "Скачана · /etc/mihomo/ui" : "Ожидает загрузки · /etc/mihomo/ui";
    uiState.className = runtime.external_ui_present ? "ready" : "pending";
    settingsReady = true;
    settingsDirty = false;
    settingsFingerprint = fingerprint;
  }

  function renderAll() {
    renderSidebar();
    renderDashboard();
    renderSubscriptions();
    renderSettings();
  }

  async function load({ quiet = false } = {}) {
    try {
      [model, runtime] = await Promise.all([requestJson("/cgi-bin/remna-profile"), requestJson("/cgi-bin/remna-status")]);
      renderAll();
    } catch (error) {
      if (!quiet) toast(`Не удалось загрузить состояние: ${error.message}`, true);
      throw error;
    }
  }

  async function selectProfile(profileId) {
    if (!profileId || profileId === model.state.active_profile_id) return;
    await send({ action: "select", profile_id: profileId });
    await load();
    toast("Активная подписка изменена");
  }

  async function toggleRuntime() {
    const stop = Boolean(model.state.run_enabled);
    await send({ action: stop ? "stop" : "start" });
    await load();
    toast(stop ? "Остановка Mihomo запрошена" : "Запуск Mihomo запрошен");
  }

  async function refreshActiveProfile() {
    await requestJson("/cgi-bin/remna-refresh", { method: "POST" });
    toast("Обновление подписки запрошено");
    window.setTimeout(() => load({ quiet: true }).catch(() => {}), 900);
  }

  function openMihomo() {
    const panel = new URL(location.href);
    panel.protocol = "http:";
    panel.port = "9090";
    panel.pathname = "/ui/";
    panel.search = "";
    panel.hash = "";
    const preset = model.state.external_ui_preset || "zashboard-cdn";
    const secret = decode(model.state.external_ui_secret_b64);
    const connection = new URLSearchParams({
      hostname: location.hostname,
      port: "9090",
      http: "1"
    });
    if (secret) connection.set("secret", secret);

    if (preset === "zashboard" || preset === "zashboard-cdn") {
      connection.set("label", "RemnaSub RoS");
      panel.hash = `/setup?${connection.toString()}`;
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

  function createProfile() {
    showPage("subscriptions");
    editorProfileId = "";
    $("profile-id").value = "";
    $("editor-title").textContent = "Новая подписка";
    $("profile-name").value = "Новая подписка";
    $("profile-url").value = "";
    $("profile-refresh").value = 3600;
    $("profile-timeout").value = 30;
    $("profile-use-provider-title").checked = true;
    $("profile-use-provider-interval").checked = true;
    $("profile-insecure").checked = false;
    $("profile-provider-meta").classList.add("hidden");
    $("profile-local-override-enabled").checked = false;
    renderHeaders("profile-header-rows", "");
    $("profile-local-find-process").value = "inherit";
    $("profile-local-log-level").value = "inherit";
    $("profile-local-ipv6").value = "inherit";
    $("profile-local-store-selected").value = "inherit";
    $("profile-local-store-fake-ip").value = "inherit";
    $("profile-local-sniffer").value = "inherit";
    $("profile-override").value = "";
    $("profile-local-details").open = false;
    updateLocalOverrideState();
    $("profile-modal-layer").classList.remove("hidden");
    $("profile-name").focus();
  }

  async function openEditor(profileId) {
    const details = await requestJson(`/cgi-bin/remna-profile?profile_id=${encodeURIComponent(profileId)}`);
    const profile = details.profile;
    editorProfileId = profile.id;
    $("profile-id").value = profile.id;
    $("editor-title").textContent = profileLocalName(profile);
    $("profile-name").value = profileLocalName(profile);
    $("profile-url").value = decode(profile.url_b64);
    $("profile-refresh").value = profile.refresh_seconds || 3600;
    $("profile-timeout").value = profile.timeout_seconds || 30;
    $("profile-use-provider-title").checked = Boolean(profile.use_provider_title);
    $("profile-use-provider-interval").checked = Boolean(profile.use_provider_interval);
    $("profile-insecure").checked = Boolean(profile.insecure_tls);
    renderProviderMetadata(profile);
    $("profile-local-override-enabled").checked = Boolean(profile.local_override_enabled);
    renderHeaders("profile-header-rows", decode(profile.headers_b64));
    $("profile-local-find-process").value = profile.local_find_process_mode || "inherit";
    $("profile-local-log-level").value = profile.local_log_level || "inherit";
    $("profile-local-ipv6").value = String(profile.local_ipv6 ?? "inherit");
    $("profile-local-store-selected").value = String(profile.local_store_selected ?? "inherit");
    $("profile-local-store-fake-ip").value = String(profile.local_store_fake_ip ?? "inherit");
    $("profile-local-sniffer").value = profile.local_sniffer_mode || "inherit";
    $("profile-override").value = decode(profile.local_override_b64);
    $("profile-local-details").open = false;
    updateLocalOverrideState();
    $("profile-modal-layer").classList.remove("hidden");
    $("profile-name").focus();
  }

  function closeEditor() {
    editorProfileId = "";
    $("profile-modal-layer").classList.add("hidden");
  }

  async function saveProfile(event) {
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
      use_provider_title: $("profile-use-provider-title").checked ? "1" : "0",
      use_provider_interval: $("profile-use-provider-interval").checked ? "1" : "0",
      refresh_seconds: $("profile-refresh").value,
      timeout_seconds: $("profile-timeout").value,
      insecure_tls: $("profile-insecure").checked ? "1" : "0"
    };
    let created = "";
    if (!fields.profile_id) {
      const result = await send({ action: "create", name: fields.name });
      created = result.created;
      fields.profile_id = created;
    }
    try {
      await send(fields);
    } catch (error) {
      if (created) await send({ action: "delete", profile_id: created }).catch(() => {});
      throw error;
    }
    closeEditor();
    await load();
    toast("Подписка сохранена");
  }

  async function openSourceYaml(profileId) {
    const profile = profileById(profileId);
    if (!profile) return;
    sourceYamlProfileId = profileId;
    $("source-yaml-title").textContent = `Полученный YAML · ${profileName(profile)}`;
    $("source-yaml-viewer").value = "Загрузка...";
    $("source-yaml-modal").classList.remove("hidden");
    const result = await request(`/cgi-bin/remna-config?kind=source&profile_id=${encodeURIComponent(profileId)}`);
    if (sourceYamlProfileId !== profileId) return;
    $("source-yaml-viewer").value = result.text || "Файл ещё не создан.";
    $("source-yaml-viewer").scrollTop = 0;
  }

  function closeSourceYaml() {
    sourceYamlProfileId = "";
    $("source-yaml-modal").classList.add("hidden");
  }

  async function loadDashboardYaml() {
    const profileId = model.state.active_profile_id;
    if (!profileId || !runtime.final_present) return;
    $("dashboard-yaml").value = "Загрузка...";
    const result = await request(`/cgi-bin/remna-config?kind=final&profile_id=${encodeURIComponent(profileId)}`);
    if (profileId !== model.state.active_profile_id) return;
    dashboardYamlProfileId = profileId;
    $("dashboard-yaml").value = result.text || "Файл ещё не создан.";
    $("dashboard-yaml").scrollTop = 0;
  }

  function askDelete(profileId) {
    const profile = profileById(profileId);
    if (!profile || profile.id === model.state.active_profile_id) return;
    deleteProfileId = profileId;
    $("delete-message").textContent = `Профиль «${profileName(profile)}» и его сохранённые файлы будут удалены.`;
    $("delete-modal").classList.remove("hidden");
  }

  function closeDelete() {
    deleteProfileId = "";
    $("delete-modal").classList.add("hidden");
  }

  async function confirmDelete() {
    if (!deleteProfileId) return;
    await send({ action: "delete", profile_id: deleteProfileId });
    closeDelete();
    await load();
    toast("Подписка удалена");
  }

  async function saveSettings() {
    const selectedMode = document.querySelector('input[name="listener-mode"]:checked');
    const mode = selectedMode ? selectedMode.value : "auto";
    const redirPort = $("redir-port").value;
    const tproxyPort = $("tproxy-port").value;
    if ((mode === "redir-tproxy" || (mode === "auto" && runtime.nft_available)) && redirPort === tproxyPort) throw new Error("Для REDIR и TPROXY нужны разные порты");
    await send({
      action: "save-settings",
      global_headers: serializedHeaders("global-header-rows", true),
      listener_mode: mode,
      redir_port: redirPort,
      tproxy_port: tproxyPort,
      external_ui_preset: $("external-ui-preset").value,
      external_ui_url: $("external-ui-url").dataset.customUrl || "",
      external_ui_secret: $("external-ui-secret").value,
      mihomo_find_process_mode: $("mihomo-find-process-mode").value,
      mihomo_log_level: $("mihomo-log-level").value,
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
    settingsDirty = false;
    await load();
    renderSettings(true);
    toast(model.state.run_enabled ? "Настройки сохранены · Mihomo перезапускается" : "Настройки сохранены");
  }

  function protectedAction(handler) {
    return async (...args) => {
      try { await handler(...args); }
      catch (error) { toast(error.message || "Операция не выполнена", true); }
    };
  }

  all("[data-page-link]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.pageLink)));
  all("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => {
    all("[data-settings-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
    all("[data-settings-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === button.dataset.settingsTab));
  }));
  all('input[name="listener-mode"]').forEach((input) => input.addEventListener("change", updateListenerPortFields));
  $("external-ui-preset").addEventListener("change", () => {
    updateExternalUIPreset();
    settingsDirty = true;
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
  all("[data-open-mihomo]").forEach((button) => button.addEventListener("click", openMihomo));
  $("dashboard-profile-select").addEventListener("change", protectedAction(() => selectProfile($("dashboard-profile-select").value)));
  $("dashboard-power").addEventListener("click", protectedAction(toggleRuntime));
  $("add-profile").addEventListener("click", protectedAction(createProfile));
  $("empty-add-profile").addEventListener("click", protectedAction(createProfile));
  $("subscription-list").addEventListener("click", protectedAction(async (event) => {
    const button = event.target.closest("[data-profile-action]");
    if (button) {
      if (button.disabled) return;
      const profileId = button.dataset.profileId;
      if (button.dataset.profileAction === "edit") await openEditor(profileId);
      if (button.dataset.profileAction === "refresh") await refreshActiveProfile();
      if (button.dataset.profileAction === "source") await openSourceYaml(profileId);
      if (button.dataset.profileAction === "delete") askDelete(profileId);
      return;
    }
    const card = event.target.closest("[data-profile-row]");
    if (card) await openEditor(card.dataset.profileRow);
  }));
  $("settings-form").addEventListener("input", () => { settingsDirty = true; });
  $("settings-form").addEventListener("change", () => { settingsDirty = true; });
  $("add-global-header").addEventListener("click", () => {
    $("global-header-rows").insertAdjacentHTML("beforeend", headerRow({ key: "", value: "", required: false }));
    settingsDirty = true;
    const rows = all("[data-header-row]", $("global-header-rows"));
    rows[rows.length - 1].querySelector("[data-header-key]").focus();
  });
  $("global-header-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-header]");
    if (!button) return;
    button.closest("[data-header-row]").remove();
    settingsDirty = true;
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
  $("profile-local-override-enabled").addEventListener("change", () => updateLocalOverrideState(true));
  $("mihomo-sniffer-override").addEventListener("change", () => {
    updateSnifferOverrideState(true);
    settingsDirty = true;
  });
  $("mihomo-sniffer-enable").addEventListener("change", () => updateSnifferOverrideState());
  $("save-settings").addEventListener("click", protectedAction(saveSettings));
  $("reset-network-timeouts").addEventListener("click", () => {
    Object.entries(networkTimeoutDefaults).forEach(([id, value]) => { $(id).value = value; });
    settingsDirty = true;
    toast("Таймауты возвращены к значениям RouterOS");
  });
  $("profile-form").addEventListener("submit", protectedAction(saveProfile));
  $("close-editor").addEventListener("click", closeEditor);
  $("cancel-editor").addEventListener("click", closeEditor);
  $("profile-modal-layer").addEventListener("click", (event) => { if (event.target === $("profile-modal-layer")) closeEditor(); });
  $("dashboard-yaml-details").addEventListener("toggle", protectedAction(async () => {
    if ($("dashboard-yaml-details").open) await loadDashboardYaml();
  }));
  $("copy-dashboard-yaml").addEventListener("click", protectedAction(() => copyViewer("dashboard-yaml")));
  $("copy-source-yaml").addEventListener("click", protectedAction(() => copyViewer("source-yaml-viewer")));
  $("close-source-yaml").addEventListener("click", closeSourceYaml);
  $("done-source-yaml").addEventListener("click", closeSourceYaml);
  $("source-yaml-modal").addEventListener("click", (event) => { if (event.target === $("source-yaml-modal")) closeSourceYaml(); });
  $("delete-cancel").addEventListener("click", closeDelete);
  $("delete-confirm").addEventListener("click", protectedAction(confirmDelete));
  $("delete-modal").addEventListener("click", (event) => { if (event.target === $("delete-modal")) closeDelete(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("delete-modal").classList.contains("hidden")) closeDelete();
    else if (!$("source-yaml-modal").classList.contains("hidden")) closeSourceYaml();
    else if (!$("profile-modal-layer").classList.contains("hidden")) closeEditor();
  });

  const initialPage = location.hash.slice(1);
  if (["dashboard", "subscriptions", "settings"].includes(initialPage)) showPage(initialPage);
  load().catch(() => {});
  window.setInterval(() => load({ quiet: true }).catch(() => {}), 15000);
})();
