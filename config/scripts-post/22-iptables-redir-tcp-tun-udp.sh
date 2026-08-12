#!/bin/sh
# ─────────────────────────────────────────────────────────────
#  Режим: Redirect(tcp) + TUN(udp) через iptables (legacy).
#  Единственный вариант для iptables (без tproxy): TCP -> `redir-in`,
#  UDP уходит в TUN (`Meta`).
#  ВКЛЮЧЁН ПО УМОЛЧАНИЮ (на ядре без nf_tables). На nft-ядре упадёт на первой
#  команде iptables (нет бинаря) — это ожидаемо, работает nft-вариант.
#  POST: после старта ядра (TUN `Meta` появляется только тогда).
#  Порядок: iptables redirect -> policy-routing -> forward-фаервол В КОНЦЕ.
# ─────────────────────────────────────────────────────────────
set -e

IFACE=${ROUTE_IFACE:-}
[ -n "$IFACE" ] && ip link show dev "$IFACE" >/dev/null 2>&1 || \
  IFACE="$(ip -o link show up | awk -F': ' '/link\/ether/ {gsub(/@.*$/, "", $2); if ($2 != "lo" && $2 != "Meta" && $2 !~ /^hs5t/) {print $2; exit}}')"
[ -n "$IFACE" ] || { echo "[route] входящий Ethernet-интерфейс не найден"; exit 1; }
IFACE_CIDR="$(ip -4 -o addr show dev "$IFACE" scope global | awk '{print $4; exit}')"
[ -n "$IFACE_CIDR" ] || IFACE_CIDR="127.0.0.1/32"
REDIR=${REDIR_PORT:-12345}; TUN=Meta; TUN_GW=100.64.0.1; RT=110

# === iptables: чистка + redirect tcp (если iptables нет — упадёт здесь, до роутинга) ===
iptables -t nat -N MIHOMO_PREROUTING
iptables -t nat -I PREROUTING 1 -j MIHOMO_PREROUTING
iptables -t nat -A MIHOMO_PREROUTING ! -i "$IFACE" -j RETURN
iptables -t nat -A MIHOMO_PREROUTING -m addrtype --dst-type LOCAL -j RETURN
iptables -t nat -A MIHOMO_PREROUTING -m addrtype ! --dst-type UNICAST -j RETURN
iptables -t nat -A MIHOMO_PREROUTING -d "$IFACE_CIDR" -j RETURN
iptables -t nat -A MIHOMO_PREROUTING -d 198.19.0.0/30 -j RETURN
iptables -t nat -A MIHOMO_PREROUTING -p tcp -j REDIRECT --to-ports $REDIR

# === policy routing: udp -> TUN (table 110); исключения -> main ===
i=0; while [ $i -lt 50 ]; do ip link show "$TUN" >/dev/null 2>&1 && break; i=$((i+1)); sleep 0.2; done
ip link show "$TUN" >/dev/null 2>&1 || { echo "[route] TUN $TUN не появился — проверь listener tun-in"; exit 1; }
for p in 10000 10001 10002 10003 10004 10005; do ip rule del pref $p 2>/dev/null || true; done
ip route flush table $RT 2>/dev/null || true
ip rule add to $IFACE_CIDR lookup main priority 10001
ip rule add to 127.0.0.0/8 lookup main priority 10002
ip rule add to 224.0.0.0/4 lookup main priority 10003
ip rule add to 255.255.255.255 lookup main priority 10004
ip rule add iif "$IFACE" ipproto udp lookup $RT priority 10005
ip route replace default via $TUN_GW dev $TUN table $RT

# === forward-фаервол (в самом конце): дропаем ВЕСЬ форвард, кроме
#     established/related и udp, уходящего в TUN ===
iptables -N MIHOMO_FORWARD
iptables -I FORWARD 1 -j MIHOMO_FORWARD
iptables -A MIHOMO_FORWARD -m conntrack --ctstate ESTABLISHED,RELATED,UNTRACKED -j ACCEPT
iptables -A MIHOMO_FORWARD -m conntrack --ctstate INVALID -j DROP
iptables -A MIHOMO_FORWARD -i "$IFACE" -o "$TUN" -p udp -j ACCEPT
iptables -A MIHOMO_FORWARD -j DROP
sysctl -w net.ipv4.ip_forward=1 2>/dev/null || true

echo "[route] iptables Redirect(tcp)->$REDIR + TUN(udp)->$TUN on $IFACE"
