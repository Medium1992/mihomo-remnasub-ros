#!/bin/sh
set -u

APP_DIR=/etc/mihomo/remnasub
PROFILE="$APP_DIR/profile.conf"
SOURCE="$APP_DIR/source.yaml"
FINAL=/dev/shm/remnasub/config.yaml
META="$APP_DIR/source.meta"
ERROR_FILE="$APP_DIR/last-error.txt"

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

state_get() {
  key="$1" fallback="${2:-}"
  value=$(awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$PROFILE" 2>/dev/null || true)
  printf '%s' "${value:-$fallback}"
}

valid_number() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

url_decode() {
  encoded=$(printf '%s' "${1:-}" | sed 's/+/ /g; s/%/\\x/g')
  printf '%b' "$encoded"
}

form_value() {
  wanted="$1"
  printf '%s' "${FORM_BODY:-}" | tr '&' '\n' | while IFS= read -r pair; do
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
  ref="${HTTP_REFERER:-}"
  case "$ref" in "http://$host/"*|"https://$host/"*) return 0 ;; esac
  return 1
}

deny() {
  json_headers
  printf '{"ok":false,"error":"%s"}\n' "${1:-request denied}"
  exit 0
}

require_post() { same_origin_post || deny 'same-origin POST required'; }
