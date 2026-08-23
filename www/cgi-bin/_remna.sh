#!/bin/sh
set -u

APP_DIR=/etc/mihomo/remnasub
STATE="$APP_DIR/state.conf"
PROFILES_DIR="$APP_DIR/profiles"
RUNTIME_DIR=/dev/shm/remnasub
UI_DIR=/etc/mihomo/ui
JOBS_DIR="$RUNTIME_DIR/jobs"
STATUS_DIR="$RUNTIME_DIR/status"
ERRORS_DIR="$RUNTIME_DIR/errors"
EVENT_LOG="$RUNTIME_DIR/events.log"
UI_STATUS="$RUNTIME_DIR/ui.status"
UI_REQUEST="$RUNTIME_DIR/ui.request"
STATE_LOCK="$RUNTIME_DIR/state.lock"
UA_CACHE="$RUNTIME_DIR/mihomo.ua"

# httpd отдаёт CGI урезанный PATH, в котором нет /usr/local/bin, поэтому путь
# к ядру задаём явно: иначе mihomo -v молча не запускался и вебка показывала
# запасную версию в User-Agent, а сохранение настроек её же и закрепляло.
MIHOMO_BIN=/usr/local/bin/mihomo
[ -x "$MIHOMO_BIN" ] || MIHOMO_BIN=$(command -v mihomo 2>/dev/null || printf 'mihomo')

mkdir -p "$JOBS_DIR" "$STATUS_DIR" "$ERRORS_DIR"

# ── Блокировка state.conf ────────────────────────────────────
# state.conf переписывается целиком (read-modify-write), поэтому два
# параллельных запроса или запрос вперемешку с entrypoint затирают правки
# друг друга. mkdir атомарен на любой ФС и не требует flock, которого может
# не быть в Buildroot-rootfs для armv5.
STATE_LOCK_HELD=0
state_lock() {
  lock_spin=0
  while ! mkdir "$STATE_LOCK" 2>/dev/null; do
    lock_spin=$((lock_spin + 1))
    if [ "$lock_spin" -gt 50 ]; then
      # Держатель умер, не сняв блокировку: сносим её и заходим сами.
      lock_started=$(cat "$STATE_LOCK/epoch" 2>/dev/null || printf '0')
      case "$lock_started" in ''|*[!0-9]*) lock_started=0 ;; esac
      if [ $(($(date +%s) - lock_started)) -gt 15 ]; then
        rm -rf "$STATE_LOCK"
      fi
      lock_spin=0
      continue
    fi
    sleep 0.1 2>/dev/null || sleep 1
  done
  STATE_LOCK_HELD=1
  date +%s > "$STATE_LOCK/epoch" 2>/dev/null || true
}

# Снимаем только свою блокировку: слепой rm сорвал бы чужую.
state_unlock() {
  [ "$STATE_LOCK_HELD" = 1 ] || return 0
  STATE_LOCK_HELD=0
  rm -rf "$STATE_LOCK" 2>/dev/null || true
}

# deny() выходит через exit, поэтому освобождение вешаем на выход из скрипта.
trap state_unlock EXIT

PERSIST_CHANGED=0
persist_file_if_changed() {
  persist_candidate="$1"
  persist_destination="$2"
  PERSIST_CHANGED=0
  if [ -f "$persist_destination" ] && cmp -s "$persist_candidate" "$persist_destination"; then
    rm -f "$persist_candidate"
    return 0
  fi
  persist_tmp="$persist_destination.tmp.$$"
  if ! cp "$persist_candidate" "$persist_tmp"; then
    rm -f "$persist_candidate" "$persist_tmp"
    return 1
  fi
  chmod 600 "$persist_tmp" 2>/dev/null || true
  if ! mv "$persist_tmp" "$persist_destination"; then
    rm -f "$persist_candidate" "$persist_tmp"
    return 1
  fi
  rm -f "$persist_candidate"
  PERSIST_CHANGED=1
}

# X-Frame-Options busybox httpd для статики не отдаёт, а frame-ancestors в
# <meta> CSP игнорируется браузером — поэтому заголовки шлют сами CGI, а
# index.html дополнительно защищён frame-buster'ом в main.js.
common_headers() {
  echo 'Cache-Control: no-store'
  echo 'X-Content-Type-Options: nosniff'
  echo 'X-Frame-Options: DENY'
  echo 'Referrer-Policy: same-origin'
}

json_headers() {
  echo 'Content-Type: application/json; charset=utf-8'
  common_headers
  echo ''
}

text_headers() {
  echo 'Content-Type: text/plain; charset=utf-8'
  common_headers
  echo ''
}

# busybox-апплет base64 дешевле форка openssl со всеми его библиотеками.
if command -v base64 >/dev/null 2>&1; then
  b64() { printf '%s' "${1:-}" | base64 | tr -d '\n'; }
  b64_decode() { printf '%s' "${1:-}" | base64 -d 2>/dev/null; }
else
  b64() { printf '%s' "${1:-}" | openssl base64 -A 2>/dev/null; }
  b64_decode() { printf '%s' "${1:-}" | openssl base64 -d -A 2>/dev/null; }
fi

# Версия ядра не меняется в пределах жизни контейнера, а вебка опрашивает
# состояние каждые 5 секунд — запускать сам бинарь mihomo на каждый опрос
# незачем. Кеш живёт в tmpfs и умирает вместе с контейнером.
default_mihomo_user_agent() {
  if [ -s "$UA_CACHE" ]; then
    cat "$UA_CACHE"
    return 0
  fi
  version=$("$MIHOMO_BIN" -v 2>/dev/null | awk 'NR == 1 && $1 == "Mihomo" && $2 == "Meta" { print $3; exit }')
  [ -n "$version" ] || version=1.19.29
  if printf 'clash.meta/%s' "$version" > "$UA_CACHE.tmp.$$" 2>/dev/null; then
    mv "$UA_CACHE.tmp.$$" "$UA_CACHE" 2>/dev/null || rm -f "$UA_CACHE.tmp.$$"
  fi
  printf 'clash.meta/%s' "$version"
}

external_ui_url() {
  case "${1:-zashboard-cdn}" in
    zashboard) printf '%s' 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip' ;;
    zashboard-cdn) printf '%s' 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip' ;;
    metacubexd) printf '%s' 'https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip' ;;
    yacd-meta) printf '%s' 'https://github.com/MetaCubeX/Yacd-meta/archive/refs/heads/gh-pages.zip' ;;
    custom) b64_decode "${2:-}" ;;
    *) return 1 ;;
  esac
}

# ── Загрузка KEY=VALUE файлов без форков ─────────────────────
# Раньше каждое обращение к ключу стоило подстановку + awk (два процесса), а
# один GET читал их под сотню. Теперь файл читается один раз циклом
# встроенного read, а ключи становятся обычными переменными с префиксом.
# Имя ключа фильтруется по charset, поэтому export не может создать ничего
# кроме нормальной переменной — eval здесь не нужен.
conf_load() {
  conf_prefix="$1"
  conf_path="$2"
  [ -f "$conf_path" ] || return 0
  # Строка режется подстановками, а не через IFS='=': read с таким IFS
  # съедает одиночный '=' в конце значения, то есть padding base64. Из-за
  # этого URL подписки длиной, кратной 3 с остатком 2, декодировался
  # обрезанным, и сервер отвечал 401.
  while IFS= read -r conf_line || [ -n "$conf_line" ]; do
    case "$conf_line" in *=*) ;; *) continue ;; esac
    conf_key=${conf_line%%=*}
    conf_value=${conf_line#*=}
    case "$conf_key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    export "$conf_prefix$conf_key=$conf_value"
  done < "$conf_path"
}

valid_number() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# Приватный ключ age. У обычного получателя префикс AGE-SECRET-KEY-1, у
# постквантового (age1pq1) — AGE-SECRET-KEY-PQ-1; тело в обоих случаях
# Bech32 в верхнем регистре.
valid_age_key() {
  case "${1:-}" in
    'AGE-SECRET-KEY-1'*|'AGE-SECRET-KEY-PQ-1'*) ;;
    *) return 1 ;;
  esac
  case "${1#AGE-SECRET-KEY-}" in
    ''|*[!A-Z0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

valid_profile_id() {
  case "${1:-}" in
    p-*) ;;
    *) return 1 ;;
  esac
  case "${1#p-}" in
    ''|*[!0-9A-Za-z_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

profile_file() {
  valid_profile_id "${1:-}" || return 1
  printf '%s/%s.conf' "$PROFILES_DIR" "$1"
}

# state.conf → ST_*
state_load() {
  ST_ACTIVE_PROFILE_ID= ST_RUN_ENABLED= ST_GLOBAL_HEADERS_B64= ST_LISTENER_MODE=
  ST_REDIR_PORT= ST_TPROXY_PORT= ST_MIHOMO_FIND_PROCESS_MODE= ST_MIHOMO_LOG_LEVEL=
  ST_MIHOMO_IPV6= ST_MIHOMO_STORE_SELECTED= ST_MIHOMO_STORE_FAKE_IP=
  ST_MIHOMO_SNIFFER_OVERRIDE= ST_MIHOMO_SNIFFER_ENABLE=
  ST_MIHOMO_SNIFFER_FORCE_DNS_MAPPING= ST_MIHOMO_SNIFFER_PARSE_PURE_IP=
  ST_MIHOMO_SNIFFER_OVERRIDE_DESTINATION= ST_MIHOMO_SNIFFER_QUIC_PORTS_B64=
  ST_MIHOMO_SNIFFER_TLS_PORTS_B64= ST_MIHOMO_SNIFFER_HTTP_PORTS_B64=
  ST_MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION= ST_MIHOMO_SNIFFER_FORCE_DOMAIN_B64=
  ST_MIHOMO_SNIFFER_SKIP_DOMAIN_B64= ST_MIHOMO_SNIFFER_SKIP_SRC_ADDRESS_B64=
  ST_MIHOMO_SNIFFER_SKIP_DST_ADDRESS_B64= ST_EXTERNAL_UI_PRESET= ST_EXTERNAL_UI_URL_B64=
  ST_EXTERNAL_UI_SECRET_B64= ST_NETWORK_DISABLE_IPV6= ST_NETWORK_QDISC=
  ST_NETWORK_DISABLE_MULTICAST= ST_NETWORK_CT_ESTABLISHED= ST_NETWORK_CT_SYN_SENT=
  ST_NETWORK_CT_SYN_RECV= ST_NETWORK_CT_FIN_WAIT= ST_NETWORK_CT_CLOSE_WAIT=
  ST_NETWORK_CT_LAST_ACK= ST_NETWORK_CT_TIME_WAIT= ST_NETWORK_CT_CLOSE=
  ST_NETWORK_CT_UNACKNOWLEDGED= ST_NETWORK_CT_UDP_STREAM=
  ST_WEB_THEME= ST_WEB_ACCENT=
  conf_load ST_ "$STATE"
  : "${ST_RUN_ENABLED:=0}" "${ST_LISTENER_MODE:=auto}"
  : "${ST_REDIR_PORT:=12345}" "${ST_TPROXY_PORT:=12346}"
  : "${ST_MIHOMO_FIND_PROCESS_MODE:=off}" "${ST_MIHOMO_LOG_LEVEL:=warning}"
  : "${ST_MIHOMO_IPV6:=0}" "${ST_MIHOMO_STORE_SELECTED:=1}" "${ST_MIHOMO_STORE_FAKE_IP:=0}"
  : "${ST_MIHOMO_SNIFFER_OVERRIDE:=0}" "${ST_MIHOMO_SNIFFER_ENABLE:=0}"
  : "${ST_MIHOMO_SNIFFER_FORCE_DNS_MAPPING:=0}" "${ST_MIHOMO_SNIFFER_PARSE_PURE_IP:=0}"
  : "${ST_MIHOMO_SNIFFER_OVERRIDE_DESTINATION:=0}"
  : "${ST_MIHOMO_SNIFFER_HTTP_PORTS_B64:=ODAKODA4MC04ODgw}"
  : "${ST_MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION:=1}"
  : "${ST_EXTERNAL_UI_PRESET:=zashboard-cdn}"
  : "${ST_NETWORK_DISABLE_IPV6:=1}" "${ST_NETWORK_QDISC:=fq_codel}"
  : "${ST_NETWORK_DISABLE_MULTICAST:=1}"
  : "${ST_NETWORK_CT_ESTABLISHED:=86400}" "${ST_NETWORK_CT_SYN_SENT:=5}"
  : "${ST_NETWORK_CT_SYN_RECV:=5}" "${ST_NETWORK_CT_FIN_WAIT:=10}"
  : "${ST_NETWORK_CT_CLOSE_WAIT:=10}" "${ST_NETWORK_CT_LAST_ACK:=10}"
  : "${ST_NETWORK_CT_TIME_WAIT:=10}" "${ST_NETWORK_CT_CLOSE:=10}"
  : "${ST_NETWORK_CT_UNACKNOWLEDGED:=300}" "${ST_NETWORK_CT_UDP_STREAM:=180}"
  : "${ST_WEB_THEME:=auto}"
  case "$ST_WEB_THEME" in auto|dark|light|graphite|midnight|forest|sepia) ;; *) ST_WEB_THEME=auto ;; esac
  # Акцент отдаётся в JSON голой строкой, поэтому пропускаем только #rrggbb.
  case "$ST_WEB_ACCENT" in
    '') ;;
    '#'[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
    *) ST_WEB_ACCENT= ;;
  esac
  case "$ST_MIHOMO_SNIFFER_OVERRIDE" in 0|1) ;; *) ST_MIHOMO_SNIFFER_OVERRIDE=0 ;; esac
}

# <profile>.conf → P_*
profile_load() {
  P_PROFILE_VERSION= P_NAME_B64= P_SUB_URL_B64= P_SUB_HEADERS_B64=
  P_LOCAL_OVERRIDE_ENABLED= P_LOCAL_OVERRIDE_B64= P_LOCAL_FIND_PROCESS_MODE=
  P_LOCAL_LOG_LEVEL= P_LOCAL_IPV6= P_LOCAL_STORE_SELECTED= P_LOCAL_STORE_FAKE_IP=
  P_LOCAL_SNIFFER_MODE= P_SUB_USE_PROVIDER_TITLE= P_SUB_USE_PROVIDER_INTERVAL=
  P_SUB_REFRESH_SECONDS= P_SUB_TIMEOUT_SECONDS= P_SUB_INSECURE_TLS=
  P_SUB_AGE_KEY_B64=
  conf_load P_ "$1"
  : "${P_LOCAL_FIND_PROCESS_MODE:=inherit}" "${P_LOCAL_LOG_LEVEL:=inherit}"
  : "${P_LOCAL_IPV6:=inherit}" "${P_LOCAL_STORE_SELECTED:=inherit}"
  : "${P_LOCAL_STORE_FAKE_IP:=inherit}" "${P_LOCAL_SNIFFER_MODE:=inherit}"
  : "${P_SUB_USE_PROVIDER_TITLE:=1}" "${P_SUB_USE_PROVIDER_INTERVAL:=1}"
  : "${P_SUB_REFRESH_SECONDS:=3600}" "${P_SUB_TIMEOUT_SECONDS:=30}"
  : "${P_SUB_INSECURE_TLS:=0}"
  # Профили старых версий не знали про выключатель — считаем его включённым,
  # если сам YAML-оверрайд непустой.
  if [ -z "$P_LOCAL_OVERRIDE_ENABLED" ]; then
    if [ -n "$P_LOCAL_OVERRIDE_B64" ]; then P_LOCAL_OVERRIDE_ENABLED=1; else P_LOCAL_OVERRIDE_ENABLED=0; fi
  fi
  case "$P_LOCAL_OVERRIDE_ENABLED" in 0|1) ;; *) P_LOCAL_OVERRIDE_ENABLED=0 ;; esac
}

# <profile>.source.meta → M_*
meta_load() {
  M_fetched_at= M_fetched_epoch= M_bytes= M_http_status= M_http_status_line_b64=
  M_configuration_valid= M_validation_b64= M_provider_title_b64=
  M_provider_refresh_seconds= M_subscription_userinfo_b64= M_profile_web_page_url_b64=
  M_support_url_b64= M_subscription_refill_date_b64= M_announce_b64=
  M_zero_vless_count= M_zero_vless_entries_b64=
  conf_load M_ "$1"
  : "${M_configuration_valid:=unknown}" "${M_fetched_epoch:=0}" "${M_zero_vless_count:=0}"
  valid_number "$M_fetched_epoch" || M_fetched_epoch=0
  valid_number "$M_zero_vless_count" || M_zero_vless_count=0
  valid_number "$M_provider_refresh_seconds" || M_provider_refresh_seconds=
  # Статус приходит из HTTP-ответа стороннего сервера и уезжает в JSON голой
  # строкой — пускаем наружу только три цифры.
  case "$M_http_status" in
    [0-9][0-9][0-9]) ;;
    *) M_http_status= ;;
  esac
  case "$M_configuration_valid" in 0|1|pending|unknown) ;; *) M_configuration_valid=unknown ;; esac
}

# status/<profile>.conf → S_*
status_load() {
  S_STATE= S_STAGE= S_ACTION= S_STARTED_EPOCH= S_FINISHED_EPOCH= S_HTTP_STATUS=
  S_HTTP_STATUS_LINE_B64= S_BYTES= S_MESSAGE_B64= S_VALIDATION_B64=
  conf_load S_ "$STATUS_DIR/$1.conf"
  : "${S_STATE:=idle}" "${S_STAGE:=idle}" "${S_BYTES:=0}"
  : "${S_STARTED_EPOCH:=0}" "${S_FINISHED_EPOCH:=0}"
  valid_number "$S_BYTES" || S_BYTES=0
  valid_number "$S_STARTED_EPOCH" || S_STARTED_EPOCH=0
  valid_number "$S_FINISHED_EPOCH" || S_FINISHED_EPOCH=0
  case "$S_STATE" in idle|queued|running|ready|error) ;; *) S_STATE=idle ;; esac
  case "$S_STAGE" in idle|queued|downloading|validating|building|download|ready) ;; *) S_STAGE=idle ;; esac
  case "$S_ACTION" in ''|fetch|rebuild) ;; *) S_ACTION= ;; esac
  case "$S_HTTP_STATUS" in [0-9][0-9][0-9]) ;; *) S_HTTP_STATUS= ;; esac
}

queue_profile_job() {
  queue_id="$1" queue_action="$2" queue_reason="${3:-web request}"
  valid_profile_id "$queue_id" || return 1
  [ -f "$PROFILES_DIR/$queue_id.conf" ] || return 1
  case "$queue_action" in fetch|rebuild) ;; *) return 1 ;; esac
  queue_file="$JOBS_DIR/$queue_id.request"
  queue_existing=
  if [ -f "$queue_file" ]; then
    while IFS= read -r queue_line || [ -n "$queue_line" ]; do
      case "$queue_line" in ACTION=*) queue_existing=${queue_line#*=}; break ;; esac
    done < "$queue_file"
  fi
  [ "$queue_existing" != fetch ] || queue_action=fetch
  status_load "$queue_id"
  queue_tmp="$queue_file.tmp.$$"
  umask 077
  {
    printf 'ACTION=%s\n' "$queue_action"
    printf 'REQUESTED_EPOCH=%s\n' "$(date +%s)"
    printf 'REASON_B64=%s\n' "$(b64 "$queue_reason")"
  } > "$queue_tmp"
  mv "$queue_tmp" "$queue_file"
  status_tmp="$STATUS_DIR/$queue_id.conf.tmp.$$"
  {
    printf 'STATE=queued\n'
    printf 'STAGE=queued\n'
    printf 'ACTION=%s\n' "$queue_action"
    printf 'STARTED_EPOCH=0\n'
    printf 'FINISHED_EPOCH=0\n'
    printf 'HTTP_STATUS=%s\n' "$S_HTTP_STATUS"
    printf 'HTTP_STATUS_LINE_B64=%s\n' "$S_HTTP_STATUS_LINE_B64"
    printf 'BYTES=%s\n' "$S_BYTES"
    printf 'MESSAGE_B64=%s\n' "$(b64 'Задание поставлено в очередь')"
    printf 'VALIDATION_B64=\n'
  } > "$status_tmp"
  mv "$status_tmp" "$STATUS_DIR/$queue_id.conf"
}

queue_panel_update() {
  queue_tmp="$UI_REQUEST.tmp.$$"
  umask 077
  printf 'REQUESTED_EPOCH=%s\n' "$(date +%s)" > "$queue_tmp"
  mv "$queue_tmp" "$UI_REQUEST"
}

first_profile_id() {
  for first_profile_path in "$PROFILES_DIR"/p-*.conf; do
    [ -f "$first_profile_path" ] || continue
    first_profile_value=${first_profile_path##*/}
    first_profile_value=${first_profile_value%.conf}
    [ "$first_profile_value" = p-default ] && continue
    valid_profile_id "$first_profile_value" || continue
    printf '%s' "$first_profile_value"
    return 0
  done
  return 1
}

state_load
ACTIVE_PROFILE_ID="$ST_ACTIVE_PROFILE_ID"
if ! valid_profile_id "$ACTIVE_PROFILE_ID" || [ ! -f "$PROFILES_DIR/$ACTIVE_PROFILE_ID.conf" ]; then
  ACTIVE_PROFILE_ID=$(first_profile_id 2>/dev/null || true)
fi
PROFILE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.conf"
SOURCE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.source.yaml"
FINAL="$RUNTIME_DIR/$ACTIVE_PROFILE_ID.config.yaml"
META="$PROFILES_DIR/$ACTIVE_PROFILE_ID.source.meta"
ERROR_FILE="$ERRORS_DIR/$ACTIVE_PROFILE_ID.txt"

# %-декодирование стоит два форка, но подавляющее большинство полей формы —
# числа и слова из белых списков case, в которых декодировать нечего.
url_decode() {
  case "${1:-}" in
    *%*|*+*) printf '%b' "$(printf '%s' "$1" | sed 's/+/ /g; s/%/\\x/g')" ;;
    *) printf '%s' "${1:-}" ;;
  esac
}

# Разбор тела формы идёт только на подстановках оболочки: раньше каждое из
# ~40 полей save-settings поднимало printf + tr + подоболочку с while.
form_value() {
  form_wanted="$1"
  form_rest="${FORM_BODY:-}"
  while [ -n "$form_rest" ]; do
    case "$form_rest" in
      *'&'*) form_pair="${form_rest%%&*}"; form_rest="${form_rest#*&}" ;;
      *) form_pair="$form_rest"; form_rest= ;;
    esac
    case "$form_pair" in
      "$form_wanted"=*) url_decode "${form_pair#*=}"; return 0 ;;
      "$form_wanted") return 0 ;;
    esac
  done
}

load_form() {
  valid_number "${CONTENT_LENGTH:-0}" || deny 'invalid request length'
  [ "${CONTENT_LENGTH:-0}" -le 65536 ] || deny 'request is too large'
  FORM_BODY=$(head -c "${CONTENT_LENGTH:-0}")
}

same_origin_post() {
  [ "${REQUEST_METHOD:-GET}" = POST ] || return 1
  host="${HTTP_HOST:-}"
  origin="${HTTP_ORIGIN:-}"
  ref="${HTTP_REFERER:-}"
  if [ -n "$origin" ]; then
    case "$origin" in "http://$host"|"https://$host") return 0 ;; esac
    return 1
  fi
  case "$ref" in "http://$host/"*|"https://$host/"*) return 0 ;; esac
  return 1
}

deny() {
  json_headers
  printf '{"ok":false,"error":"%s"}\n' "${1:-request denied}"
  exit 0
}

require_post() { same_origin_post || deny 'same-origin POST required'; }
