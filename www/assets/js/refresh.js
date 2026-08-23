// Общая точка перерисовки и опроса. Модули представлений регистрируют себя
// через onRender, поэтому refresh.js их не импортирует — иначе получился бы
// цикл "загрузка -> представление -> загрузка".
import { requestJson } from "./api.js";
import { toast } from "./dom.js";
import { store, anyBackgroundWork } from "./store.js";

const renderers = [];
let pollTimer = 0;

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
    renderAll();
  } catch (error) {
    if (!quiet) toast(`Не удалось загрузить состояние: ${error.message}`, true);
    throw error;
  }
}

// Пока в фоне что-то происходит, опрашиваем чаще — но всё равно по таймеру
// от завершения предыдущего запроса, а не по интервалу.
export function schedulePoll(delay) {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(async () => {
    try { await load({ quiet: true }); }
    catch (_) {}
    schedulePoll(anyBackgroundWork() ? 900 : 5000);
  }, delay);
}

export function pollDelay() {
  return anyBackgroundWork() ? 900 : 5000;
}
