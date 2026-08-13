[English](/README.md) | [Русский](/README_RU.md) · [Telegram](https://t.me/+96HVPF3Ww6o3YTNi)

# mihomo-remnasub-ros

> A lightweight multi-architecture container for **MikroTik RouterOS**. It downloads complete Remnawave YAML subscriptions, applies controlled local overrides, validates the result, and runs it with [mihomo](https://github.com/MetaCubeX/mihomo). Subscription and container management is provided by an embedded BusyBox `httpd` + shell CGI WebUI.

[![Docker Pulls](https://img.shields.io/docker/pulls/medium1992/mihomo-remnasub-ros?logo=docker&label=docker%20pulls)](https://hub.docker.com/r/medium1992/mihomo-remnasub-ros)
[![Docker Image Size](https://img.shields.io/docker/image-size/medium1992/mihomo-remnasub-ros/latest?logo=docker&label=image%20size)](https://hub.docker.com/r/medium1992/mihomo-remnasub-ros)
[![License](https://img.shields.io/github/license/Medium1992/mihomo-remnasub-ros)](./LICENSE)
![Platforms](https://img.shields.io/badge/arch-amd64%20%7C%20arm64%20%7C%20armv7%20%7C%20armv5-blue)
[![Telegram](https://img.shields.io/badge/Telegram-group-blue?logo=telegram)](https://t.me/+96HVPF3Ww6o3YTNi)

## ✨ Features

- 📚 Multiple complete YAML subscriptions with an active profile, manual/periodic refresh, and per-profile settings.
- 🧾 Required and custom Remnawave request headers, with optional per-subscription overrides.
- 🧩 Managed global and local overrides for listeners, controller, UI, process mode, logs, IPv6, profile storage, and sniffer.
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
7. The selected subscription and run/stop state survive container restarts.

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

- clicking a subscription row selects it as active;
- start/stop controls are enabled only for the active subscription;
- refresh downloads the source regardless of the core state;
- per-profile settings include provider interval/title handling, headers, and local overrides;
- **Source YAML** shows the latest raw HTTP response;
- **Runtime YAML** shows the validated result after all overrides;
- **Events** shows download, validation, runtime, and UI activity stored only in RAM.

The UI reads standard Remnawave metadata. It also reports VLESS proxies with an all-zero UUID, which commonly indicates an expired, disabled, or restricted subscription despite an HTTP 200 response.

### Settings

- **Headers**: global request headers for every subscription.
- **Inbound traffic**: interception mode and REDIR/TPROXY ports.
- **Alpine network**: IPv6, multicast, qdisc, and conntrack timeouts.
- **Mihomo UI**: Zashboard/MetaCubeXD/Yacd-meta/custom archive and controller secret.
- **Global overrides**: managed Mihomo and sniffer settings.
- **Access**: md5crypt generator for `BASIC_AUTH_HASH`.

## 🌐 HTTP Headers

### Default request headers

| Header | Default value |
|---|---|
| `x-hwid` | `RouterOS-Solomon` |
| `x-device-os` | `RouterOS` |
| `x-ver-os` | `7.23.3` |
| `x-device-model` | `MikroTik RB5009UG+S+IN` |
| `user-agent` | `clash.meta/<mihomo version>` |

These five keys are always sent, but their values are editable. Any custom header may be added. Header names are matched case-insensitively. When local overrides are enabled, profile headers replace same-name global headers and extend the rest.

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
- per-profile extra YAML replaces same-name top-level sections before mandatory container overrides.

Precedence: **source YAML → per-profile YAML → managed global values → local listeners and controller**.

## 🔀 Inbound Modes

| Mode | Behavior |
|---|---|
| Automatic | With nftables: TCP REDIR + UDP TPROXY. Without nftables: TCP REDIR + UDP TUN. |
| REDIR + TUN | TCP through REDIR, UDP through the `Meta` interface. |
| REDIR + TPROXY | TCP through REDIR and UDP through TPROXY; requires nftables. |
| TPROXY | TCP and UDP through TPROXY; requires nftables. |

The default ports are `12345` for REDIR and `12346` for TPROXY. Start creates only the selected mode's rules; stop removes only rules and routes owned by this container.

## 🌐 Alpine Network

- The firewall backend is selected from kernel support: nftables when `nf_tables` exists, otherwise iptables-legacy.
- Standard `local/main/default` IP rules are normalized once at container startup.
- IPv6 and multicast are disabled by default.
- `fq_codel` is the default qdisc. `cake`, `codel`, `sfq`, `pfifo`, and `bfifo` require their kernel module to be loaded by RouterOS.
- Conntrack defaults are aligned with RouterOS and can be edited or reset in the UI.
- A dedicated chain blocks only inbound IPv4 ICMP echo requests from the RouterOS-facing interface while Mihomo is not running. Ping is allowed after both Mihomo and the interception rules start successfully, then blocked again on stop, invalid configuration, or profile switch. This lets `check-gateway=ping` mark the route unavailable without blocking the WebUI or other container INPUT traffic.

## 🔐 Environment Variables

Subscription and runtime settings are stored under `/etc/mihomo`; ENV is only used for access to the embedded WebUI:

| ENV | Default | Purpose |
|---|---|---|
| `BASIC_AUTH_USER` | `admin` | HTTP Basic Auth username. |
| `BASIC_AUTH_HASH` | hash of `admin` | md5crypt value (`$1$...`), generated under **Settings → Access**. |
| `BASIC_AUTH` | `on` | `off` disables authentication; use only on an isolated trusted network. |
| `WEB_CSRF` | `on` | Controls same-origin checking for the hash-generator CGI. Main mutating subscription endpoints always require same-origin POST. |

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
├── events.log
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
- The WebUI uses plain HTTP; never expose container port `80` directly to the internet. Use LAN or VPN access.
- Mutating subscription endpoints require same-origin POST and enforce request-size limits.
- Content Security Policy blocks external scripts, inline code, framing, and unrelated browser network requests.
- Subscription/UI sources are restricted to HTTP(S), and temporary files use restrictive permissions.
- A candidate configuration never replaces the running one before `mihomo -t` succeeds.

## 🐳 Build and Architectures

`latest` is a multi-architecture image containing amd64 v3, arm64, armv7, and armv5. Separate `amd64v1`, `amd64v2`, and `amd64v4` tags are published as well.

| Build ARG | Default | Purpose |
|---|---|---|
| `MIHOMO_VERSION` | `latest` | Core release tag. |
| `MIHOMO_CUSTOM_CORE` | `0` | `1` downloads from `MIHOMO_CUSTOM_REPO`; release workflows currently default to the custom core. |
| `MIHOMO_REPO` | `MetaCubeX/mihomo` | Official core repository. |
| `MIHOMO_CUSTOM_REPO` | `Medium1992/mihomo-proxy-ros` | Compatible custom release repository. |
| `AMD64VERSION` | `v3` | amd64 level: `v1`, `v2`, `v3`, or `v4`. |

armv5 uses the compact Buildroot filesystem from `rootfs.tar`; all other targets use Alpine.
