#!/bin/sh
set -u

APP_DIR=/etc/mihomo/remnasub
STATE="$APP_DIR/state.conf"
PROFILES_DIR="$APP_DIR/profiles"
RUNTIME_DIR=/dev/shm/remnasub
UI_DIR=/etc/mihomo/ui

json_headers() {
  echo 'Content-Type: application/json; charset=utf-8'
  echo 'Cache-Control: no-store'
  echo ''
}

text_headers() {
  echo 'Content-Type: text/plain; charset=utf-8'
  echo 'Cache-Control: no-store'
  echo ''
}

b64() { printf '%s' "${1:-}" | openssl base64 -A 2>/dev/null; }

default_mihomo_user_agent() {
  version=$(mihomo -v 2>/dev/null | awk 'NR == 1 && $1 == "Mihomo" && $2 == "Meta" { print $3; exit }')
  [ -n "$version" ] || version=1.19.29
  printf 'clash.meta/%s' "$version"
}

external_ui_url() {
  case "${1:-zashboard-cdn}" in
    zashboard) printf '%s' 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip' ;;
    zashboard-cdn) printf '%s' 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip' ;;
    metacubexd) printf '%s' 'https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip' ;;
    yacd-meta) printf '%s' 'https://github.com/MetaCubeX/Yacd-meta/archive/refs/heads/gh-pages.zip' ;;
    custom) printf '%s' "${2:-}" | openssl base64 -d -A 2>/dev/null ;;
    *) return 1 ;;
  esac
}

state_get() {
  key="$1" fallback="${2:-}"
  value=$(awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$PROFILE" 2>/dev/null || true)
  printf '%s' "${value:-$fallback}"
}

state_file_get() {
  file="$1" key="$2" fallback="${3:-}"
  value=$(awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$file" 2>/dev/null || true)
  printf '%s' "${value:-$fallback}"
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

ACTIVE_PROFILE_ID=$(awk -F= '$1 == "ACTIVE_PROFILE_ID" { print $2; exit }' "$STATE" 2>/dev/null || true)
if ! valid_profile_id "$ACTIVE_PROFILE_ID" || [ ! -f "$PROFILES_DIR/$ACTIVE_PROFILE_ID.conf" ]; then
  ACTIVE_PROFILE_ID=$(first_profile_id 2>/dev/null || true)
fi
PROFILE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.conf"
SOURCE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.source.yaml"
FINAL="$RUNTIME_DIR/$ACTIVE_PROFILE_ID.config.yaml"
META="$PROFILES_DIR/$ACTIVE_PROFILE_ID.source.meta"
ERROR_FILE="$PROFILES_DIR/$ACTIVE_PROFILE_ID.error.txt"

valid_number() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

url_decode() {
  encoded=$(printf '%s' "${1:-}" | sed 's/+/ /g; s/%/\\x/g')
  printf '%b' "$encoded"
}

form_value() {
  wanted="$1"
  printf '%s\n' "${FORM_BODY:-}" | tr '&' '\n' | while IFS= read -r pair; do
    key=${pair%%=*}
    [ "$key" = "$wanted" ] || continue
    url_decode "${pair#*=}"
    break
  done
}

load_form() {
  valid_number "${CONTENT_LENGTH:-0}" || deny 'invalid request length'
  [ "${CONTENT_LENGTH:-0}" -le 65536 ] || deny 'request is too large'
  FORM_BODY=$(dd bs=1 count="${CONTENT_LENGTH:-0}" 2>/dev/null)
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
