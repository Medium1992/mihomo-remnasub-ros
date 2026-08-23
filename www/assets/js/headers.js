// Редактор HTTP-заголовков: пять обязательных ключей всегда отправляются,
// пользователь правит только их значения и добавляет свои.
import { $, all, icon, escapeHtml } from "./dom.js";
import { requiredHeaders } from "./store.js";

export function parseHeaders(raw, includeRequired = false) {
  const entries = String(raw || "").split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return null;
    return { key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim(), required: false };
  }).filter(Boolean);
  if (!includeRequired) return entries;
  const rows = requiredHeaders().map(([key, fallback]) => {
    const index = entries.findIndex((entry) => entry.key.toLowerCase() === key);
    if (index < 0) return { key, value: fallback, required: true };
    const [entry] = entries.splice(index, 1);
    if (key === "user-agent" && entry.value === "Mihomo-RemnaSub-RoS/1") entry.value = fallback;
    return { key, value: entry.value || fallback, required: true };
  });
  return rows.concat(entries);
}

export function headerRow(row) {
  const action = row.required
    ? `<span class="header-lock" title="Обязательный заголовок">${icon("lock")}</span>`
    : `<button class="icon-button danger" type="button" data-remove-header title="Удалить заголовок">${icon("trash")}</button>`;
  return `<div class="header-row" data-header-row>
      <input type="text" data-header-key value="${escapeHtml(row.key)}" placeholder="x-custom-header"${row.required ? " readonly" : ""} aria-label="Ключ заголовка">
      <input type="text" data-header-value value="${escapeHtml(row.value)}" placeholder="Значение" aria-label="Значение заголовка">
      ${action}
    </div>`;
}

export function renderHeaders(containerId, raw, includeRequired = false) {
  $(containerId).innerHTML = parseHeaders(raw, includeRequired).map(headerRow).join("");
}

export function serializedHeaders(containerId, requireDefaults = false) {
  const seen = new Set();
  const lines = [];
  all("[data-header-row]", $(containerId)).forEach((row) => {
    const key = row.querySelector("[data-header-key]").value.trim();
    const value = row.querySelector("[data-header-value]").value.trim();
    if (!key && !value) return;
    if (!/^[A-Za-z0-9-]+$/.test(key)) throw new Error(`Недопустимое имя HTTP-заголовка: ${key || "пустое"}`);
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) throw new Error(`HTTP-заголовок ${key} указан дважды`);
    if (!value && requireDefaults && requiredHeaders().some(([required]) => required === normalized)) throw new Error(`Заполните значение ${key}`);
    seen.add(normalized);
    lines.push(`${key}: ${value}`);
  });
  return lines.join("\n");
}
