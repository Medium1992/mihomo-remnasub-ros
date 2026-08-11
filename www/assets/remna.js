(() => {
  const $ = (id) => document.getElementById(id);
  const views = { overview: 'Обзор', subscription: 'Подписка', listener: 'Входящий порт', config: 'Конфигурация' };
  let profile = null;
  let activeConfig = 'source';

  const decode = (value) => {
    if (!value) return '';
    const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };
  const formValue = (id) => $(id).type === 'checkbox' ? ($(id).checked ? '1' : '0') : $(id).value.trim();
  const notice = (text, error = false) => { const node = $('save-state'); node.textContent = text; node.style.color = error ? 'var(--danger)' : ''; };
  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  function fill(p) {
    $('sub-url').value = decode(p.url_b64);
    $('sub-headers').value = decode(p.headers_b64);
    $('sub-refresh').value = p.refresh_seconds;
    $('sub-timeout').value = p.timeout_seconds;
    $('sub-insecure').checked = Boolean(p.insecure_tls);
    $('mixed-enabled').checked = Boolean(p.mixed_enabled);
    $('mixed-name').value = decode(p.mixed_name_b64);
    $('mixed-port').value = p.mixed_port;
    $('mixed-listen').value = decode(p.mixed_listen_b64);
    $('mixed-udp').checked = Boolean(p.mixed_udp);
    $('mixed-users').value = decode(p.mixed_users_b64);
  }
  async function loadProfile() {
    const data = await (await api('/cgi-bin/remna-profile')).json();
    profile = data.profile;
    fill(profile);
  }
  async function loadStatus() {
    try {
      const data = await (await api('/cgi-bin/remna-status')).json();
      const running = data.mihomo_running;
      $('runtime-status').className = `runtime-status ${running ? 'good' : data.error_b64 ? 'bad' : ''}`;
      $('runtime-status').querySelector('span').textContent = running ? 'Mihomo работает' : (data.error_b64 ? 'Требуется внимание' : 'Ожидание запуска');
      $('source-state').textContent = data.source_present ? 'получен' : 'нет';
      $('final-state').textContent = data.final_present ? 'готова' : 'нет';
      $('mihomo-state').textContent = running ? 'запущен' : 'не запущен';
      $('state-headline').textContent = running ? 'Профиль применяется' : (data.source_present ? 'Проверка конфигурации' : 'Ожидание профиля');
      $('state-description').textContent = running ? 'Mihomo использует скачанный YAML и локальную конфигурацию listener.' : 'Укажите URL полной YAML-подписки. После сохранения контейнер загрузит и проверит её.';
      const error = decode(data.error_b64);
      $('error-message').textContent = error;
      $('error-message').classList.toggle('hidden', !error);
      $('profile-meta').textContent = decode(data.meta_b64) || 'Метаданных пока нет.';
    } catch (error) { $('runtime-status').className = 'runtime-status bad'; $('runtime-status').querySelector('span').textContent = 'Статус недоступен'; }
  }
  async function save() {
    const button = $('save-button');
    button.disabled = true; notice('Сохраняю профиль...');
    const body = new URLSearchParams();
    const fields = {
      'sub-url': 'url', 'sub-headers': 'headers', 'sub-refresh': 'refresh_seconds',
      'sub-timeout': 'timeout_seconds', 'sub-insecure': 'insecure_tls',
      'mixed-enabled': 'mixed_enabled', 'mixed-name': 'mixed_name', 'mixed-port': 'mixed_port',
      'mixed-listen': 'mixed_listen', 'mixed-udp': 'mixed_udp', 'mixed-users': 'mixed_users',
    };
    Object.entries(fields).forEach(([id, key]) => body.set(key, formValue(id)));
    try {
      const response = await (await api('/cgi-bin/remna-profile', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })).json();
      if (!response.ok) throw new Error(response.error || 'Profile was rejected');
      notice('Сохранено. Контейнер обновляет профиль.');
      setTimeout(loadStatus, 800);
    } catch (error) { notice(`Не сохранено: ${error.message}`, true); }
    finally { button.disabled = false; }
  }
  async function refresh() {
    const button = $('refresh-button'); button.disabled = true;
    try { await api('/cgi-bin/remna-refresh', { method: 'POST' }); notice('Запрошено обновление профиля.'); setTimeout(loadStatus, 900); }
    catch (error) { notice(`Не удалось обновить: ${error.message}`, true); }
    finally { button.disabled = false; }
  }
  async function loadConfig() {
    $('config-view').textContent = 'Загрузка...';
    try { $('config-view').textContent = await (await api(`/cgi-bin/remna-config?kind=${activeConfig}`)).text() || 'Файл пока не создан.'; }
    catch (error) { $('config-view').textContent = `Не удалось загрузить: ${error.message}`; }
  }
  function activate(view) {
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === view));
    $('view-title').textContent = views[view];
    if (view === 'config') loadConfig();
  }
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => activate(button.dataset.view)));
  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => { activeConfig = button.dataset.config; document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el === button)); loadConfig(); }));
  $('save-button').addEventListener('click', save);
  $('refresh-button').addEventListener('click', refresh);
  Promise.all([loadProfile(), loadStatus()]).catch((error) => notice(`Не удалось загрузить профиль: ${error.message}`, true));
  setInterval(loadStatus, 15000);
})();
