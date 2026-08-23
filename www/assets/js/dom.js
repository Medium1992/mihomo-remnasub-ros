// Тонкие обёртки над DOM плюс тост и обёртка обработчиков.

export const $ = (id) => document.getElementById(id);
export const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
export const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

let toastTimer = 0;

export function toast(message, error = false) {
  const node = $("toast");
  window.clearTimeout(toastTimer);
  node.textContent = message;
  node.className = `toast show${error ? " error" : ""}`;
  toastTimer = window.setTimeout(() => { node.className = "toast"; }, 3000);
}

// Обработчики UI не должны ронять промис в никуда: любую ошибку показываем
// тостом, иначе неудачное действие выглядит как зависшая кнопка.
export function protectedAction(handler) {
  return async (...args) => {
    try { await handler(...args); }
    catch (error) { toast(error.message || "Операция не выполнена", true); }
  };
}

export function showPage(pageName) {
  all("[data-page-link]").forEach((button) => button.classList.toggle("active", button.dataset.pageLink === pageName));
  all("[data-page]").forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
  history.replaceState(null, "", `#${pageName}`);
}

export function selectSettingsTab(tabName) {
  all("[data-settings-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.settingsTab === tabName));
  all("[data-settings-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === tabName));
  $("save-settings").classList.toggle("hidden", tabName === "access");
}
