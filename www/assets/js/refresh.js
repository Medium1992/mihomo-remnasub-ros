// Общая точка перерисовки и опроса. Модули представлений регистрируют себя
// через onRender, поэтому refresh.js их не импортирует — иначе получился бы
// цикл "загрузка -> представление -> загрузка".
import { requestJson } from "./api.js";
import { toast } from "./dom.js";
import { store, anyBackgroundWork } from "./store.js";

const renderers = [];
let pollTimer = 0;
let pollFailures = 0;

export function onRender(renderer) {
  renderers.push(renderer);
}

export function renderAll() {
  renderers.forEach((renderer) => renderer());
}

export async function load({ quiet = false } = {}) {
  try {
    const [model, runtime] = await Promise.all([
      requestJson("/cgi-bin/remna-profile"),
      requestJson("/cgi-bin/remna-status")
    ]);
    store.model = model;
    store.runtime = runtime;
    pollFailures = 0;
    renderAll();
  } catch (error) {
    pollFailures += 1;
    if (!quiet) toast(`Не удалось загрузить состояние: ${error.message}`, true);
    throw error;
  }
}

// Каждый опрос — два shell-CGI на роутере, поэтому скрытая вкладка не
// опрашивается вовсе, а недоступный контейнер опрашивается всё реже.
export function pollDelay() {
  if (pollFailures > 0) return Math.min(30000, 3000 * 2 ** (pollFailures - 1));
  return anyBackgroundWork() ? 900 : 5000;
}

// Таймер ставится от завершения предыдущего запроса, а не по интервалу.
export function schedulePoll(delay = pollDelay()) {
  window.clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = window.setTimeout(async () => {
    try { await load({ quiet: true }); }
    catch (_) {}
    schedulePoll();
  }, delay);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.clearTimeout(pollTimer);
  else schedulePoll(0);
});
