#!/bin/sh
set -u

log() { echo "[$(date +'%H:%M:%S')] $*"; }

MIHOMO_DIR=/etc/mihomo
APP_DIR="$MIHOMO_DIR/remnasub"
# state.conf belongs to the container; profiles/ contains independently editable subscriptions.
STATE="$APP_DIR/state.conf"
PROFILES_DIR="$APP_DIR/profiles"
LEGACY_PROFILE="$APP_DIR/profile.conf"
PROFILE=
SOURCE=
META=
ERROR_FILE=
RUNTIME_DIR=/dev/shm/remnasub
NETWORK_SIGNATURE_FILE="$RUNTIME_DIR/network.signature"
FINAL="$RUNTIME_DIR/config.yaml"
UI_DIR="$MIHOMO_DIR/ui"
WEB_ROOT=/www
WEBROOT=/dev/shm/web
HTTPD_CONF=/etc/httpd.conf

BASIC_AUTH_HASH_DEFAULT='$1$mihomors$BipEGg3TOdgaQSFfGtisO1'
BASIC_AUTH="${BASIC_AUTH:-on}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"
BASIC_AUTH_HASH="${BASIC_AUTH_HASH:-$BASIC_AUTH_HASH_DEFAULT}"

mkdir -p "$APP_DIR" "$PROFILES_DIR" "$RUNTIME_DIR"

valid_number() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

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

first_profile_id() {
  for profile_file_path in "$PROFILES_DIR"/p-*.conf; do
    [ -f "$profile_file_path" ] || continue
    profile_file_id=${profile_file_path##*/}
    profile_file_id=${profile_file_id%.conf}
    [ "$profile_file_id" = p-default ] && continue
    valid_profile_id "$profile_file_id" || continue
    printf '%s' "$profile_file_id"
    return 0
  done
  return 1
}

new_profile_id() {
  profile_id_base="p-$(date +%s)"
  profile_id_candidate=$profile_id_base
  profile_id_suffix=1
  while [ -e "$PROFILES_DIR/$profile_id_candidate.conf" ]; do
    profile_id_candidate="$profile_id_base-$profile_id_suffix"
    profile_id_suffix=$((profile_id_suffix + 1))
  done
  printf '%s' "$profile_id_candidate"
}

ensure_profile_name() {
  profile_name_file="$1"
  grep -q '^NAME_B64=' "$profile_name_file" 2>/dev/null && return 0
  profile_name_b64=$(printf '%s' 'Новая подписка' | openssl base64 -A 2>/dev/null)
  printf '\nNAME_B64=%s\n' "$profile_name_b64" >> "$profile_name_file"
}

create_empty_profile() {
  profile_create_id="$1"
  profile_create_path="$PROFILES_DIR/$profile_create_id.conf"
  profile_create_name=$(printf '%s' 'Новая подписка' | openssl base64 -A 2>/dev/null)
  umask 077
  cat > "$profile_create_path" <<EOF
PROFILE_VERSION=2
NAME_B64=$profile_create_name
SUB_URL_B64=
SUB_HEADERS_B64=
LOCAL_OVERRIDE_ENABLED=0
LOCAL_OVERRIDE_B64=
LOCAL_FIND_PROCESS_MODE=inherit
LOCAL_LOG_LEVEL=inherit
LOCAL_IPV6=inherit
LOCAL_STORE_SELECTED=inherit
LOCAL_STORE_FAKE_IP=inherit
LOCAL_SNIFFER_MODE=inherit
SUB_USE_PROVIDER_TITLE=1
SUB_USE_PROVIDER_INTERVAL=1
SUB_REFRESH_SECONDS=3600
SUB_TIMEOUT_SECONDS=30
SUB_INSECURE_TLS=0
EOF
  chmod 600 "$profile_create_path" 2>/dev/null || true
}

replace_state_active_profile() {
  replacement_id="$1"
  [ -f "$STATE" ] || return 0
  replacement_tmp="$STATE.tmp.$$"
  awk -F= -v id="$replacement_id" '
    BEGIN { replaced=0 }
    $1 == "ACTIVE_PROFILE_ID" { print "ACTIVE_PROFILE_ID=" id; replaced=1; next }
    { print }
    END { if (!replaced) print "ACTIVE_PROFILE_ID=" id }
  ' "$STATE" > "$replacement_tmp"
  chmod 600 "$replacement_tmp" 2>/dev/null || true
  mv "$replacement_tmp" "$STATE"
}

disable_state_runtime() {
  [ -f "$STATE" ] || return 0
  runtime_tmp="$STATE.tmp.$$"
  awk -F= '
    BEGIN { replaced=0 }
    $1 == "RUN_ENABLED" { print "RUN_ENABLED=0"; replaced=1; next }
    { print }
    END { if (!replaced) print "RUN_ENABLED=0" }
  ' "$STATE" > "$runtime_tmp"
  chmod 600 "$runtime_tmp" 2>/dev/null || true
  mv "$runtime_tmp" "$STATE"
}

move_profile_bundle() {
  old_profile_id="$1" new_profile_id_value="$2"
  [ -f "$PROFILES_DIR/$old_profile_id.conf" ] || return 1
  mv "$PROFILES_DIR/$old_profile_id.conf" "$PROFILES_DIR/$new_profile_id_value.conf"
  for profile_suffix in source.yaml source.meta error.txt; do
    [ -e "$PROFILES_DIR/$old_profile_id.$profile_suffix" ] || continue
    mv "$PROFILES_DIR/$old_profile_id.$profile_suffix" "$PROFILES_DIR/$new_profile_id_value.$profile_suffix"
  done
  [ ! -e "$RUNTIME_DIR/$old_profile_id.config.yaml" ] || mv "$RUNTIME_DIR/$old_profile_id.config.yaml" "$RUNTIME_DIR/$new_profile_id_value.config.yaml"
  ensure_profile_name "$PROFILES_DIR/$new_profile_id_value.conf"
}

migrate_profile_storage() {
  if [ -f "$PROFILES_DIR/p-default.conf" ]; then
    migrated_id=$(new_profile_id)
    move_profile_bundle p-default "$migrated_id"
    current_active=$(awk -F= '$1 == "ACTIVE_PROFILE_ID" { print $2; exit }' "$STATE" 2>/dev/null || true)
    [ "$current_active" != p-default ] || replace_state_active_profile "$migrated_id"
    log "profile p-default migrated to $migrated_id"
  fi

  if ! first_profile_id >/dev/null 2>&1 && [ -f "$LEGACY_PROFILE" ]; then
    migrated_id=$(new_profile_id)
    mv "$LEGACY_PROFILE" "$PROFILES_DIR/$migrated_id.conf"
    ensure_profile_name "$PROFILES_DIR/$migrated_id.conf"
    replace_state_active_profile "$migrated_id"
    log "legacy profile migrated to $migrated_id"
  fi
}

seed_state() {
  initial_profile_id="$1"
  [ -f "$STATE" ] && return 0
  cat > "$STATE" <<EOF
STATE_VERSION=5
ACTIVE_PROFILE_ID=$initial_profile_id
RUN_ENABLED=0
GLOBAL_HEADERS_B64=
LISTENER_MODE=auto
REDIR_PORT=12345
TPROXY_PORT=12346
MIHOMO_FIND_PROCESS_MODE=off
MIHOMO_LOG_LEVEL=warning
MIHOMO_IPV6=0
MIHOMO_STORE_SELECTED=1
MIHOMO_STORE_FAKE_IP=0
MIHOMO_SNIFFER_OVERRIDE=0
MIHOMO_SNIFFER_ENABLE=0
MIHOMO_SNIFFER_FORCE_DNS_MAPPING=0
MIHOMO_SNIFFER_PARSE_PURE_IP=0
MIHOMO_SNIFFER_OVERRIDE_DESTINATION=0
MIHOMO_SNIFFER_QUIC_PORTS_B64=
MIHOMO_SNIFFER_TLS_PORTS_B64=
MIHOMO_SNIFFER_HTTP_PORTS_B64=ODAKODA4MC04ODgw
MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION=1
MIHOMO_SNIFFER_FORCE_DOMAIN_B64=
MIHOMO_SNIFFER_SKIP_DOMAIN_B64=
MIHOMO_SNIFFER_SKIP_SRC_ADDRESS_B64=
MIHOMO_SNIFFER_SKIP_DST_ADDRESS_B64=
EXTERNAL_UI_PRESET=zashboard-cdn
EXTERNAL_UI_URL_B64=
EXTERNAL_UI_SECRET_B64=
NETWORK_DISABLE_IPV6=1
NETWORK_QDISC=fq_codel
NETWORK_DISABLE_MULTICAST=1
NETWORK_CT_ESTABLISHED=86400
NETWORK_CT_SYN_SENT=5
NETWORK_CT_SYN_RECV=5
NETWORK_CT_FIN_WAIT=10
NETWORK_CT_CLOSE_WAIT=10
NETWORK_CT_LAST_ACK=10
NETWORK_CT_TIME_WAIT=10
NETWORK_CT_CLOSE=10
NETWORK_CT_UNACKNOWLEDGED=300
NETWORK_CT_UDP_STREAM=180
EOF
  chmod 600 "$STATE" 2>/dev/null || true
}

initialize_storage() {
  migrate_profile_storage
  initial_profile_created=0
  initial_profile_id=$(first_profile_id 2>/dev/null || true)
  if [ -z "$initial_profile_id" ]; then
    initial_profile_id=$(new_profile_id)
    create_empty_profile "$initial_profile_id"
    initial_profile_created=1
    log "created initial profile $initial_profile_id"
  fi
  ensure_profile_name "$PROFILES_DIR/$initial_profile_id.conf"
  seed_state "$initial_profile_id"
  configured_active=$(awk -F= '$1 == "ACTIVE_PROFILE_ID" { print $2; exit }' "$STATE" 2>/dev/null || true)
  if ! valid_profile_id "$configured_active" || [ ! -f "$PROFILES_DIR/$configured_active.conf" ]; then
    replace_state_active_profile "$initial_profile_id"
  fi
  [ "$initial_profile_created" = 0 ] || disable_state_runtime
}

initialize_storage

load_state() {
  ACTIVE_PROFILE_ID=$(first_profile_id 2>/dev/null || true)
  RUN_ENABLED=0
  GLOBAL_HEADERS_B64=
  LISTENER_MODE=auto
  REDIR_PORT=12345 TPROXY_PORT=12346
  MIHOMO_FIND_PROCESS_MODE=off MIHOMO_LOG_LEVEL=warning MIHOMO_IPV6=0
  MIHOMO_STORE_SELECTED=1 MIHOMO_STORE_FAKE_IP=0
  MIHOMO_SNIFFER_MODE=source MIHOMO_SNIFFER_OVERRIDE=0 MIHOMO_SNIFFER_ENABLE=0
  MIHOMO_SNIFFER_FORCE_DNS_MAPPING=0 MIHOMO_SNIFFER_PARSE_PURE_IP=0 MIHOMO_SNIFFER_OVERRIDE_DESTINATION=0
  MIHOMO_SNIFFER_QUIC_PORTS_B64= MIHOMO_SNIFFER_TLS_PORTS_B64= MIHOMO_SNIFFER_HTTP_PORTS_B64=ODAKODA4MC04ODgw
  MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION=1 MIHOMO_SNIFFER_FORCE_DOMAIN_B64=
  MIHOMO_SNIFFER_SKIP_DOMAIN_B64= MIHOMO_SNIFFER_SKIP_SRC_ADDRESS_B64= MIHOMO_SNIFFER_SKIP_DST_ADDRESS_B64=
  EXTERNAL_UI_PRESET=zashboard-cdn EXTERNAL_UI_URL_B64= EXTERNAL_UI_SECRET_B64=
  NETWORK_DISABLE_IPV6=1 NETWORK_QDISC=fq_codel NETWORK_DISABLE_MULTICAST=1
  NETWORK_CT_ESTABLISHED=86400 NETWORK_CT_SYN_SENT=5 NETWORK_CT_SYN_RECV=5
  NETWORK_CT_FIN_WAIT=10 NETWORK_CT_CLOSE_WAIT=10 NETWORK_CT_LAST_ACK=10
  NETWORK_CT_TIME_WAIT=10 NETWORK_CT_CLOSE=10 NETWORK_CT_UNACKNOWLEDGED=300
  NETWORK_CT_UDP_STREAM=180
  while IFS='=' read -r key value; do
    case "$key" in
      ACTIVE_PROFILE_ID|RUN_ENABLED|GLOBAL_HEADERS_B64|LISTENER_MODE|REDIR_PORT|TPROXY_PORT|MIHOMO_FIND_PROCESS_MODE|MIHOMO_LOG_LEVEL|MIHOMO_IPV6|MIHOMO_STORE_SELECTED|MIHOMO_STORE_FAKE_IP|MIHOMO_SNIFFER_MODE|MIHOMO_SNIFFER_OVERRIDE|MIHOMO_SNIFFER_ENABLE|MIHOMO_SNIFFER_FORCE_DNS_MAPPING|MIHOMO_SNIFFER_PARSE_PURE_IP|MIHOMO_SNIFFER_OVERRIDE_DESTINATION|MIHOMO_SNIFFER_QUIC_PORTS_B64|MIHOMO_SNIFFER_TLS_PORTS_B64|MIHOMO_SNIFFER_HTTP_PORTS_B64|MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION|MIHOMO_SNIFFER_FORCE_DOMAIN_B64|MIHOMO_SNIFFER_SKIP_DOMAIN_B64|MIHOMO_SNIFFER_SKIP_SRC_ADDRESS_B64|MIHOMO_SNIFFER_SKIP_DST_ADDRESS_B64|EXTERNAL_UI_PRESET|EXTERNAL_UI_URL_B64|EXTERNAL_UI_SECRET_B64|NETWORK_DISABLE_IPV6|NETWORK_QDISC|NETWORK_DISABLE_MULTICAST|NETWORK_CT_ESTABLISHED|NETWORK_CT_SYN_SENT|NETWORK_CT_SYN_RECV|NETWORK_CT_FIN_WAIT|NETWORK_CT_CLOSE_WAIT|NETWORK_CT_LAST_ACK|NETWORK_CT_TIME_WAIT|NETWORK_CT_CLOSE|NETWORK_CT_UNACKNOWLEDGED|NETWORK_CT_UDP_STREAM)
        export "$key=$value"
        ;;
    esac
  done < "$STATE"
  case "$RUN_ENABLED" in 0|1) ;; *) RUN_ENABLED=0 ;; esac
  case "$NETWORK_DISABLE_IPV6" in 0|1) ;; *) NETWORK_DISABLE_IPV6=1 ;; esac
  case "$NETWORK_DISABLE_MULTICAST" in 0|1) ;; *) NETWORK_DISABLE_MULTICAST=1 ;; esac
  case "$NETWORK_QDISC" in fq_codel|cake|codel|sfq|pfifo|bfifo|system) ;; *) NETWORK_QDISC=fq_codel ;; esac
  case "$MIHOMO_FIND_PROCESS_MODE" in off|strict|always) ;; *) MIHOMO_FIND_PROCESS_MODE=off ;; esac
  case "$MIHOMO_LOG_LEVEL" in silent|error|warning|info|debug) ;; *) MIHOMO_LOG_LEVEL=warning ;; esac
  case "$MIHOMO_IPV6:$MIHOMO_STORE_SELECTED:$MIHOMO_STORE_FAKE_IP" in [01]:[01]:[01]) ;; *) MIHOMO_IPV6=0 MIHOMO_STORE_SELECTED=1 MIHOMO_STORE_FAKE_IP=0 ;; esac
  case "$MIHOMO_SNIFFER_OVERRIDE:$MIHOMO_SNIFFER_ENABLE:$MIHOMO_SNIFFER_FORCE_DNS_MAPPING:$MIHOMO_SNIFFER_PARSE_PURE_IP:$MIHOMO_SNIFFER_OVERRIDE_DESTINATION:$MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION" in
    [01]:[01]:[01]:[01]:[01]:[01]) ;;
    *) MIHOMO_SNIFFER_OVERRIDE=0 MIHOMO_SNIFFER_ENABLE=0 MIHOMO_SNIFFER_FORCE_DNS_MAPPING=0 MIHOMO_SNIFFER_PARSE_PURE_IP=0 MIHOMO_SNIFFER_OVERRIDE_DESTINATION=0 MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION=1 ;;
  esac
  valid_number "$NETWORK_CT_ESTABLISHED" || NETWORK_CT_ESTABLISHED=86400
  valid_number "$NETWORK_CT_SYN_SENT" || NETWORK_CT_SYN_SENT=5
  valid_number "$NETWORK_CT_SYN_RECV" || NETWORK_CT_SYN_RECV=5
  valid_number "$NETWORK_CT_FIN_WAIT" || NETWORK_CT_FIN_WAIT=10
  valid_number "$NETWORK_CT_CLOSE_WAIT" || NETWORK_CT_CLOSE_WAIT=10
  valid_number "$NETWORK_CT_LAST_ACK" || NETWORK_CT_LAST_ACK=10
  valid_number "$NETWORK_CT_TIME_WAIT" || NETWORK_CT_TIME_WAIT=10
  valid_number "$NETWORK_CT_CLOSE" || NETWORK_CT_CLOSE=10
  valid_number "$NETWORK_CT_UNACKNOWLEDGED" || NETWORK_CT_UNACKNOWLEDGED=300
  valid_number "$NETWORK_CT_UDP_STREAM" || NETWORK_CT_UDP_STREAM=180
  if ! valid_profile_id "$ACTIVE_PROFILE_ID" || [ ! -f "$PROFILES_DIR/$ACTIVE_PROFILE_ID.conf" ]; then
    ACTIVE_PROFILE_ID=$(first_profile_id 2>/dev/null || true)
  fi
  PROFILE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.conf"
  SOURCE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.source.yaml"
  META="$PROFILES_DIR/$ACTIVE_PROFILE_ID.source.meta"
  ERROR_FILE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.error.txt"
  FINAL="$RUNTIME_DIR/$ACTIVE_PROFILE_ID.config.yaml"
}

setup_auth() {
  : > "$HTTPD_CONF" || return 1
  chmod 600 "$HTTPD_CONF" 2>/dev/null || true
  if [ "$BASIC_AUTH" != "off" ]; then
    printf '/:%s:%s\n' "$BASIC_AUTH_USER" "$BASIC_AUTH_HASH" >> "$HTTPD_CONF"
    log "web basic auth enabled for '$BASIC_AUTH_USER'"
  else
    log "WARNING: web basic auth is disabled"
  fi
}

build_webroot() {
  mount -o remount,exec /dev/shm 2>/dev/null || true
  rm -rf "$WEBROOT"
  mkdir -p "$WEBROOT/cgi-bin" "$WEBROOT/assets"
  for file in _remna.sh remna-profile remna-status remna-config remna-refresh; do
    cp "$WEB_ROOT/cgi-bin/$file" "$WEBROOT/cgi-bin/$file"
  done
  chmod 0644 "$WEBROOT/cgi-bin/_remna.sh" 2>/dev/null || true
  chmod 0755 "$WEBROOT/cgi-bin/remna-profile" "$WEBROOT/cgi-bin/remna-status" "$WEBROOT/cgi-bin/remna-config" "$WEBROOT/cgi-bin/remna-refresh" 2>/dev/null || true
  cp "$WEB_ROOT/index.html" "$WEBROOT/index.html"
  cp "$WEB_ROOT/assets/remna.css" "$WEBROOT/assets/remna.css"
  cp "$WEB_ROOT/assets/remna.js" "$WEBROOT/assets/remna.js"
}

b64_decode_file() {
  value="$1"
  [ -n "$value" ] || return 0
  printf '%s' "$value" | openssl base64 -d -A 2>/dev/null
}

b64_encode() {
  printf '%s' "${1:-}" | openssl base64 -A 2>/dev/null
}

default_mihomo_user_agent() {
  version=$(mihomo -v 2>/dev/null | awk 'NR == 1 && $1 == "Mihomo" && $2 == "Meta" { print $3; exit }')
  [ -n "$version" ] || version=1.19.29
  printf 'clash.meta/%s' "$version"
}

effective_global_headers() {
  default_ua=$(default_mihomo_user_agent)
  b64_decode_file "$GLOBAL_HEADERS_B64" | awk -v default_ua="$default_ua" '
    BEGIN {
      count = 5
      order[1] = "x-hwid"
      order[2] = "x-device-os"
      order[3] = "x-ver-os"
      order[4] = "x-device-model"
      order[5] = "user-agent"
      fallback["x-hwid"] = "RouterOS-Solomon"
      fallback["x-device-os"] = "RouterOS"
      fallback["x-ver-os"] = "7.23.3"
      fallback["x-device-model"] = "MikroTik RB5009UG+S+IN"
      fallback["user-agent"] = default_ua
    }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ /^[[:space:]]*$/) next
      separator = index(line, ":")
      if (separator < 2) next
      key = substr(line, 1, separator - 1)
      value = substr(line, separator + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      normalized = tolower(key)
      if (normalized in fallback) {
        supplied[normalized] = value
        seen[normalized] = 1
      } else {
        custom[++custom_count] = key ": " value
      }
    }
    END {
      for (i = 1; i <= count; i++) {
        key = order[i]
        value = seen[key] && supplied[key] != "" ? supplied[key] : fallback[key]
        if (key == "user-agent" && value == "Mihomo-RemnaSub-RoS/1") value = fallback[key]
        print key ": " value
      }
      for (i = 1; i <= custom_count; i++) print custom[i]
    }
  '
}

effective_request_headers() {
  request_global="$RUNTIME_DIR/request-global.$$.headers"
  request_local="$RUNTIME_DIR/request-local.$$.headers"
  effective_global_headers > "$request_global"
  : > "$request_local"
  if [ "$LOCAL_OVERRIDE_ENABLED" = 1 ]; then
    b64_decode_file "$SUB_HEADERS_B64" > "$request_local"
  fi
  awk '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    function add(line, local, separator, key, value, normalized) {
      sub(/\r$/, "", line)
      if (line ~ /^[[:space:]]*$/) return
      separator = index(line, ":")
      if (separator < 2) return
      key = trim(substr(line, 1, separator - 1))
      value = trim(substr(line, separator + 1))
      if (key !~ /^[A-Za-z0-9-]+$/) return
      normalized = tolower(key)
      if (local && value == "" && normalized ~ /^(x-hwid|x-device-os|x-ver-os|x-device-model|user-agent)$/) return
      if (!(normalized in position)) {
        position[normalized] = ++count
        order[count] = normalized
      }
      names[normalized] = key
      values[normalized] = value
    }
    FNR == NR { add($0, 0); next }
    { add($0, 1) }
    END {
      for (i = 1; i <= count; i++) {
        normalized = order[i]
        print names[normalized] ": " values[normalized]
      }
    }
  ' "$request_global" "$request_local"
  rm -f "$request_global" "$request_local"
}

external_ui_preset_url() {
  case "$1" in
    zashboard) printf '%s' 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip' ;;
    zashboard-cdn) printf '%s' 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip' ;;
    metacubexd) printf '%s' 'https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip' ;;
    yacd-meta) printf '%s' 'https://github.com/MetaCubeX/Yacd-meta/archive/refs/heads/gh-pages.zip' ;;
    *) return 1 ;;
  esac
}

effective_external_ui_url() {
  case "$EXTERNAL_UI_PRESET" in
    custom) b64_decode_file "$EXTERNAL_UI_URL_B64" ;;
    *) external_ui_preset_url "$EXTERNAL_UI_PRESET" ;;
  esac
}

yaml_single_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

load_profile() {
  SUB_URL_B64= SUB_HEADERS_B64= LOCAL_OVERRIDE_B64=
  LOCAL_OVERRIDE_ENABLED=missing
  LOCAL_FIND_PROCESS_MODE=inherit LOCAL_LOG_LEVEL=inherit LOCAL_IPV6=inherit
  LOCAL_STORE_SELECTED=inherit LOCAL_STORE_FAKE_IP=inherit LOCAL_SNIFFER_MODE=inherit
  SUB_USE_PROVIDER_TITLE=1 SUB_USE_PROVIDER_INTERVAL=1
  SUB_REFRESH_SECONDS=3600 SUB_TIMEOUT_SECONDS=30 SUB_INSECURE_TLS=0
  # profile.conf is generated by our CGI and contains only KEY=VALUE lines.
  while IFS='=' read -r key value; do
    case "$key" in
      SUB_URL_B64|SUB_HEADERS_B64|LOCAL_OVERRIDE_ENABLED|LOCAL_OVERRIDE_B64|LOCAL_FIND_PROCESS_MODE|LOCAL_LOG_LEVEL|LOCAL_IPV6|LOCAL_STORE_SELECTED|LOCAL_STORE_FAKE_IP|LOCAL_SNIFFER_MODE|SUB_USE_PROVIDER_TITLE|SUB_USE_PROVIDER_INTERVAL|SUB_REFRESH_SECONDS|SUB_TIMEOUT_SECONDS|SUB_INSECURE_TLS)
        export "$key=$value"
        ;;
    esac
  done < "$PROFILE"
  if [ "$LOCAL_OVERRIDE_ENABLED" = missing ]; then
    [ -n "$LOCAL_OVERRIDE_B64" ] && LOCAL_OVERRIDE_ENABLED=1 || LOCAL_OVERRIDE_ENABLED=0
  fi
  case "$LOCAL_OVERRIDE_ENABLED:$SUB_USE_PROVIDER_TITLE:$SUB_USE_PROVIDER_INTERVAL" in [01]:[01]:[01]) ;; *) LOCAL_OVERRIDE_ENABLED=0 SUB_USE_PROVIDER_TITLE=1 SUB_USE_PROVIDER_INTERVAL=1 ;; esac
  case "$LOCAL_FIND_PROCESS_MODE" in inherit|off|strict|always) ;; *) LOCAL_FIND_PROCESS_MODE=inherit ;; esac
  case "$LOCAL_LOG_LEVEL" in inherit|silent|error|warning|info|debug) ;; *) LOCAL_LOG_LEVEL=inherit ;; esac
  case "$LOCAL_IPV6:$LOCAL_STORE_SELECTED:$LOCAL_STORE_FAKE_IP" in inherit:inherit:inherit|inherit:inherit:[01]|inherit:[01]:inherit|inherit:[01]:[01]|[01]:inherit:inherit|[01]:inherit:[01]|[01]:[01]:inherit|[01]:[01]:[01]) ;; *) LOCAL_IPV6=inherit LOCAL_STORE_SELECTED=inherit LOCAL_STORE_FAKE_IP=inherit ;; esac
  case "$LOCAL_SNIFFER_MODE" in inherit|source|disabled) ;; *) LOCAL_SNIFFER_MODE=inherit ;; esac
}

profile_meta_value() {
  meta_key="$1"
  awk -F= -v key="$meta_key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$META" 2>/dev/null || true
}

effective_refresh_seconds() {
  refresh="$SUB_REFRESH_SECONDS"
  valid_number "$refresh" || refresh=3600
  [ "$refresh" -ge 30 ] && [ "$refresh" -le 86400 ] || refresh=3600
  if [ "$SUB_USE_PROVIDER_INTERVAL" = 1 ]; then
    provider_refresh=$(profile_meta_value provider_refresh_seconds)
    if valid_number "$provider_refresh" && [ "$provider_refresh" -ge 30 ] && [ "$provider_refresh" -le 86400 ]; then
      refresh="$provider_refresh"
    fi
  fi
  printf '%s' "$refresh"
}

resolve_listener_mode() {
  load_state
  case "$LISTENER_MODE" in
    auto) grep -q '^nf_tables ' /proc/modules 2>/dev/null && ROUTE_MODE=redir-tproxy || ROUTE_MODE=redir-tun ;;
    redir-tun) ROUTE_MODE=redir-tun ;;
    redir-tproxy|tproxy)
      if grep -q '^nf_tables ' /proc/modules 2>/dev/null; then ROUTE_MODE="$LISTENER_MODE"; else ROUTE_MODE=redir-tun; fi
      ;;
    *) ROUTE_MODE=redir-tun ;;
  esac
}

resolve_network_interface() {
  default_iface=$(ip -4 route show default 2>/dev/null | awk '
    { for (i = 1; i <= NF; i++) if ($i == "dev" && (i + 1) <= NF) { print $(i + 1); exit } }
  ')
  if [ -n "$default_iface" ] && ip link show dev "$default_iface" >/dev/null 2>&1; then
    case "$default_iface" in lo|Meta|hs5t*) ;; *) printf '%s' "$default_iface"; return 0 ;; esac
  fi
  ip -o link show up | awk -F': ' '/link\/ether/ {
    gsub(/@.*$/, "", $2)
    if ($2 != "lo" && $2 != "Meta" && $2 !~ /^hs5t/) { print $2; exit }
  }'
}

network_signature() {
  printf '%s|' \
    "$NETWORK_DISABLE_IPV6" "$NETWORK_QDISC" "$NETWORK_DISABLE_MULTICAST" \
    "$NETWORK_CT_ESTABLISHED" "$NETWORK_CT_SYN_SENT" "$NETWORK_CT_SYN_RECV" \
    "$NETWORK_CT_FIN_WAIT" "$NETWORK_CT_CLOSE_WAIT" "$NETWORK_CT_LAST_ACK" \
    "$NETWORK_CT_TIME_WAIT" "$NETWORK_CT_CLOSE" "$NETWORK_CT_UNACKNOWLEDGED" \
    "$NETWORK_CT_UDP_STREAM"
}

apply_network_settings() {
  reset_forwarding=${1:-0}
  route_iface=$(resolve_network_interface)
  [ -n "$route_iface" ] || { log "network setup failed: no active Ethernet interface"; return 1; }
  log "network interface: $route_iface"
  NETWORK_INTERFACE="$route_iface" \
  NETWORK_RESET_IPV4_FORWARDING="$reset_forwarding" \
  NETWORK_DISABLE_IPV6="$NETWORK_DISABLE_IPV6" \
  NETWORK_QDISC="$NETWORK_QDISC" \
  NETWORK_DISABLE_MULTICAST="$NETWORK_DISABLE_MULTICAST" \
  NETWORK_CT_ESTABLISHED="$NETWORK_CT_ESTABLISHED" \
  NETWORK_CT_SYN_SENT="$NETWORK_CT_SYN_SENT" \
  NETWORK_CT_SYN_RECV="$NETWORK_CT_SYN_RECV" \
  NETWORK_CT_FIN_WAIT="$NETWORK_CT_FIN_WAIT" \
  NETWORK_CT_CLOSE_WAIT="$NETWORK_CT_CLOSE_WAIT" \
  NETWORK_CT_LAST_ACK="$NETWORK_CT_LAST_ACK" \
  NETWORK_CT_TIME_WAIT="$NETWORK_CT_TIME_WAIT" \
  NETWORK_CT_CLOSE="$NETWORK_CT_CLOSE" \
  NETWORK_CT_UNACKNOWLEDGED="$NETWORK_CT_UNACKNOWLEDGED" \
  NETWORK_CT_UDP_STREAM="$NETWORK_CT_UDP_STREAM" \
    sh "$MIHOMO_DIR/scripts/10-network-alpine.sh"
}

route_cleanup() {
  nft delete table inet mihomo 2>/dev/null || true
  nft delete table inet mihomo_forward 2>/dev/null || true
  while iptables -t nat -D PREROUTING -j MIHOMO_PREROUTING 2>/dev/null; do :; done
  iptables -t nat -F MIHOMO_PREROUTING 2>/dev/null || true
  iptables -t nat -X MIHOMO_PREROUTING 2>/dev/null || true
  while iptables -D FORWARD -j MIHOMO_FORWARD 2>/dev/null; do :; done
  iptables -F MIHOMO_FORWARD 2>/dev/null || true
  iptables -X MIHOMO_FORWARD 2>/dev/null || true
  while ip rule del fwmark 1 table 100 2>/dev/null; do :; done
  for pref in 10000 10001 10002 10003 10004 10005; do
    while ip rule del pref "$pref" 2>/dev/null; do :; done
  done
  ip route flush table 100 2>/dev/null || true
  ip route flush table 110 2>/dev/null || true
  sysctl -w net.ipv4.ip_forward=0 >/dev/null 2>&1 || true
}

route_pre_start() {
  route_iface=$(resolve_network_interface)
  [ -n "$route_iface" ] || return 1
  case "$ROUTE_MODE" in
    tproxy) ROUTE_IFACE="$route_iface" TPROXY_PORT="$TPROXY_PORT" sh "$MIHOMO_DIR/scripts/20-nft-tproxy-tcp-udp.sh" ;;
    redir-tproxy) ROUTE_IFACE="$route_iface" REDIR_PORT="$REDIR_PORT" TPROXY_PORT="$TPROXY_PORT" sh "$MIHOMO_DIR/scripts/21-nft-redir-tcp-tproxy-udp.sh.disabled" ;;
  esac
}

route_post_start() {
  route_iface=$(resolve_network_interface)
  [ -n "$route_iface" ] || return 1
  case "$ROUTE_MODE" in
    redir-tun)
      if grep -q '^nf_tables ' /proc/modules 2>/dev/null; then
        ROUTE_IFACE="$route_iface" REDIR_PORT="$REDIR_PORT" sh "$MIHOMO_DIR/scripts-post/20-nft-redir-tcp-tun-udp.sh.disabled"
      else
        ROUTE_IFACE="$route_iface" REDIR_PORT="$REDIR_PORT" sh "$MIHOMO_DIR/scripts-post/22-iptables-redir-tcp-tun-udp.sh"
      fi
      ;;
  esac
}

normalize_response_headers() {
  response_log="$1"
  response_headers="$2"
  awk '
    function trim(value) {
      sub(/\r$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    /^[[:space:]]*HTTP\/[0-9.]+[[:space:]]+[0-9][0-9][0-9]/ {
      for (key in headers) delete headers[key]
      in_response = 1
      next
    }
    in_response {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      separator = index(line, ":")
      if (separator < 2) next
      key = tolower(trim(substr(line, 1, separator - 1)))
      value = trim(substr(line, separator + 1))
      if (key ~ /^(profile-title|profile-update-interval|subscription-userinfo|profile-web-page-url|support-url|subscription-refill-date|announce)$/) {
        headers[key] = value
      }
    }
    END {
      order[1] = "profile-title"
      order[2] = "profile-update-interval"
      order[3] = "subscription-userinfo"
      order[4] = "profile-web-page-url"
      order[5] = "support-url"
      order[6] = "subscription-refill-date"
      order[7] = "announce"
      for (i = 1; i <= 7; i++) if (order[i] in headers) print order[i] "=" headers[order[i]]
    }
  ' "$response_log" > "$response_headers"
}

response_header_value() {
  response_headers="$1"
  response_key="$2"
  awk -F= -v key="$response_key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$response_headers" 2>/dev/null || true
}

decode_provider_text() {
  provider_text="$1"
  case "$provider_text" in
    base64:*)
      encoded_text=${provider_text#base64:}
      if decoded_text=$(printf '%s' "$encoded_text" | openssl base64 -d -A 2>/dev/null); then
        provider_text="$decoded_text"
      else
        provider_text=
      fi
      ;;
  esac
  printf '%s' "$provider_text" | tr -d '\r\n' | head -c 2048
}

write_source_meta() {
  response_headers="$1"
  meta_tmp="$META.tmp.$$"
  provider_title=$(decode_provider_text "$(response_header_value "$response_headers" profile-title)")
  provider_interval=$(response_header_value "$response_headers" profile-update-interval)
  case "$provider_interval" in
    ''|*[!0-9]*|????*) provider_refresh= ;;
    *) provider_refresh=$((provider_interval * 3600)) ;;
  esac
  if [ -n "$provider_refresh" ] && { [ "$provider_refresh" -lt 30 ] || [ "$provider_refresh" -gt 86400 ]; }; then
    provider_refresh=
  fi
  subscription_userinfo=$(response_header_value "$response_headers" subscription-userinfo | tr -d '\r\n' | head -c 2048)
  profile_web_page_url=$(response_header_value "$response_headers" profile-web-page-url | tr -d '\r\n' | head -c 2048)
  support_url=$(response_header_value "$response_headers" support-url | tr -d '\r\n' | head -c 2048)
  subscription_refill_date=$(response_header_value "$response_headers" subscription-refill-date | tr -d '\r\n' | head -c 512)
  announce=$(decode_provider_text "$(response_header_value "$response_headers" announce)")
  umask 077
  cat > "$meta_tmp" <<EOF
fetched_at=$(date -Iseconds)
fetched_epoch=$(date +%s)
bytes=$(wc -c < "$SOURCE")
provider_title_b64=$(b64_encode "$provider_title")
provider_refresh_seconds=$provider_refresh
subscription_userinfo_b64=$(b64_encode "$subscription_userinfo")
profile_web_page_url_b64=$(b64_encode "$profile_web_page_url")
support_url_b64=$(b64_encode "$support_url")
subscription_refill_date_b64=$(b64_encode "$subscription_refill_date")
announce_b64=$(b64_encode "$announce")
EOF
  mv "$meta_tmp" "$META"
}

fetch_source() {
  load_state
  load_profile
  url="$(b64_decode_file "$SUB_URL_B64")"
  [ -n "$url" ] || {
    rm -f "$FINAL"
    printf '%s\n' "Subscription URL is not configured" > "$ERROR_FILE"
    return 1
  }
  case "$url" in http://*|https://*) ;; *) printf '%s\n' "Subscription URL must use http(s)" > "$ERROR_FILE"; return 1 ;; esac
  valid_number "$SUB_TIMEOUT_SECONDS" || SUB_TIMEOUT_SECONDS=30
  [ "$SUB_TIMEOUT_SECONDS" -ge 3 ] && [ "$SUB_TIMEOUT_SECONDS" -le 120 ] || SUB_TIMEOUT_SECONDS=30
  tmp="$SOURCE.tmp.$$"
  response_log="$RUNTIME_DIR/wget-response.$$.log"
  response_headers="$RUNTIME_DIR/wget-response.$$.headers"
  set -- -S -T "$SUB_TIMEOUT_SECONDS" -O "$tmp"
  headers="$(effective_request_headers)"
  if [ -n "$headers" ]; then
    while IFS= read -r header; do
      [ -n "$header" ] || continue
      case "$header" in
        [Uu][Ss][Ee][Rr]-[Aa][Gg][Ee][Nn][Tt]:*)
          user_agent=${header#*:}
          user_agent=${user_agent# }
          set -- "$@" --user-agent="$user_agent"
          ;;
        *) set -- "$@" --header="$header" ;;
      esac
    done <<EOF
$headers
EOF
  fi
  [ "$SUB_INSECURE_TLS" = 1 ] && set -- "$@" --no-check-certificate
  if ! wget "$@" "$url" 2> "$response_log"; then
    rm -f "$tmp" "$response_log" "$response_headers"
    printf '%s\n' "Subscription download failed" > "$ERROR_FILE"
    return 1
  fi
  normalize_response_headers "$response_log" "$response_headers"
  rm -f "$response_log"
  [ -s "$tmp" ] || { rm -f "$tmp" "$response_headers"; printf '%s\n' "Subscription response is empty" > "$ERROR_FILE"; return 1; }
  [ "$(wc -c < "$tmp")" -le 16777216 ] || { rm -f "$tmp" "$response_headers"; printf '%s\n' "Subscription exceeds 16 MiB" > "$ERROR_FILE"; return 1; }
  if ! mihomo -t -d "$MIHOMO_DIR" -f "$tmp" >/dev/null 2>&1; then
    mv "$tmp" "$APP_DIR/invalid-source.yaml" 2>/dev/null || rm -f "$tmp"
    rm -f "$response_headers"
    printf '%s\n' "Downloaded YAML is rejected by mihomo" > "$ERROR_FILE"
    return 1
  fi
  mv "$tmp" "$SOURCE"
  write_source_meta "$response_headers"
  rm -f "$response_headers"
  rm -f "$ERROR_FILE"
  return 0
}

extract_preserved_listeners() {
  listeners_input="$1"
  awk '
    function is_top(line) { return line ~ /^[^[:space:]#][^:]*:/ }
    function indent(line, copy) {
      copy = line
      sub(/[^ ].*$/, "", copy)
      return length(copy)
    }
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      gsub(/^\047|\047$/, "", value)
      return tolower(value)
    }
    function type_from_line(line, value, start) {
      value = line
      sub(/^[[:space:]]*/, "", value)
      sub(/^-[[:space:]]*/, "", value)
      if (value ~ /^type[[:space:]]*:/) {
        sub(/^type[[:space:]]*:[[:space:]]*/, "", value)
        sub(/[[:space:]]*(#.*)?$/, "", value)
        return trim(value)
      }
      if (value ~ /^\{/) {
        start = match(value, /(^|,)[[:space:]]*type[[:space:]]*:[[:space:]]*/)
        if (start) {
          value = substr(value, RSTART + RLENGTH)
          sub(/[,}#].*$/, "", value)
          return trim(value)
        }
      }
      return ""
    }
    function flush(type) {
      if (!have_item) return
      type = item_type
      if (type != "redir" && type != "tproxy" && type != "tun") printf "%s", item
      item = ""
      item_type = ""
      have_item = 0
    }
    BEGIN { in_listeners = 0 }
    {
      if (!in_listeners) {
        if ($0 ~ /^listeners:[[:space:]]*(#.*)?$/) in_listeners = 1
        next
      }
      if (is_top($0)) {
        flush()
        exit
      }
      if ($0 ~ /^[[:space:]]*-[[:space:]]*/) {
        flush()
        have_item = 1
        item = $0 ORS
        item_indent = indent($0)
        item_type = type_from_line($0)
        next
      }
      if (have_item) {
        item = item $0 ORS
        if (item_type == "" && indent($0) == item_indent + 2) item_type = type_from_line($0)
      }
    }
    END { flush() }
  ' "$listeners_input"
}

write_listeners_overlay() {
  listeners_input="$1"
  resolve_listener_mode
  valid_number "$REDIR_PORT" || return 1
  valid_number "$TPROXY_PORT" || return 1
  [ "$REDIR_PORT" -ge 1 ] && [ "$REDIR_PORT" -le 65535 ] || return 1
  [ "$TPROXY_PORT" -ge 1 ] && [ "$TPROXY_PORT" -le 65535 ] || return 1
  [ "$ROUTE_MODE" != redir-tproxy ] || [ "$REDIR_PORT" != "$TPROXY_PORT" ] || return 1
  echo 'listeners:'
  extract_preserved_listeners "$listeners_input"
  case "$ROUTE_MODE" in
    tproxy)
      cat <<EOF
  - name: tproxy-in
    type: tproxy
    port: $TPROXY_PORT
    listen: 0.0.0.0
    udp: true
EOF
      ;;
    redir-tproxy)
      cat <<EOF
  - name: redir-in
    type: redir
    port: $REDIR_PORT
    listen: 0.0.0.0
  - name: tproxy-in
    type: tproxy
    port: $TPROXY_PORT
    listen: 0.0.0.0
    udp: true
EOF
      ;;
    redir-tun)
      cat <<EOF
  - name: redir-in
    type: redir
    port: $REDIR_PORT
    listen: 0.0.0.0
  - name: tun-in
    type: tun
    device: Meta
    inet4-address:
      - 100.64.0.1/30
    udp-timeout: 30
    mtu: 1500
EOF
      ;;
  esac
}

yaml_boolean() {
  [ "$1" = 1 ] && printf 'true' || printf 'false'
}

write_sniffer_ports() {
  sniffer_protocol="$1" sniffer_ports_b64="$2"
  sniffer_ports=$(b64_decode_file "$sniffer_ports_b64" | tr ',' '\n')
  if [ -z "$(printf '%s' "$sniffer_ports" | tr -d '[:space:]')" ]; then
    printf '    %s: {}\n' "$sniffer_protocol"
    return 0
  fi
  printf '    %s:\n      ports:\n' "$sniffer_protocol"
  printf '%s\n' "$sniffer_ports" | while IFS= read -r sniffer_port; do
    sniffer_port=$(printf '%s' "$sniffer_port" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "$sniffer_port" ] || continue
    case "$sniffer_port" in
      *-*) printf '        - '; yaml_single_quote "$sniffer_port"; printf '\n' ;;
      *) printf '        - %s\n' "$sniffer_port" ;;
    esac
  done
}

write_sniffer_string_list() {
  sniffer_list_key="$1" sniffer_list_b64="$2"
  sniffer_list=$(b64_decode_file "$sniffer_list_b64")
  [ -n "$(printf '%s' "$sniffer_list" | tr -d '[:space:]')" ] || return 0
  printf '  %s:\n' "$sniffer_list_key"
  printf '%s\n' "$sniffer_list" | while IFS= read -r sniffer_item; do
    sniffer_item=$(printf '%s' "$sniffer_item" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "$sniffer_item" ] || continue
    printf '    - '
    yaml_single_quote "$sniffer_item"
    printf '\n'
  done
}

write_sniffer_overlay() {
  if [ "$MIHOMO_SNIFFER_ENABLE" != 1 ]; then
    cat <<'EOF'
sniffer:
  enable: false
EOF
    return 0
  fi
  cat <<EOF
sniffer:
  enable: true
  force-dns-mapping: $(yaml_boolean "$MIHOMO_SNIFFER_FORCE_DNS_MAPPING")
  parse-pure-ip: $(yaml_boolean "$MIHOMO_SNIFFER_PARSE_PURE_IP")
  override-destination: $(yaml_boolean "$MIHOMO_SNIFFER_OVERRIDE_DESTINATION")
  sniff:
EOF
  write_sniffer_ports QUIC "$MIHOMO_SNIFFER_QUIC_PORTS_B64"
  write_sniffer_ports TLS "$MIHOMO_SNIFFER_TLS_PORTS_B64"
  sniffer_http_ports_b64=$MIHOMO_SNIFFER_HTTP_PORTS_B64
  [ -n "$sniffer_http_ports_b64" ] || sniffer_http_ports_b64=ODAKODA4MC04ODgw
  write_sniffer_ports HTTP "$sniffer_http_ports_b64"
  printf '      override-destination: %s\n' "$(yaml_boolean "$MIHOMO_SNIFFER_HTTP_OVERRIDE_DESTINATION")"
  write_sniffer_string_list force-domain "$MIHOMO_SNIFFER_FORCE_DOMAIN_B64"
  write_sniffer_string_list skip-domain "$MIHOMO_SNIFFER_SKIP_DOMAIN_B64"
  write_sniffer_string_list skip-src-address "$MIHOMO_SNIFFER_SKIP_SRC_ADDRESS_B64"
  write_sniffer_string_list skip-dst-address "$MIHOMO_SNIFFER_SKIP_DST_ADDRESS_B64"
}

write_managed_overlay() {
  effective_find_process_mode=$MIHOMO_FIND_PROCESS_MODE
  effective_log_level=$MIHOMO_LOG_LEVEL
  effective_ipv6=$MIHOMO_IPV6
  effective_store_selected=$MIHOMO_STORE_SELECTED
  effective_store_fake_ip=$MIHOMO_STORE_FAKE_IP
  effective_sniffer_mode=inherit
  if [ "$LOCAL_OVERRIDE_ENABLED" = 1 ]; then
    [ "$LOCAL_FIND_PROCESS_MODE" = inherit ] || effective_find_process_mode=$LOCAL_FIND_PROCESS_MODE
    [ "$LOCAL_LOG_LEVEL" = inherit ] || effective_log_level=$LOCAL_LOG_LEVEL
    [ "$LOCAL_IPV6" = inherit ] || effective_ipv6=$LOCAL_IPV6
    [ "$LOCAL_STORE_SELECTED" = inherit ] || effective_store_selected=$LOCAL_STORE_SELECTED
    [ "$LOCAL_STORE_FAKE_IP" = inherit ] || effective_store_fake_ip=$LOCAL_STORE_FAKE_IP
    [ "$LOCAL_SNIFFER_MODE" = inherit ] || effective_sniffer_mode=$LOCAL_SNIFFER_MODE
  fi
  cat <<EOF
find-process-mode: $effective_find_process_mode
log-level: $effective_log_level
ipv6: $(yaml_boolean "$effective_ipv6")
profile:
  store-selected: $(yaml_boolean "$effective_store_selected")
  store-fake-ip: $(yaml_boolean "$effective_store_fake_ip")
EOF
  if [ "$effective_sniffer_mode" = disabled ]; then
    cat <<'EOF'
sniffer:
  enable: false
EOF
  elif [ "$effective_sniffer_mode" = inherit ] && [ "$MIHOMO_SNIFFER_OVERRIDE" = 1 ]; then
    write_sniffer_overlay
  fi
}

write_controller_overlay() {
  ui_url=$(effective_external_ui_url) || return 1
  [ -n "$ui_url" ] || return 1
  secret=$(b64_decode_file "$EXTERNAL_UI_SECRET_B64")
  echo 'external-controller: 0.0.0.0:9090'
  printf 'secret: '; yaml_single_quote "$secret"; printf '\n'
  echo 'external-ui: ui'
}

prepare_external_ui() {
  ui_url=$(effective_external_ui_url) || return 1
  [ -n "$ui_url" ] || return 1
  marker="$APP_DIR/external-ui.source"
  current=$(cat "$marker" 2>/dev/null || true)
  [ "$current" = "$ui_url" ] && [ -s "$UI_DIR/index.html" ] && return 0

  archive="$RUNTIME_DIR/external-ui.$$.zip"
  stage="$MIHOMO_DIR/.ui-stage.$$"
  previous="$MIHOMO_DIR/.ui-previous.$$"
  rm -f "$archive"
  rm -rf "$stage" "$previous"
  mkdir -p "$stage"

  log "downloading external UI"
  if ! wget -q -O "$archive" "$ui_url"; then
    log "external UI download failed"
    rm -f "$archive"
    rm -rf "$stage"
    return 1
  fi
  archive_size=$(wc -c < "$archive" 2>/dev/null || printf '0')
  valid_number "$archive_size" || archive_size=0
  if [ "$archive_size" -lt 128 ] || [ "$archive_size" -gt 33554432 ]; then
    log "external UI archive has invalid size: $archive_size bytes"
    rm -f "$archive"
    rm -rf "$stage"
    return 1
  fi
  if ! unzip -q "$archive" -d "$stage"; then
    log "external UI archive could not be unpacked"
    rm -f "$archive"
    rm -rf "$stage"
    return 1
  fi
  rm -f "$archive"

  ui_index=$(find "$stage" -type f -name index.html 2>/dev/null | head -n 1)
  [ -n "$ui_index" ] || {
    log "external UI archive does not contain index.html"
    rm -rf "$stage"
    return 1
  }
  ui_root=${ui_index%/index.html}
  if find "$ui_root" -type l 2>/dev/null | grep -q .; then
    log "external UI archive contains symbolic links"
    rm -rf "$stage"
    return 1
  fi

  [ ! -e "$UI_DIR" ] || mv "$UI_DIR" "$previous"
  if ! mv "$ui_root" "$UI_DIR"; then
    [ ! -e "$previous" ] || mv "$previous" "$UI_DIR"
    rm -rf "$stage"
    return 1
  fi
  rm -rf "$stage" "$previous"
  umask 077
  printf '%s' "$ui_url" > "$marker.tmp.$$"
  mv "$marker.tmp.$$" "$marker"
  log "external UI installed into $UI_DIR"
}

replace_top_level_block() {
  rtlb_input="$1" rtlb_output="$2" rtlb_key="$3" rtlb_replacement="$4"
  awk -v key="$rtlb_key" '
    function is_top(line) { return line ~ /^[^[:space:]#][^:]*:/ }
    $0 ~ "^" key ":[[:space:]]*" { skip=1; next }
    skip && is_top($0) { skip=0 }
    !skip { print }
  ' "$rtlb_input" > "$rtlb_output"
  if [ -s "$rtlb_replacement" ]; then
    printf '\n' >> "$rtlb_output"
    cat "$rtlb_replacement" >> "$rtlb_output"
  fi
}

apply_top_level_override() {
  atlo_input="$1" atlo_output="$2" atlo_override="$3"
  [ -s "$atlo_override" ] || { cp "$atlo_input" "$atlo_output"; return 0; }
  cp "$atlo_input" "$atlo_output"
  awk '/^[^[:space:]#][^:]*:/ { sub(/:.*/, ""); print }' "$atlo_override" | while IFS= read -r atlo_key; do
    case "$atlo_key" in ''|*[!0-9A-Za-z_-]*) continue ;; esac
    atlo_block="$RUNTIME_DIR/override-block.yaml"
    awk -v key="$atlo_key" '
      function is_top(line) { return line ~ /^[^[:space:]#][^:]*:/ }
      $0 ~ "^" key ":[[:space:]]*" { copy=1 }
      copy && is_top($0) && $0 !~ "^" key ":[[:space:]]*" { exit }
      copy { print }
    ' "$atlo_override" > "$atlo_block"
    [ -s "$atlo_block" ] || continue
    replace_top_level_block "$atlo_output" "$atlo_output.next" "$atlo_key" "$atlo_block"
    mv "$atlo_output.next" "$atlo_output"
  done
}

remove_top_level_keys() {
  rtlk_input="$1" rtlk_output="$2"; shift 2
  cp "$rtlk_input" "$rtlk_output"
  rtlk_empty="$RUNTIME_DIR/empty.yaml"
  : > "$rtlk_empty"
  for rtlk_key in "$@"; do
    replace_top_level_block "$rtlk_output" "$rtlk_output.next" "$rtlk_key" "$rtlk_empty"
    mv "$rtlk_output.next" "$rtlk_output"
  done
}

build_final_config() {
  [ -s "$SOURCE" ] || { printf '%s\n' "No valid downloaded subscription" > "$ERROR_FILE"; return 1; }
  overlay="$RUNTIME_DIR/listeners.yaml"
  controller_overlay="$RUNTIME_DIR/controller.yaml"
  managed_overlay="$RUNTIME_DIR/managed.yaml"
  local_override="$RUNTIME_DIR/local-override.yaml"
  : > "$overlay"
  : > "$controller_overlay"
  : > "$managed_overlay"
  : > "$local_override"
  if [ "$LOCAL_OVERRIDE_ENABLED" = 1 ]; then
    b64_decode_file "$LOCAL_OVERRIDE_B64" > "$local_override"
  fi
  if ! write_controller_overlay > "$controller_overlay"; then
    printf '%s\n' "Mihomo panel settings are invalid" > "$ERROR_FILE"
    return 1
  fi
  write_managed_overlay > "$managed_overlay"
  apply_top_level_override "$SOURCE" "$FINAL.local" "$local_override"
  apply_top_level_override "$FINAL.local" "$FINAL.managed" "$managed_overlay"
  if ! write_listeners_overlay "$FINAL.managed" > "$overlay"; then
    printf '%s\n' "Listener settings are invalid" > "$ERROR_FILE"
    return 1
  fi
  replace_top_level_block "$FINAL.managed" "$FINAL.listeners" listeners "$overlay"
  remove_top_level_keys "$FINAL.listeners" "$FINAL.controller-base" \
    redir-port \
    tproxy-port \
    tun \
    external-controller \
    external-controller-tls \
    external-controller-unix \
    external-controller-pipe \
    external-controller-routing-mark \
    external-controller-cors \
    external-ui \
    external-ui-url \
    external-ui-name \
    external-doh-server \
    secret
  apply_top_level_override "$FINAL.controller-base" "$FINAL" "$controller_overlay"
  if ! mihomo -t -d "$MIHOMO_DIR" -f "$FINAL" > "$RUNTIME_DIR/validate.log" 2>&1; then
    printf '%s\n' "Final YAML is rejected by mihomo" > "$ERROR_FILE"
    return 1
  fi
  if ! prepare_external_ui; then
    printf '%s\n' "Mihomo panel cache could not be prepared" > "$ERROR_FILE"
    return 1
  fi
  rm -f "$ERROR_FILE"
  return 0
}

MIHOMO_PID=
RELOAD=1
STOPPING=0
ROUTING_ACTIVE=0

reload() {
  RELOAD=1
  [ -n "$MIHOMO_PID" ] && kill -TERM "$MIHOMO_PID" 2>/dev/null || true
}

stop() {
  STOPPING=1
  [ -n "$MIHOMO_PID" ] && kill -KILL "$MIHOMO_PID" 2>/dev/null || true
  route_cleanup
  exit 0
}

trap reload USR1 HUP
trap stop TERM INT

supervisor() {
  last_fetch=0
  while [ "$STOPPING" = 0 ]; do
    load_state
    if [ "$RUN_ENABLED" != 1 ]; then
      if [ "$ROUTING_ACTIVE" = 1 ]; then
        route_cleanup
        ROUTING_ACTIVE=0
        log "network interception stopped and cleaned"
      fi
      rm -f "$ERROR_FILE"
      sleep 2
      continue
    fi
    load_profile
    refresh_seconds=$(effective_refresh_seconds)
    url="$(b64_decode_file "$SUB_URL_B64")"
    if [ -z "$url" ]; then
      printf '%s\n' "Subscription URL is not configured" > "$ERROR_FILE"
      rm -f "$FINAL"
      sleep 5
      continue
    fi
    now=$(date +%s)
    if [ "$RELOAD" = 1 ] || [ ! -s "$SOURCE" ] || [ $((now - last_fetch)) -ge "$refresh_seconds" ]; then
      RELOAD=0
      if fetch_source && build_final_config; then
        last_fetch=$(date +%s)
        log "subscription refreshed; final config is valid"
      else
        log "subscription refresh failed: $(cat "$ERROR_FILE" 2>/dev/null || echo unknown)"
      fi
    fi
    if [ -s "$FINAL" ]; then
      route_cleanup
      ROUTING_ACTIVE=0
      resolve_listener_mode
      if ! route_pre_start > "$RUNTIME_DIR/route.log" 2>&1; then
        printf '%s\n' "Failed to apply pre-start routing rules" > "$ERROR_FILE"
        log "routing pre-start failed"
        sleep 5
        continue
      fi
      case "$ROUTE_MODE" in tproxy|redir-tproxy) ROUTING_ACTIVE=1 ;; esac
      log "starting mihomo ($(mihomo -v 2>/dev/null | head -n1))"
      mihomo -d "$MIHOMO_DIR" -f "$FINAL" &
      MIHOMO_PID=$!
      if ! route_post_start >> "$RUNTIME_DIR/route.log" 2>&1; then
        printf '%s\n' "Failed to apply post-start routing rules" > "$ERROR_FILE"
        kill -TERM "$MIHOMO_PID" 2>/dev/null || true
      else
        [ "$ROUTE_MODE" = redir-tun ] && ROUTING_ACTIVE=1
      fi
      wait "$MIHOMO_PID"
      rc=$?
      MIHOMO_PID=
      route_cleanup
      ROUTING_ACTIVE=0
      [ "$STOPPING" = 1 ] && break
      [ "$RELOAD" = 1 ] && continue
      log "mihomo exited ($rc), retrying in 5s"
      sleep 5
    else
      sleep 5
    fi
  done
}

refresh_timer() {
  last_signal=0
  while :; do
    sleep 5
    load_state
    load_profile
    url="$(b64_decode_file "$SUB_URL_B64")"
    [ -n "$url" ] || continue
    refresh_seconds=$(effective_refresh_seconds)
    fetched_epoch=$(awk -F= '$1 == "fetched_epoch" { print $2; exit }' "$META" 2>/dev/null || true)
    valid_number "$fetched_epoch" || continue
    now=$(date +%s)
    [ $((now - fetched_epoch)) -ge "$refresh_seconds" ] || continue
    [ $((now - last_signal)) -ge "$refresh_seconds" ] || continue
    last_signal=$now
    kill -USR1 1 2>/dev/null || true
  done
}

network_settings_watcher() {
  applied_signature=$(cat "$NETWORK_SIGNATURE_FILE" 2>/dev/null || true)
  while :; do
    sleep 2
    load_state
    current_signature=$(network_signature)
    [ "$current_signature" != "$applied_signature" ] || continue
    if apply_network_settings 0 > "$RUNTIME_DIR/network.log" 2>&1; then
      applied_signature=$current_signature
      printf '%s' "$applied_signature" > "$NETWORK_SIGNATURE_FILE"
      log "Alpine network settings changed and applied"
    else
      log "WARNING: changed Alpine network settings could not be applied"
      sleep 3
    fi
  done
}

sh "$MIHOMO_DIR/scripts/05-fw-modules.sh" || log "WARNING: firewall backend setup was incomplete"
load_state
startup_network_signature=$(network_signature)
if apply_network_settings 1 > "$RUNTIME_DIR/network.log" 2>&1; then
  printf '%s' "$startup_network_signature" > "$NETWORK_SIGNATURE_FILE"
  log "Alpine network settings applied"
else
  rm -f "$NETWORK_SIGNATURE_FILE"
  log "WARNING: Alpine network settings could not be applied"
fi
route_cleanup
setup_auth
build_webroot
httpd -f -p 80 -h "$WEBROOT" -c "$HTTPD_CONF" &
log "web UI started on :80"
network_settings_watcher &
refresh_timer &
supervisor
