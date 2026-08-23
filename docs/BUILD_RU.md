[English](/docs/BUILD.md) | [Русский](/docs/BUILD_RU.md) · [← к README](/README_RU.md)

# Сборка образа


Тег `latest` содержит amd64 v3, arm64, armv7 и armv5. Для x86-64 также публикуются отдельные `amd64v1`, `amd64v2` и `amd64v4`.

Аргументы Dockerfile:

| ARG | По умолчанию | Назначение |
|---|---|---|
| `MIHOMO_VERSION` | `latest` | Тег релиза ядра. |
| `MIHOMO_CUSTOM_CORE` | `0` | `1` загружает ядро из `MIHOMO_CUSTOM_REPO`. Workflow публикации по умолчанию использует кастомное ядро. |
| `MIHOMO_REPO` | `MetaCubeX/mihomo` | Репозиторий официального ядра. |
| `MIHOMO_CUSTOM_REPO` | `Medium1992/mihomo-proxy-ros` | Репозиторий совместимого кастомного релиза. |
| `AMD64VERSION` | `v3` | Уровень amd64: `v1`, `v2`, `v3` или `v4`. |

armv5 использует компактный Buildroot rootfs из `rootfs.tar`; остальные архитектуры основаны на Alpine.
