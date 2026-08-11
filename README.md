# mihomo-remnasub-ros

Mihomo container for MikroTik RouterOS that runs a complete YAML subscription, such as a profile delivered by Remnawave.

The container keeps the downloaded profile intact and applies only local container overrides. The first override is a configurable `mixed` listener for the LAN. The small offline WebUI is served by BusyBox `httpd` on port `80`.

## What is stored

The mounted `/etc/mihomo` directory contains:

- `remnasub/profile.conf`: URL, request headers and local listener settings;
- `remnasub/source.yaml`: the last valid downloaded YAML;
- `remnasub/source.meta`: fetch timestamp and response size.

The final generated YAML lives in `/dev/shm/remnasub/config.yaml`, so temporary output does not wear router storage.

## WebUI

Open `http://CONTAINER_IP/` and configure:

- full YAML subscription URL;
- optional HTTP headers, one per line;
- refresh interval and request timeout;
- the local `mixed` listener and its users in `username#password` format.

Saving the profile requests an immediate reload. Mihomo is restarted only when the downloaded YAML plus local overrides pass `mihomo -t` validation. The Configuration page shows both the downloaded and final YAML.

The UI uses HTTP Basic authentication. Configure it with `BASIC_AUTH_USER` and `BASIC_AUTH_HASH`, or set `BASIC_AUTH=off` only in a trusted isolated network.

## Build arguments

`MIHOMO_CUSTOM_CORE=0` uses official MetaCubeX releases. Set `MIHOMO_CUSTOM_CORE=1` and optionally change `MIHOMO_CUSTOM_REPO` to download a compatible custom release.

Supported targets: amd64 (`AMD64VERSION=v1|v2|v3|v4`), arm64, armv7 and armv5.
