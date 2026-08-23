import { all } from "./dom.js";

export function formatInterval(seconds) {
  const value = Number(seconds || 3600);
  if (value % 86400 === 0) return `${value / 86400} дн.`;
  if (value % 3600 === 0) return `${value / 3600} ч`;
  if (value % 60 === 0) return `${value / 60} мин.`;
  return `${value} сек.`;
}

export function formatUpdated(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return "Ещё не обновлялась";
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - value);
  if (delta < 60) return "только что";
  if (delta < 3600) return `${Math.floor(delta / 60)} мин. назад`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} ч назад`;
  return `${Math.floor(delta / 86400)} дн. назад`;
}

// Относительное время стареет само по себе, без новых данных с сервера.
export function refreshRelativeTimes() {
  all("[data-updated-at]").forEach((node) => {
    node.textContent = formatUpdated(node.dataset.updatedAt);
  });
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value < 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  const digits = unit > 0 && size < 10 ? 1 : 0;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

export function parseSubscriptionUserinfo(raw) {
  const values = {};
  String(raw || "").split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    values[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim();
  });
  return values;
}

// Ссылки приходят из заголовков стороннего сервера подписки, поэтому в href
// попадают только http(s): иначе туда пролезет javascript: или data:.
export function safeHttpUrl(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_) { return ""; }
}
