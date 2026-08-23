// Готовые куски YAML для редакторов переопределений. Вставляются целой
// верхнеуровневой секцией, потому что накладываются они тоже целиком.
//
// DNS повторяет конфигурацию из config/config.yaml этого репозитория: DoH к
// трём независимым резолверам, отключённый QTYPE65 (иначе Apple и Chrome
// сыплют HTTPS-записями), пиннинг адресов самих резолверов в hosts, чтобы их
// имена не пришлось резолвить через них же.
export const OVERRIDE_PRESETS = [
  {
    id: "dns",
    label: "DNS через DoH",
    hint: "Заменяет секцию dns на DoH-резолверы с fake-ip",
    yaml: [
      "dns:",
      "  enable: true",
      "  cache-algorithm: arc",
      "  prefer-h3: false",
      "  use-system-hosts: false",
      "  respect-rules: false",
      "  listen: 0.0.0.0:53",
      "  ipv6: false",
      "  enhanced-mode: fake-ip",
      "  fake-ip-filter-mode: rule",
      "  fake-ip-range: 198.18.0.0/15",
      "  fake-ip-ttl: 10",
      "  fake-ip-filter:",
      "    - MATCH,fake-ip",
      "  default-nameserver:",
      "    - 8.8.8.8",
      "    - 9.9.9.9",
      "    - 1.1.1.1",
      "  nameserver:",
      "    - https://dns.google/dns-query#disable-qtype-65=true&disable-ipv6=true",
      "    - https://cloudflare-dns.com/dns-query#disable-qtype-65=true&disable-ipv6=true",
      "    - https://dns.quad9.net/dns-query#disable-qtype-65=true&disable-ipv6=true"
    ].join("\n")
  },
  {
    id: "hosts",
    label: "Пиннинг резолверов",
    hint: "Адреса DoH-резолверов, чтобы не резолвить их через них же",
    yaml: [
      "hosts:",
      "  dns.google: [8.8.8.8, 8.8.4.4]",
      "  dns.quad9.net: [9.9.9.9, 149.112.112.112]",
      "  cloudflare-dns.com: [104.16.248.249, 104.16.249.249]"
    ].join("\n")
  },
  {
    id: "lan",
    label: "Доступ из LAN",
    hint: "allow-lan и ограничение источников",
    yaml: [
      "allow-lan: true",
      "bind-address: '*'",
      "lan-allowed-ips:",
      "  - 192.168.0.0/16",
      "  - 10.0.0.0/8",
      "  - 172.16.0.0/12"
    ].join("\n")
  },
  {
    id: "geo",
    label: "Геоданные",
    hint: "Режим и автообновление geo-баз",
    yaml: [
      "geodata-mode: true",
      "geodata-loader: standard",
      "geo-auto-update: true",
      "geo-update-interval: 24"
    ].join("\n")
  },
  {
    id: "tuning",
    label: "Тюнинг соединений",
    hint: "unified-delay, tcp-concurrent, keep-alive",
    yaml: [
      "unified-delay: true",
      "tcp-concurrent: true",
      "keep-alive-idle: 15",
      "keep-alive-interval: 15"
    ].join("\n")
  }
];

// Ключи, которые контейнер выставляет сам уже после наложения оверрайда:
// написанное здесь до конфигурации не доедет.
export const MANAGED_KEYS = [
  "find-process-mode", "log-level", "ipv6", "profile",
  "listeners", "redir-port", "tproxy-port", "tun",
  "external-controller", "external-controller-tls", "external-controller-cors",
  "external-ui", "external-ui-url", "external-ui-name", "secret"
];

// Верхнеуровневые ключи, встреченные в тексте оверрайда.
export function topLevelKeys(text) {
  return String(text || "").split(/\r?\n/)
    .map((line) => /^([A-Za-z0-9_-]+):/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

// Проблемы, которые ломают наложение: список на верхнем уровне неотличим от
// нового ключа, а табы YAML вообще запрещает в отступах.
export function overrideProblem(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.some((l) => /^-\s/.test(l))) {
    return "Список на верхнем уровне — элементы должны быть с отступом под своим ключом";
  }
  if (lines.some((l) => /^[ ]*\t/.test(l))) return "Табы в отступах — YAML их не допускает";
  const ignored = topLevelKeys(text).filter((k) => MANAGED_KEYS.includes(k));
  if (ignored.length) return `Эти ключи задаёт контейнер, они будут проигнорированы: ${[...new Set(ignored)].join(", ")}`;
  return "";
}

export function insertPreset(textarea, yaml) {
  const current = textarea.value.replace(/\s+$/, "");
  textarea.value = current ? `${current}\n${yaml}\n` : `${yaml}\n`;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
