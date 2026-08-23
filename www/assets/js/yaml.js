// Своя подсветка YAML: подключать highlight.js с CDN нельзя — CSP запрещает
// внешние скрипты, а тащить его в образ ради двух модалок не стоит.
import { $, escapeHtml, toast } from "./dom.js";

function yamlCommentIndex(line) {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (quote === "\"" && character === "\\") { index += 1; continue; }
      if (quote === "'" && character === "'" && line[index + 1] === "'") { index += 1; continue; }
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) return index;
  }
  return -1;
}

function yamlMappingColon(value) {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (quote === "\"" && character === "\\") { index += 1; continue; }
      if (quote === "'" && character === "'" && value[index + 1] === "'") { index += 1; continue; }
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === ":" && (index === value.length - 1 || /\s/.test(value[index + 1]))) return index;
  }
  return -1;
}

function yamlScalarHtml(value) {
  const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
  const leading = match[1];
  const scalar = match[2];
  const trailing = match[3];
  if (!scalar) return escapeHtml(value);
  let className = "yaml-scalar";
  if (/^(?:true|false)$/i.test(scalar)) className = "yaml-boolean";
  else if (/^(?:null|~)$/i.test(scalar)) className = "yaml-null";
  else if (/^[+-]?(?:0x[0-9a-f]+|0o[0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.test(scalar)) className = "yaml-number";
  else if (/^(?:["']|\||>|https?:\/\/)/.test(scalar)) className = "yaml-string";
  else if (/^[&*!]/.test(scalar)) className = "yaml-anchor";
  return `${escapeHtml(leading)}<span class="${className}">${escapeHtml(scalar)}</span>${escapeHtml(trailing)}`;
}

function yamlLineHtml(line) {
  const commentAt = yamlCommentIndex(line);
  const code = commentAt < 0 ? line : line.slice(0, commentAt);
  const comment = commentAt < 0 ? "" : line.slice(commentAt);
  const prefixMatch = code.match(/^(\s*)(-\s+)?/);
  let html = escapeHtml(prefixMatch[1]);
  if (prefixMatch[2]) html += `<span class="yaml-list-marker">-${escapeHtml(prefixMatch[2].slice(1))}</span>`;
  const body = code.slice(prefixMatch[0].length);
  const colonAt = /^(?:\{|\[)/.test(body) ? -1 : yamlMappingColon(body);
  if (colonAt >= 0) {
    html += `<span class="yaml-key">${escapeHtml(body.slice(0, colonAt))}</span>`;
    html += `<span class="yaml-punctuation">:</span>`;
    html += yamlScalarHtml(body.slice(colonAt + 1));
  } else {
    html += yamlScalarHtml(body);
  }
  if (comment) html += `<span class="yaml-comment">${escapeHtml(comment)}</span>`;
  return html;
}

export function renderYamlViewer(viewerId, text) {
  const viewer = $(viewerId);
  viewer.innerHTML = String(text || "").replace(/\r\n?/g, "\n").split("\n").map(yamlLineHtml).join("\n");
}

export function selectViewerContents(viewer) {
  viewer.focus();
  if (typeof viewer.select === "function") {
    viewer.select();
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(viewer);
  selection.removeAllRanges();
  selection.addRange(range);
}

export async function copyViewer(viewerId, message = "Скопировано") {
  const viewer = $(viewerId);
  const text = "value" in viewer ? viewer.value : viewer.textContent;
  if (!text) return;
  selectViewerContents(viewer);
  try {
    // Clipboard API недоступен по http://, а панель почти всегда открыта
    // именно так — поэтому нужен запасной execCommand.
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
  } catch (_) {
    if (!document.execCommand("copy")) throw new Error("Не удалось скопировать текст");
  }
  toast(message);
}
