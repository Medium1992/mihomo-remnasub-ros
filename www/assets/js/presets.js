// Готовые куски YAML для редакторов переопределений. Обычный пресет — целая
// верхнеуровневая секция, потому что накладывается она тоже целиком.
// Пресеты prepend-/append- не заменяют секцию, а дописывают элементы в
// начало или конец её списка.
//
// DNS: DoH к трём независимым резолверам, отключённый QTYPE65 (иначе Apple и
// Chrome сыплют HTTPS-записями), пиннинг адресов самих резолверов в hosts,
// чтобы их имена не пришлось резолвить через них же.
export const OVERRIDE_PRESETS = [
  {
    id: "ru-direct",
    label: "RU напрямую",
    hint: "prepend-rules: российские домены и адреса идут мимо прокси",
    yaml: [
      "prepend-rules:",
      "  - GEOSITE,category-ru,DIRECT",
      "  - GEOIP,RU,DIRECT,no-resolve"
    ].join("\n")
  },
  {
    id: "lan-direct",
    label: "LAN напрямую",
    hint: "prepend-rules: частные сети никогда не уходят в прокси",
    yaml: [
      "prepend-rules:",
      "  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
      "  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
      "  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
      "  - IP-CIDR,100.64.0.0/10,DIRECT,no-resolve"
    ].join("\n")
  },
  {
    id: "block-quic",
    label: "Блок QUIC",
    hint: "prepend-rules: UDP 443 отклоняется, браузеры и YouTube уходят на TCP",
    yaml: [
      "prepend-rules:",
      "  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT"
    ].join("\n")
  },
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

// Ключи, которые контейнер выставляет всегда, уже после наложения
// оверрайда: написанное здесь до конфигурации не доедет.
const ALWAYS_MANAGED = [
  "find-process-mode", "log-level", "ipv6", "profile",
  "listeners", "redir-port", "tproxy-port", "tun",
  "external-controller", "external-controller-tls", "external-controller-cors",
  "external-controller-unix", "external-controller-pipe", "external-controller-routing-mark",
  "external-ui", "external-ui-url", "external-ui-name", "external-doh-server", "secret"
];

// context: { mode, sniffer, stripSocks, stripHttp, stripMixed } — что из
// условно управляемого сейчас задаёт сам контейнер.
export function managedKeys(context = {}) {
  const keys = [...ALWAYS_MANAGED];
  if (context.mode) keys.push("mode");
  if (context.sniffer) keys.push("sniffer");
  if (context.stripSocks) keys.push("socks-port");
  if (context.stripHttp) keys.push("port");
  if (context.stripMixed) keys.push("mixed-port");
  return keys;
}

// Верхнеуровневые ключи, встреченные в тексте оверрайда.
export function topLevelKeys(text) {
  return String(text || "").split(/\r?\n/)
    .map((line) => /^([A-Za-z0-9_-]+):/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

// Проблемы, которые ломают наложение: список на верхнем уровне неотличим от
// нового ключа, табы YAML запрещает в отступах, а prepend-/append- умеют
// только блочный список.
export function overrideProblem(text, context) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.some((l) => /^-\s/.test(l))) {
    return "Список на верхнем уровне — элементы должны быть с отступом под своим ключом";
  }
  if (lines.some((l) => /^[ ]*\t/.test(l))) return "Табы в отступах — YAML их не допускает";
  const inline = lines.find((l) => /^(prepend|append)-[A-Za-z0-9_-]+:\s*[^\s#]/.test(l));
  if (inline) return `${inline.split(":")[0]}: элементы пишутся списком с новой строки, а не в [...]`;
  const managed = managedKeys(context);
  const ignored = topLevelKeys(text)
    .map((k) => k.replace(/^(prepend|append)-/, ""))
    .filter((k) => managed.includes(k));
  if (ignored.length) return `Эти ключи сейчас задаёт контейнер, они будут проигнорированы: ${[...new Set(ignored)].join(", ")}`;
  return "";
}

// Если такой ключ в тексте уже есть, строки пресета дописываются в его
// блок: второй одноимённый ключ наложение просто не увидело бы.
export function insertPreset(textarea, yaml) {
  const presetLines = yaml.split("\n");
  const key = presetLines[0].replace(/:.*$/, "");
  const lines = textarea.value.replace(/\s+$/, "").split("\n");
  const start = lines.findIndex((line) => line.replace(/:.*$/, "") === key && /^[A-Za-z0-9_-]+:\s*(#.*)?$/.test(line));
  if (start >= 0 && presetLines.length > 1) {
    let end = start + 1;
    while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]))) end += 1;
    const existing = new Set(lines.slice(start + 1, end).map((line) => line.trim()));
    const additions = presetLines.slice(1).filter((line) => !existing.has(line.trim()));
    lines.splice(end, 0, ...additions);
    textarea.value = `${lines.join("\n")}\n`;
  } else {
    const current = textarea.value.replace(/\s+$/, "");
    textarea.value = current ? `${current}\n${yaml}\n` : `${yaml}\n`;
  }
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
