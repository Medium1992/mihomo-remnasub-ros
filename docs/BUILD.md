[English](/docs/BUILD.md) | [Русский](/docs/BUILD_RU.md) · [← back to README](/README.md)

# Building the image


`latest` is a multi-architecture image containing amd64 v3, arm64, armv7, and armv5. Separate `amd64v1`, `amd64v2`, and `amd64v4` tags are published as well.

| Build ARG | Default | Purpose |
|---|---|---|
| `MIHOMO_VERSION` | `latest` | Core release tag. |
| `MIHOMO_CUSTOM_CORE` | `0` | `1` downloads from `MIHOMO_CUSTOM_REPO`; release workflows currently default to the custom core. |
| `MIHOMO_REPO` | `MetaCubeX/mihomo` | Official core repository. |
| `MIHOMO_CUSTOM_REPO` | `Medium1992/mihomo-proxy-ros` | Compatible custom release repository. |
| `AMD64VERSION` | `v3` | amd64 level: `v1`, `v2`, `v3`, or `v4`. |
| `MIHOMO_FLAVOR` | — | `gvisor` picks the `mihomo-proxy-ros` core built with gVisor (`mihomo-gvisor-linux-*` assets). Only applies with `MIHOMO_CUSTOM_CORE=1`: the MetaCubeX core always includes gVisor. |

armv5 uses the compact Buildroot filesystem from `rootfs.tar`; all other targets use Alpine.
