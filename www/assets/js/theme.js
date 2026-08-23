// Тема и акцентный цвет. Источник истины — state.conf на стороне
// контейнера; localStorage здесь используется только как зеркало для первой
// отрисовки, чтобы страница не мигала тёмной темой, пока не приехал ответ
// CGI. Расхождение всегда разрешается в пользу серверного значения.

export const THEMES = [
  { id: "auto", label: "Как в системе" },
  { id: "dark", label: "Тёмная" },
  { id: "light", label: "Светлая" },
  { id: "graphite", label: "Графит" },
  { id: "midnight", label: "Полночь" },
  { id: "forest", label: "Тайга" },
  { id: "sepia", label: "Сепия" }
];

export const ACCENT_PRESETS = [
  "#4773b7", "#4c8fbe", "#4a956c", "#9a6a3a", "#a05a9c", "#c25a52"
];

const MIRROR_THEME = "remnasub.theme";
const MIRROR_ACCENT = "remnasub.accent";

export function isTheme(value) {
  return THEMES.some((theme) => theme.id === value);
}

// Акцент хранится обычным #rrggbb: это и то, что отдаёт <input type="color">,
// и то, что валидирует CGI.
export function isAccent(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ""));
}

function hexToRgb(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function lighten(hex, amount) {
  const channels = hexToRgb(hex).map((value) => Math.round(value + (255 - value) * amount));
  return `rgb(${channels.join(", ")})`;
}

// "auto" в CSS не существует: держать светлую палитру ещё и внутри
// media-запроса значило бы дублировать её целиком, поэтому раскрываем здесь.
export function resolveTheme(theme) {
  if (theme !== "auto") return isTheme(theme) ? theme : "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme, accent) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  if (isAccent(accent)) {
    root.style.setProperty("--primary-rgb", hexToRgb(accent).join(", "));
    root.style.setProperty("--primary-hover", lighten(accent, 0.18));
  } else {
    root.style.removeProperty("--primary-rgb");
    root.style.removeProperty("--primary-hover");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--base-200").trim());
  try {
    localStorage.setItem(MIRROR_THEME, theme);
    localStorage.setItem(MIRROR_ACCENT, isAccent(accent) ? accent : "");
  } catch (_) {
    // Приватный режим или запрещённые данные сайта: зеркало необязательно.
  }
}

// Вызывается до первого запроса, чтобы не мигать чужой темой.
export function applyMirroredTheme() {
  try {
    applyTheme(localStorage.getItem(MIRROR_THEME) || "auto", localStorage.getItem(MIRROR_ACCENT) || "");
  } catch (_) {
    applyTheme("auto", "");
  }
}

// Пока выбрано "как в системе", переключение системной темы должно
// подхватываться без перезагрузки страницы.
export function watchSystemTheme(getTheme, getAccent) {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (getTheme() === "auto") applyTheme("auto", getAccent());
  });
}
