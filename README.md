[English](/README.md) | [Русский](/README_RU.md) · [Telegram](https://t.me/+96HVPF3Ww6o3YTNi)

# mihomo-remnasub-ros

> A lightweight multi-architecture container for **MikroTik RouterOS**. It downloads complete Remnawave YAML subscriptions, applies controlled local overrides, validates the result, and runs it with [mihomo](https://github.com/MetaCubeX/mihomo). Subscription and container management is provided by an embedded BusyBox `httpd` + shell CGI WebUI.

[![Docker Pulls](https://img.shields.io/docker/pulls/medium1992/mihomo-remnasub-ros?logo=docker&label=docker%20pulls)](https://hub.docker.com/r/medium1992/mihomo-remnasub-ros)
[![Docker Image Size](https://img.shields.io/docker/image-size/medium1992/mihomo-remnasub-ros/latest?logo=docker&label=image%20size)](https://hub.docker.com/r/medium1992/mihomo-remnasub-ros)
[![License](https://img.shields.io/github/license/Medium1992/mihomo-remnasub-ros)](./LICENSE)
![Platforms](https://img.shields.io/badge/arch-amd64%20%7C%20arm64%20%7C%20armv7%20%7C%20armv5-blue)
[![Telegram](https://img.shields.io/badge/Telegram-group-blue?logo=telegram)](https://t.me/+96HVPF3Ww6o3YTNi)

![RemnaSub RoS WebUI](/docs/screenshots/subscriptions.png)

## ✨ Features

- 📚 Multiple complete YAML subscriptions with an active profile, manual/periodic refresh, and per-profile settings.
- 🧾 Required and custom Remnawave request headers, with optional per-subscription overrides.
- 🧩 Managed global and local overrides for listeners, controller, UI, process mode, logs, IPv6, profile storage, and sniffer.
- ➕ `prepend-rules` / `append-rules` (and the same for other sections) add your own entries to the start or end of the subscription's list without copying it.
- 🧪 A **Check** button for overrides: build and `mihomo -t` without saving, with the resulting YAML.
- ↩️ Rollback: when a configuration passes `mihomo -t` but the core keeps crashing with it, the previous working one is restored.
- 📜 The core's own log next to the container events.
- 🚀 TCP tuning for the container's sockets (`tcp_notsent_lowat`, MTU probing and more), with a report of what applied.
- 💼 Backup and restore of settings and subscriptions as one file.
- 🔀 REDIR + TPROXY, REDIR + TUN, and TPROXY interception modes selected according to RouterOS kernel support.
- ✅ Atomic activation: a downloaded configuration replaces the running one only after `mihomo -t` succeeds.
- 🖥 Embedded subscription UI on port `80` and a downloadable Mihomo dashboard on port `9090`.
- 🔐 HTTP Basic Auth using an md5crypt hash, with an in-app `BASIC_AUTH_HASH` generator.
- 💾 Persistent profiles under `/etc/mihomo`; generated configurations, jobs, and events stay in `/dev/shm`.
- 🌍 amd64, arm64, armv7, and armv5 images.

## 🚦 Lifecycle

1. Add a URL that returns a complete Mihomo YAML profile. Saving a new or changed URL starts a download automatically.
2. Global Remnawave headers and optional per-profile headers are sent with the request.
3. The response body is saved even when its YAML is invalid, so the exact provider response remains inspectable.
4. Per-profile, managed global, listener, and controller overrides are applied in that order.
5. The candidate is checked with `mihomo -t` and becomes the runtime YAML only when validation succeeds.
6. A failed update does not stop a previously valid running configuration.
7. If a configuration passed validation but the core crashes with it three times in a row within 30 seconds of starting, the previous working one is restored and the crashing one is not installed again by scheduled refreshes. Restarts back off 5, 10, 20, 40, 60 seconds.
8. The selected subscription and run/stop state survive container restarts.

## ⚡ Quick Docker Start

```bash
docker run -d \
  --name mihomo-remnasub-ros \
  --restart unless-stopped \
  --cap-add NET_ADMIN \
  --device /dev/net/tun \
  -p 8080:80 \
  -p 9090:9090 \
  -v ./mihomo-remnasub:/etc/mihomo \
  -e BASIC_AUTH_USER=admin \
  -e BASIC_AUTH_HASH='$1$mihomors$BipEGg3TOdgaQSFfGtisO1' \
  ghcr.io/medium1992/mihomo-remnasub-ros:latest
```

Open `http://127.0.0.1:8080/`. The default credentials are `admin` / `admin`.

## 🛠 RouterOS Installation

> The example uses RouterOS 7.21+ `mountlists` and `envlists` syntax. Adjust disk paths and addresses for your router.

```routeros
/system/device-mode/print
/system/device-mode/update mode=advanced container=yes

/interface/veth/add name=veth-remnasub address=192.168.253.2/30 gateway=192.168.253.1
/ip/address/add address=192.168.253.1/30 interface=veth-remnasub

/container/config/set registry-url=https://ghcr.io tmpdir=usb1/pull
/container/mounts/add list=mihomo-remnasub-ros src=usb1/mihomo-remnasub dst=/etc/mihomo
/container/envs/add list=mihomo-remnasub-ros key=BASIC_AUTH_USER value=admin
/container/envs/add list=mihomo-remnasub-ros key=BASIC_AUTH_HASH value="\$1\$mihomors\$BipEGg3TOdgaQSFfGtisO1"

/container/add remote-image=ghcr.io/medium1992/mihomo-remnasub-ros:latest \
  interface=veth-remnasub root-dir=usb1/mihomo-remnasub-root \
  mountlists=mihomo-remnasub-ros envlists=mihomo-remnasub-ros \
  logging=yes start-on-boot=yes
```

Open `http://192.168.253.2/` after startup. RouterOS routing/mangle rules must direct client traffic to the container according to the selected inbound mode.

## 🖥 WebUI

### Subscriptions

- clicking a subscription row or its ✓ button makes it active; while the core runs this asks first, because it restarts Mihomo and drops connections;
- ▶ on the active subscription starts the core, on another one it selects it and starts straight away;
- refresh downloads the source regardless of the core state;
- per-profile settings include provider interval/title handling, headers, and local overrides; closing with unsaved changes asks first;
- **Duplicate** copies a profile, which then downloads its own YAML;
- **Source YAML** shows the latest raw HTTP response;
- **Runtime YAML** shows the validated result after all overrides, and its **Changes** tab lists the sections added, changed, or removed relative to the subscription;
- **Logs** shows container events and the core's own output, stored only in RAM.

Each card shows traffic and expiry from `subscription-userinfo`, highlighted three days before expiry and past 90 % of the quota. The UI reads standard Remnawave metadata. It also reports VLESS proxies with an all-zero UUID, which commonly indicates an expired, disabled, or restricted subscription despite an HTTP 200 response.

![Settings - overrides](/docs/screenshots/settings-overrides.png)

### Settings

- **Headers**: global request headers for every subscription.
- **Inbound traffic**: interception mode and REDIR/TPROXY ports.
- **Alpine network**: IPv6, multicast, qdisc, conntrack timeouts, and TCP tuning.
- **Mihomo UI**: Zashboard/MetaCubeXD/Yacd-meta/custom archive and controller secret.
- **Global overrides**: managed Mihomo and sniffer settings.
- **Appearance**: dark and light themes, the Graphite, Midnight, Forest and Sepia presets, and a
  custom accent colour. The choice is stored in the container and applies to everyone opening the panel.
- **Access**: md5crypt generator for `BASIC_AUTH_HASH`.
- **Backup**: download settings and every subscription as one file, and restore from it.

Unsaved settings are marked with a dot on **Save**, and closing the tab with them asks first.

![Settings - appearance](/docs/screenshots/settings-appearance.png)

A subscription's own settings open from its row: URL, interval, timeout, decryption key and per-profile overrides.

![Subscription editor](/docs/screenshots/subscription-editor.png)

The resulting configuration and the container log are available straight from the panel.

![Runtime YAML](/docs/screenshots/runtime-yaml.png)

## 🌐 HTTP Headers

![Settings - headers](/docs/screenshots/settings-headers.png)

### Default request headers

| Header | Default value |
|---|---|
| `x-hwid` | `RouterOS-Solomon` |
| `x-device-os` | `RouterOS` |
| `x-ver-os` | `7.23.3` |
| `x-device-model` | `MikroTik RB5009UG+S+IN` |
| `user-agent` | `clash.meta/<mihomo version>` |

The value of each of these five keys can be changed, and the header itself can be switched off with the checkbox on the left. A disabled header is not sent at all -- for a required key that also means no default is substituted in its place. The value is kept so a single click brings it back; in the settings such a line is stored with a leading `#`.

Custom headers can be added and switched off the same way. Names are compared case-insensitively.

### Recognized response headers

| Header | Usage |
|---|---|
| `profile-title` | Provider display name; plain text and `base64:` are supported. |
| `profile-update-interval` | Provider refresh interval in hours. |
| `subscription-userinfo` | `upload`, `download`, `total`, and `expire` metadata. |
| `profile-web-page-url` | Subscription account page. |
| `support-url` | Provider support URL. |
| `subscription-refill-date` | Quota refill/reset date. |
| `announce` | Provider message; plain text and `base64:` are supported. |

The final HTTP status line, status code, response size, and fetch time are stored as well.

## 🧩 YAML Override Rules

The subscription remains a complete configuration. Only managed sections are changed:

- `redir`, `tproxy`, and `tun` listeners are replaced by the selected local mode; other listener types are preserved;
- top-level `redir-port`, `tproxy-port`, and `tun` are removed;
- controller/UI keys (`external-controller*`, `external-ui*`, `external-doh-server`, and `secret`) are replaced locally;
- `find-process-mode`, `log-level`, `ipv6`, `profile.store-selected`, and `profile.store-fake-ip` are managed globally;
- source `sniffer` is preserved unless its override is explicitly enabled;
- `mode` is taken from the subscription until a specific one (`rule`, `global`, `direct`) is selected in the settings;
- the shared YAML from the settings and the profile's own YAML replace same-name top-level sections before mandatory container overrides.

Precedence: **source YAML → shared YAML → per-profile YAML → managed global values → local listeners and controller**.

### Shared and per-profile YAML

The shared YAML is written once under **Settings → Overrides** and is applied to every subscription. The profile's own YAML is applied after it, so a subscription can undo a shared rule for its own section.

Overrides **replace a whole top-level section rather than merging into it**. Override `dns` and nothing survives from the original section but what you wrote, so spell the block out in full.

To **add** entries instead of replacing a section, prefix the key with `prepend-` or `append-`:

```yaml
prepend-rules:                 # to the start of the subscription's rules
  - GEOSITE,category-ru,DIRECT
  - GEOIP,RU,DIRECT,no-resolve
append-proxies:                # to the end of proxies
  - name: backup
    type: direct
```

Any section works: `rules`, `proxies`, `proxy-groups`, `rule-providers`, `hosts` and so on. Replacements are applied first and additions second, so `append-rules` also works on top of `rules` rewritten in the same YAML. Entries are re-indented to match the subscription's section, and a missing section is created. Write the entries as a block list on new lines: `prepend-rules: [a, b]` is not supported, and neither is adding to a subscription section written in `[...]` flow style.

The preset buttons above the editor insert ready-made pieces: RU direct, LAN direct, Block QUIC (all three `prepend-rules`), DoH resolvers, pinning their addresses, LAN access, geodata, connection tuning. A preset whose key is already present is merged into that block instead of duplicating the key.

The **Check** button below the editor builds the configuration through the same pipeline as the runtime one, runs `mihomo -t` and shows the output and resulting YAML, saving nothing. The shared YAML is checked against the active subscription, a profile's YAML against its own subscription together with the unsaved values of its override block. Everything else comes from the saved settings.

Two formatting rules are checked before saving, because both break the parser:

- a list at the top level (`- MATCH,DIRECT` with no key above it) — items must be indented under their section, otherwise a line such as `- IP-CIDR,2001:db8::/32,PROXY` is indistinguishable from the start of a new key;
- tabs used for indentation, which YAML does not allow.

Keys the container sets itself after the override is applied are pointless to write here: `find-process-mode`, `log-level`, `ipv6`, `profile`, `listeners`, `redir-port`, `tproxy-port`, `tun`, `external-controller*`, `external-ui*`, `secret`. Depending on the settings, `mode` (when a specific mode is selected), `sniffer` (when its override is on) and `socks-port`, `port`, `mixed-port` (while they are being stripped) join them. The editor flags them as you type, following the current switches.

Before `mihomo -t`, the resulting configuration is checked for port conflicts: `mihomo -t` does not bind ports, so two inbounds on one port would otherwise surface only at start. Ports `53`, `80` and `9090` belong to the core's DNS, the WebUI and the controller.

## 🔒 Encrypted subscriptions

Remnawave can serve the subscription encrypted, configured in a Subscription Response Rule through `responseModifications.encryption`:

```json
"responseType": "MIHOMO",
"responseModifications": {
  "encryption": { "key": "age1...", "method": "age1" }
}
```

The body arrives as [age](https://age-encryption.org) in ASCII armor, starting with `-----BEGIN AGE ENCRYPTED FILE-----`. Both methods are supported: `age1` (X25519) and `age1pq1` (the ML-KEM-768 + X25519 post-quantum hybrid).

The container decrypts the response right after download, before overrides are applied and before `mihomo -t` validates it, so everything downstream behaves exactly as with plain YAML -- including the **Downloaded YAML** viewer in the web UI. Decryption is done by the core itself: mihomo ships age.

**Setup:**

1. Open the subscription card and find the **Response encryption** block.
2. Press **Generate** with the method you need. The pair is created inside the container: the private key goes straight into the field and never leaves, the public key is shown for copying.
3. Paste the public key into `encryption.key` of the panel's response rule and select the same method there.
4. Save the subscription -- it will be refetched, now encrypted.

If the pair was already generated in the panel (`docker exec -it remnawave cli` -> *Generate keypairs*), just paste its private half (`AGE-SECRET-KEY-1...` or `AGE-SECRET-KEY-PQ-1...`) into the key field.

An empty field means the subscription is treated as unencrypted. If the server sends an encrypted body anyway and no key is set, the card shows a clear error instead of an opaque YAML parse failure.

## 🔀 Inbound Modes
![Settings - inbound](/docs/screenshots/settings-traffic.png)


| Mode | Behavior |
|---|---|
| Automatic | With nftables: TCP REDIR + UDP TPROXY. Without nftables: TCP REDIR + UDP TUN. |
| REDIR + TUN | TCP through REDIR, UDP through the `Meta` interface. |
| REDIR + TPROXY | TCP through REDIR and UDP through TPROXY; requires nftables. |
| TPROXY | TCP and UDP through TPROXY; requires nftables. |

### Subscription inbounds and local proxies

Remnawave ships its own inbounds in the configuration -- usually `mixed-port: 7890`, `socks-port: 7891` and `port`. The container works as a gateway and has no use for an extra listening port on the LAN, so **they are stripped by default**. Each type has its own switch if you do want it.

Stripping happens **at both levels at once**: the top-level `socks-port`, `port` and `mixed-port` keys, and the `type: socks`, `type: http` and `type: mixed` entries under `listeners`. One place is not enough -- a SOCKS inbound disabled in the panel would otherwise come back from the other.

A local SOCKS5 and HTTP proxy are enabled in the same place, independently of each other and **off by default**. Each has its own port and optional username and password. An empty username means no authentication, and the inbound is then open to everyone on the network, since it listens on every interface. An empty `users` list is written explicitly so the inbound does not inherit `authentication` from the subscription and "no password" in the panel means exactly that.

Ports are checked before saving: they must differ from each other, from the REDIR and TPROXY ports and from `53`, `80` and `9090`, or the core refuses to bring up the second listener.

The default ports are `12345` for REDIR and `12346` for TPROXY. Start creates only the selected mode's rules; stop removes only rules and routes owned by this container.

## 🌐 Alpine Network

- The firewall backend is selected from kernel support: nftables when `nf_tables` exists, otherwise iptables-legacy.
- Standard `local/main/default` IP rules are normalized once at container startup.
- IPv6 and multicast are disabled by default.
- `fq_codel` is the default qdisc. `cake`, `codel`, `sfq`, `pfifo`, and `bfifo` require their kernel module to be loaded by RouterOS.
- Conntrack defaults are aligned with RouterOS and can be edited or reset in the UI.
- TCP tuning for the container's sockets, that is Mihomo's outbound connections: `tcp_notsent_lowat` 128 KB (unlimited in the kernel, which costs memory and adds bufferbloat), `tcp_slow_start_after_idle` 0, `tcp_mtu_probing` 1, `tcp_fin_timeout` 30 s; optionally a congestion control algorithm from those the kernel has and a cap on `tcp_rmem`/`tcp_wmem`. "System" restores the kernel value from container start. Each parameter shows whether it applied, since some sysctls are read-only inside the container's netns. `tcp_keepalive_*` is left out on purpose — Mihomo sets keepalive on every socket itself (`keep-alive-idle`, `keep-alive-interval`) — and `nf_conntrack_max` and `net.core.*mem_max` belong to RouterOS.
- A dedicated chain blocks only inbound IPv4 ICMP echo requests from the RouterOS-facing interface while Mihomo is not running. Ping is allowed after both Mihomo and the interception rules start successfully, then blocked again on stop, invalid configuration, or profile switch. This lets `check-gateway=ping` mark the route unavailable without blocking the WebUI or other container INPUT traffic.

## 🔐 Environment Variables

Subscription and runtime settings are stored under `/etc/mihomo`; ENV is only used for access to the embedded WebUI:

| ENV | Default | Purpose |
|---|---|---|
| `BASIC_AUTH_USER` | `admin` | HTTP Basic Auth username. |
| `BASIC_AUTH_HASH` | hash of `admin` | md5crypt value (`$1$...`), generated under **Settings → Access**. |
| `BASIC_AUTH` | `on` | `off` disables authentication; use only on an isolated trusted network. |

Escape every `$` as `\$` when entering the hash in a RouterOS terminal command.

## 💾 Storage

```text
/etc/mihomo/
├── remnasub/
│   ├── state.conf
│   ├── external-ui.source
│   └── profiles/
│       ├── p-*.conf
│       ├── p-*.source.yaml
│       └── p-*.source.meta
└── ui/

/dev/shm/remnasub/
├── p-*.config.yaml
├── p-*.config.previous.yaml
├── p-*.config.failed.yaml
├── events.log
├── core.log, core.log.1
├── checks/
├── jobs/ and status/
├── errors/
├── httpd.conf
└── source.*, build.*, and route.*

/dev/shm/web/
```

Mount `/etc/mihomo` on persistent storage. A subscription response is downloaded completely into `/dev/shm` first; its persistent `p-*.source.yaml` is replaced only when the content actually changes. An unchanged response skips the large YAML write and updates only the small metadata record. Settings are also compared before replacement, so saving identical values causes no persistent write.

`/dev/shm` is reset on restart. Generated YAML, downloads, build files, errors, jobs, statuses, events, network logs, the HTTP server configuration, and the served WebUI copy stay in RAM. The latest subscription response and the selected Mihomo dashboard intentionally remain under `/etc/mihomo` so the container can recover without downloading them again after every restart.

Mihomo itself may create `cache.db` and geodata files under `/etc/mihomo` when required by the configuration. `cache.db` backs `profile.store-selected` and `profile.store-fake-ip`, so these writes are intentionally persistent. The container stores selected proxies by default but does not persist fake-ip entries.

## 🛡 Security

- Change the default `admin` password immediately. Only its hash is stored in ENV.
- **Always set a Mihomo dashboard password** under **Settings -> Mihomo panel**. Port `9090` is the
  core's own RESTful API and listens on every interface so the dashboard can be opened from a
  computer on the same network. While the secret is empty, anyone on that network can switch
  proxies, read the configuration with every subscription credential in it, and replace it. For the
  same reason, never forward `9090` to the internet.
- The WebUI uses plain HTTP; never expose container port `80` directly to the internet. Use LAN or VPN access.
- Mutating subscription endpoints require same-origin POST and enforce request-size limits.
- Content Security Policy blocks external scripts, inline code, framing, and unrelated browser network requests.
- Subscription/UI sources are restricted to HTTP(S), and temporary files use restrictive permissions.
- A candidate configuration never replaces the running one before `mihomo -t` succeeds.

## 🐳 Build

The `latest` tag carries amd64 v3, arm64, armv7 and armv5; separate `amd64v1`, `amd64v2` and `amd64v4` images are published for x86-64.

**gVisor.** The regular tags carry a core **without gVisor**: it is about 9 MiB smaller, and the container's TUN runs on `stack: mips`. If you need `tun.stack: gvisor` / `mixed` or an outbound Tailscale, take the same tag with a `-gvisor` suffix: `latest-gvisor`, `amd64v1-gvisor`, `amd64v2-gvisor`, `amd64v4-gvisor`, `<version>-gvisor`. Dockerfile arguments and per-architecture details live in [docs/BUILD.md](/docs/BUILD.md).

## 💖 Support the project

If this saved you time configuring MikroTik and its scripts:

- **USDT (TRC20):** `TWDDYD1nk5JnG6FxvEu2fyFqMCY9PcdEsJ`
- **USDT (Polygon PoS):** `0xa4f2d9035e8bacf4cdff27904f03ecc5479f7e17`
